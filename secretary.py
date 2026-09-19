#!/usr/bin/env python3
"""
Middle Gateway / Secretary — Routing, Decision Engine & Context Preparation

Responsibilities:
1. Receive user requests from Hermes Agent / User
2. Prepare context (scan files, gather system info)
3. Route to Sonnet 5 Consultant (via AIPASS Bridge) — or reuse saved skill
4. Parse Consultant's plan (JSON) or use saved plan
5. Execute plan via Hermes Agent / system commands / bridge agent
6. **Automated Verification**: ALWAYS verify results after execution
7. **Skill Reuse**: Check saved skills before consulting; save on success
8. **Self-Healing**: If execution fails, re-consult for alternative
"""

import json
import subprocess
import sys
import os
import re
import logging
import logging.handlers
import time
import uuid
import requests
from pathlib import Path
from typing import Any, Dict, List, Optional

# ============================
# Logging
# ============================
LOG_DIR = Path(os.environ.get("SECRETARY_LOG_DIR", str(Path(__file__).parent / "logs")))
LOG_LEVEL = os.environ.get("SECRETARY_LOG_LEVEL", "INFO").upper()
LOG_MAX_BYTES = int(os.environ.get("SECRETARY_LOG_MAX_BYTES", str(5 * 1024 * 1024)))
LOG_BACKUP_COUNT = int(os.environ.get("SECRETARY_LOG_BACKUP_COUNT", "3"))


class JsonFormatter(logging.Formatter):
    """Emit one structured, redacted event per line."""

    def format(self, record: logging.LogRecord) -> str:
        event = getattr(record, "event", record.getMessage())
        fields = getattr(record, "event_fields", {})
        payload = {
            "timestamp": self.formatTime(record, "%Y-%m-%dT%H:%M:%SZ"),
            "level": record.levelname.lower(),
            "event": event,
            **fields,
        }
        return json.dumps(payload, ensure_ascii=False, default=str)


def configure_logging() -> logging.Logger:
    """Configure stdout and rotating JSONL logging exactly once per process."""
    logger = logging.getLogger("secretary")
    logger.setLevel(getattr(logging, LOG_LEVEL, logging.INFO))
    logger.propagate = False

    if getattr(logger, "_secretary_configured", False):
        return logger

    LOG_DIR.mkdir(parents=True, exist_ok=True)
    formatter = JsonFormatter()
    stdout_handler = logging.StreamHandler(sys.stdout)
    stdout_handler.setFormatter(formatter)
    file_handler = logging.handlers.RotatingFileHandler(
        LOG_DIR / "secretary.jsonl",
        maxBytes=LOG_MAX_BYTES,
        backupCount=LOG_BACKUP_COUNT,
        encoding="utf-8",
    )
    file_handler.setFormatter(formatter)
    logger.handlers.clear()
    logger.addHandler(stdout_handler)
    logger.addHandler(file_handler)
    logger._secretary_configured = True
    return logger


log = configure_logging()


class MetricsRegistry:
    """Small process-local latency registry; JSONL remains the durable source."""

    def __init__(self) -> None:
        self._metrics: Dict[str, Dict[str, float]] = {}

    def record(self, operation: str, duration_ms: float) -> Dict[str, float]:
        metric = self._metrics.setdefault(operation, {"count": 0, "total_latency_ms": 0.0})
        metric["count"] += 1
        metric["total_latency_ms"] += duration_ms
        metric["avg_latency_ms"] = round(metric["total_latency_ms"] / metric["count"], 3)
        return dict(metric)

    def snapshot(self) -> Dict[str, Dict[str, float]]:
        return {operation: dict(values) for operation, values in self._metrics.items()}


METRICS = MetricsRegistry()


def log_event(level: int, event: str, **fields: Any) -> None:
    """Log metadata only. Callers must not pass prompt, command, output, or secrets."""
    log.log(level, event, extra={"event": event, "event_fields": fields})


def record_latency(operation: str, started_at: float, workflow_id: Optional[str] = None, **fields: Any) -> float:
    duration_ms = round((time.monotonic() - started_at) * 1000, 3)
    metric = METRICS.record(operation, duration_ms)
    log_event(logging.INFO, "latency_recorded", workflow_id=workflow_id, operation=operation,
              latency_ms=duration_ms, avg_latency_ms=metric["avg_latency_ms"], **fields)
    return duration_ms

# ============================
# Skill Library Configuration
# ============================
SKILLS_DIR = Path(os.environ.get("SECRETARY_SKILLS_DIR", str(Path(__file__).parent / "skills")))
SKILLS_DIR.mkdir(parents=True, exist_ok=True)

# ============================
# Configuration
# ============================
AIPASS_BRIDGE_URL = os.environ.get("AIPASS_BRIDGE_URL", "https://aipass-web-bridge.taijustarrett417.workers.dev")
CONSULTANT_MODEL = os.environ.get("CONSULTANT_MODEL", "claude-sonnet-5@default")

# Model the secretary actually sends. Starts as the requested CONSULTANT_MODEL;
# when AIPASS auto-switches (e.g. quota exhausted -> gemini-3.1-flash-lite),
# notify_model_switch() adopts the switched-to model here so subsequent
# consultant/self-heal calls stop paying the switch penalty every request.
ACTIVE_CONSULTANT_MODEL: str = CONSULTANT_MODEL

# Consultant provider chain (outer planning layer):
#   "nous"  -> Nous Portal free models (NOUS_CONSULTANT_MODELS, in order) ...
#   "bridge" -> direct bridge consultant (legacy behavior)
# The bridge consultant always remains the final fallback.
CONSULTANT_PROVIDER = os.environ.get("CONSULTANT_PROVIDER", "nous")
NOUS_CONSULTANT_MODELS = [
    ("meituan/longcat-2.0:free", "high"),
    ("upstage/solar-pro4:free", "medium"),
]
NOUS_AUTH_FILE = os.environ.get("NOUS_AUTH_FILE",
                                str(Path.home() / ".hermes" / "auth.json"))
NOUS_TIMEOUT = int(os.environ.get("NOUS_CONSULTANT_TIMEOUT", "90"))
MAX_TOKENS = int(os.environ.get("SECRETARY_MAX_TOKENS", "4096"))
MAX_HEAL_ATTEMPTS = int(os.environ.get("SECRETARY_MAX_HEAL_ATTEMPTS", "2"))

# Use absolute path for bridge agent script to avoid cwd issues
PROJECT_ROOT = Path(__file__).parent.resolve()
BRIDGE_AGENT_SCRIPT = os.environ.get("BRIDGE_AGENT_SCRIPT", "node")
BRIDGE_AGENT_ARGS = os.environ.get("BRIDGE_AGENT_ARGS", str(PROJECT_ROOT / "packages/core/aipass-bridge/agent.mjs"))
BRIDGE_AGENT_APPLY = os.environ.get("BRIDGE_AGENT_APPLY", "1") == "1"

# Execution lane: "hermes" (inner Hermes agent lane whose model lane is the
# AIPASS bridge) or "bridge" (legacy direct bridge agent).
EXECUTION_LANE = os.environ.get("EXECUTION_LANE", "hermes")
HERMES_BIN = os.environ.get("HERMES_BIN", str(Path.home() / ".local" / "bin" / "hermes"))
HERMES_LANE_PROVIDER = os.environ.get("HERMES_LANE_PROVIDER", "aipass-bridge")
HERMES_LANE_MODEL = os.environ.get("HERMES_LANE_MODEL", "claude-sonnet-5@default")

# Orchestration mode: "primary" = multi-turn Primary brain (AIPASS bridge)
# dialoguing with this Secretary (second brain on Hermes); "legacy" = the
# original one-shot consultant + full-plan execution workflow.
ORCHESTRATION_MODE = os.environ.get("SECRETARY_ORCHESTRATION", "primary")
PRIMARY_BRAIN_MODEL = os.environ.get("PRIMARY_BRAIN_MODEL", "claude-sonnet-5@default")
# Adopted mirror of PRIMARY_BRAIN_MODEL: follows whatever AIPASS switches the
# account to (quota exhaustion etc.) so brain turns stop re-triggering switches.
ACTIVE_PRIMARY_BRAIN_MODEL: str = PRIMARY_BRAIN_MODEL
PRIMARY_BRAIN_MAX_TURNS = int(os.environ.get("PRIMARY_BRAIN_MAX_TURNS", "12"))
PRIMARY_BRAIN_TIMEOUT = int(os.environ.get("PRIMARY_BRAIN_TIMEOUT", "90"))
# When the bridge silently switches to a weaker model (credit_not_enough):
# "escalate" = hand remaining planning to the Nous consultant chain;
# "continue" = keep using the switched (weaker) brain.
PRIMARY_BRAIN_ON_SWITCH = os.environ.get("PRIMARY_BRAIN_ON_SWITCH", "escalate")
PRIMARY_BRAIN_TURN_CHAR_LIMIT = int(os.environ.get("PRIMARY_BRAIN_TURN_CHAR_LIMIT", "6000"))

# ============================
# Context Preparation
# ============================

def gather_context(request: str, cwd: str = None) -> Dict[str, Any]:
    """Gather context from the current environment."""
    cwd = cwd or os.getcwd()
    return {
        "request": request,
        "cwd": cwd,
        "python_version": _run_command("python3 --version"),
        "os_info": _run_command("uname -a"),
        "relevant_files": _list_relevant_files(cwd),
        "timestamp": subprocess.getoutput("date -u +'%Y-%m-%dT%H:%M:%SZ'"),
        "bridge_available": _check_bridge_available(),
    }


def _check_bridge_available() -> bool:
    """Check if the AIPASS Bridge is reachable."""
    try:
        result = subprocess.run(
            ["curl", "-s", "-o", "/dev/null", "-w", "%{http_code}",
             f"{AIPASS_BRIDGE_URL}/status"],
            capture_output=True, text=True, timeout=5
        )
        return result.stdout.strip() == "200"
    except Exception:
        return False


def _run_command(cmd: str) -> str:
    """Run a shell command and return output."""
    try:
        result = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=10)
        if result.returncode == 0:
            return result.stdout.strip() if result.stdout.strip() else "OK"
        else:
            return f"Error: {result.stderr.strip()}"
    except Exception as e:
        return f"Error: {str(e)}"


def _list_relevant_files(directory: str = ".", extensions: Optional[List[str]] = None) -> List[str]:
    """List relevant files in the current directory."""
    if extensions is None:
        extensions = [".py", ".js", ".ts", ".json", ".md", ".sh", ".yaml", ".yml"]

    files = []
    try:
        for item in Path(directory).iterdir():
            if item.is_file() and any(item.suffix == ext for ext in extensions):
                files.append(str(item))
            elif item.is_dir() and not item.name.startswith("."):
                for subfile in Path(item).rglob("*"):
                    if subfile.is_file() and any(subfile.suffix == ext for ext in extensions):
                        files.append(str(subfile))
    except Exception as e:
        files.append(f"Error listing files: {str(e)}")

    return files[:50]


# ============================
# Routing & Decision Engine
# ============================

def should_consult(request: str) -> bool:
    """Determine whether this request requires consultation with Sonnet 5.

    Simple file operations (create/update/delete specific files) should NOT
    trigger consultation — they are handled directly by the bridge agent.
    Only complex planning/decision requests need Sonnet 5.
    """
    # If it's a direct file operation, skip consultation
    file_ops = [
        "create file", "create a file", "create new file",
        "delete file", "delete a file", "ลบไฟล์", "ลบไฟล์",
        "update file", "update a file", "แก้ไขไฟล์", "แก้ไขไฟล์",
        "edit file", "edit a file",
        "modify file", "modify a file",
        "สร้างไฟล์", "สร้างไฟล์",  # Thai CREATE
    ]
    request_lower = request.lower()
    for op in file_ops:
        if op in request_lower:
            return False

    consult_keywords = [
        "create", "build", "implement", "design", "architect",
        "fix", "debug", "optimize", "refactor", "improve",
        "plan", "strategy", "approach", "how to", "best way",
        "system", "infrastructure", "deploy", "configure",
        "complex", "multi-step", "analyze", "review",
        "สถาปัตยกรรม", "ออกแบบ", "ระบบ", "โครงสร้าง",  # Thai
    ]
    return any(keyword in request_lower for keyword in consult_keywords)


def is_file_operation_task(action: str, command_hint: str) -> bool:
    """Determine if this step involves file operations."""
    file_operation_signals = [
        # English
        "create", "new file", "make a file", "write", "write file",
        "create file", "create a file", "creating file",
        "edit", "modify", "update", "change", "patch", "tweak",
        "edit file", "modify file", "update file", "change file",
        "read", "read file", "read the file", "view file", "inspect",
        "delete", "remove", "remove file", "delete file",
        "add", "append", "insert", "prepend",
        "add route", "add endpoint", "add function", "add class",
        "route", "endpoint", "api", "/health", "/api",
        "file", "files", "code", "source",
        # Thai
        "สร้าง", "สร้างไฟล์", "เขียน", "เขียนไฟล์",
        "แก้ไข", "แก้ไขไฟล์", "แก้", "เปลี่ยน", "ปรับ",
        "อ่าน", "อ่านไฟล์", "ดูไฟล์", "ตรวจสอบ",
        "ลบ", "ลบไฟล์", "ลบออก", "เอาออก",
        "เพิ่ม", "เพิ่มไฟล์", "เพิ่มเนื้อหา",
    ]

    action_lower = action.lower()
    if not command_hint:
        for signal in file_operation_signals:
            if signal in action_lower:
                return True
        return False

    hint_lower = command_hint.lower()
    combined = f"{action_lower} {hint_lower}"
    for signal in file_operation_signals:
        if signal in combined:
            return True

    return False


# ============================
# Bridge Agent Execution
# ============================

def run_bridge_agent_task(
    task: str,
    cwd: str,
    apply: bool = True,
    bridge_url: str = None,
    extra_flags: List[str] = None
) -> Dict[str, Any]:
    """Execute a task using the AIPASS bridge agent."""
    bridge_url = bridge_url or AIPASS_BRIDGE_URL

    cmd_parts = [
        BRIDGE_AGENT_SCRIPT,
        BRIDGE_AGENT_ARGS,
        task,
        "--root", str(cwd),
        "--bridge", bridge_url
    ]

    if apply and BRIDGE_AGENT_APPLY:
        cmd_parts.append("--apply")
    if extra_flags:
        cmd_parts.extend(extra_flags)

    print(f"[BridgeAgent] 🚀 Running: {' '.join(cmd_parts)[:200]}...")

    try:
        result = subprocess.run(
            cmd_parts,
            capture_output=True,
            text=True,
            timeout=120,
            cwd=cwd
        )

        output = result.stdout
        if result.stderr:
            output += "\n" + result.stderr

        success = result.returncode == 0
        if success and "wrote" in output.lower():
            success = True

        return {
            "status": "success" if success else "failure",
            "command": " ".join(cmd_parts),
            "output": output[:2000],
            "success": success,
            "returncode": result.returncode
        }

    except subprocess.TimeoutExpired:
        return {
            "status": "timeout",
            "command": " ".join(cmd_parts),
            "output": "Agent task timed out after 120 seconds",
            "success": False,
            "returncode": -1
        }
    except Exception as e:
        return {
            "status": "error",
            "command": " ".join(cmd_parts),
            "output": f"Error running bridge agent: {str(e)}",
            "success": False,
            "returncode": -1
        }


def run_hermes_lane_task(task: str, cwd: str) -> Dict[str, Any]:
    """Execute a task through the inner Hermes agent lane.

    Hermes runs one-shot (-z) with the AIPASS bridge (8787) as its model lane
    (primary claude-sonnet-5@default; the bridge itself falls back to
    gemini-3.1-flash-lite on credit_not_enough). Return shape matches
    run_bridge_agent_task so execute_plan stays lane-agnostic.
    """
    cmd_parts = [
        HERMES_BIN, "-z", task,
        "--provider", HERMES_LANE_PROVIDER,
        "--model", HERMES_LANE_MODEL,
        "--in", str(cwd),
    ]
    print(f"[HermesLane] 🚀 Running: {HERMES_LANE_PROVIDER}/{HERMES_LANE_MODEL}: {task[:120]}...")
    started = time.monotonic()

    try:
        result = subprocess.run(
            cmd_parts,
            capture_output=True,
            text=True,
            timeout=300,
            cwd=cwd
        )
        output = (result.stdout or "") + (("\n" + result.stderr) if result.stderr else "")
        record_latency("hermes_lane", started)
        return {
            "status": "success" if result.returncode == 0 else "failure",
            "command": " ".join(cmd_parts),
            "output": output[:2000],
            "success": result.returncode == 0,
            "returncode": result.returncode
        }
    except subprocess.TimeoutExpired:
        return {
            "status": "timeout",
            "command": " ".join(cmd_parts),
            "output": "Hermes lane task timed out after 300 seconds",
            "success": False,
            "returncode": -1
        }
    except Exception as e:
        return {
            "status": "error",
            "command": " ".join(cmd_parts),
            "output": f"Error running hermes lane: {str(e)}",
            "success": False,
            "returncode": -1
        }


# ============================
# Primary Brain Session (AIPASS bridge conversation)
# ============================
# The bridge endpoint accepts ONLY the last user message (system messages and
# prior turns are dropped by extractUserParts) but keeps the conversation
# history server-side. A workflow therefore opens a fresh conversation and
# advances it one user message per turn.

BRAIN_PROTOCOL_INTRO = """You are the Primary brain. This Secretary is the second brain: it runs on the
user's machine with real tools (file operations, shell commands) and executes your
decisions. Reply with EXACTLY ONE JSON object, no markdown fences, no extra text:
{"type":"instruction","analysis":"<why>","steps":[{"step":1,"action":"<operation in natural language>","command_hint":"<optional shell command>","expected_outcome":"<checkable result>","is_file_operation":true}]}
{"type":"question","questions":["<what info you need>"]}
{"type":"done","summary":"<what was accomplished>"}
Use "instruction" when you can decide concrete steps; use "question" when you need
more information before deciding; use "done" only when the original request is
satisfied. You cannot run tools yourself — every real action goes through Secretary."""


def brain_new_conversation(workflow_id: Optional[str] = None) -> Optional[str]:
    """Open a fresh bridge conversation; returns its id or None."""
    try:
        resp = requests.post(
            f"{AIPASS_BRIDGE_URL}/conversations/new",
            json={"model": ACTIVE_PRIMARY_BRAIN_MODEL, "temporary": True,
                  "message": "Starting a new working session."},
            timeout=30
        )
        resp.raise_for_status()
        conv_id = resp.json().get("id")
        if conv_id:
            log_event(logging.INFO, "brain_conversation_opened",
                      workflow_id=workflow_id, conversation=conv_id)
        return conv_id
    except Exception as e:
        log_event(logging.WARNING, "brain_conversation_failed",
                  workflow_id=workflow_id, error_type=type(e).__name__)
        print(f"[PrimaryBrain] ⚠️  Could not open a bridge conversation: {type(e).__name__}")
        return None


def brain_turn(message: str, workflow_id: Optional[str] = None) -> Dict[str, Any]:
    """One Primary-brain turn. Returns {content, switch, error}."""
    try:
        resp = requests.post(
            f"{AIPASS_BRIDGE_URL}/v1/chat/completions",
            json={"model": ACTIVE_PRIMARY_BRAIN_MODEL,
                  "messages": [{"role": "user", "content": message}],
                  "max_tokens": MAX_TOKENS, "temperature": 0.3},
            timeout=PRIMARY_BRAIN_TIMEOUT
        )
        resp.raise_for_status()
        result = resp.json()
        switch_info = detect_model_switch(result)
        if switch_info:
            notify_model_switch(switch_info, PRIMARY_BRAIN_MODEL, workflow_id)
        return {"content": result["choices"][0]["message"]["content"],
                "switch": switch_info, "error": None}
    except Exception as e:
        log_event(logging.WARNING, "brain_turn_failed", workflow_id=workflow_id,
                  error_type=type(e).__name__)
        return {"content": None, "switch": None, "error": type(e).__name__}


def parse_brain_response(content: Optional[str]) -> Optional[Dict[str, Any]]:
    """Parse the Primary brain protocol JSON (fenced or bare). None if invalid."""
    if not isinstance(content, str) or not content.strip():
        return None
    candidates = [content]
    if "```" in content:
        lines = content.split("\n")
        starts = [i for i, ln in enumerate(lines) if ln.strip().startswith("```")]
        if len(starts) >= 2:
            candidates.insert(0, "\n".join(lines[starts[0] + 1:starts[1]]))
    for candidate in candidates:
        try:
            parsed = json.loads(candidate)
        except json.JSONDecodeError:
            continue
        if not isinstance(parsed, dict):
            continue
        kind = parsed.get("type")
        if kind == "instruction":
            steps = _extract_steps(parsed)
            if steps:
                parsed["steps"] = steps
                return parsed
            return None
        if kind == "question" and isinstance(parsed.get("questions"), list) and parsed["questions"]:
            return parsed
        if kind == "done":
            return parsed
    return None


BRAIN_PROTOCOL_REMINDER = ("Your previous reply was not the required JSON protocol. "
                           "Respond again with EXACTLY ONE JSON object of the form "
                           '{"type":"instruction",...},{"type":"question",...},{"type":"done",...} and nothing else.')


# ============================
# Secretary → Consultant Communication
# ============================

MODEL_SWITCH_PATTERN = re.compile(r'data-model_switched.*?(\{.*\})')


def detect_model_switch(response: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Detect AIPASS auto model switching in a consultant API response.

    The bridge reports a switch as a `data-model_switched` event embedded in
    `reasoning_content` (e.g. credit_not_enough, model_not_available).
    Returns {"from_model", "to_model", "reason"} or None.
    """
    if not isinstance(response, dict):
        return None
    message = {}
    try:
        message = response["choices"][0]["message"]
    except (KeyError, IndexError, TypeError):
        return None

    haystack = " ".join(
        str(text) for text in (message.get("reasoning_content"), message.get("content"))
        if text
    )
    match = MODEL_SWITCH_PATTERN.search(haystack)
    if not match:
        return None
    try:
        info = json.loads(match.group(1))
        data = info.get("data", info)
        return {
            "from_model": data.get("fromModelId", "unknown"),
            "to_model": data.get("toModelId", "unknown"),
            "reason": data.get("reason", "unknown"),
        }
    except (json.JSONDecodeError, AttributeError):
        return {"from_model": "unknown", "to_model": "unknown", "reason": "unparsed_switch_event"}


def notify_model_switch(switch_info: Dict[str, Any], requested_model: str,
                        workflow_id: Optional[str] = None) -> None:
    """Surface an AIPASS auto model switch and adopt the switched-to model.

    Prints a visible warning, logs a `model_switched` JSONL event, and updates
    ACTIVE_CONSULTANT_MODEL so the secretary keeps using the model the account
    was switched to (e.g. quota exhausted -> free gemini-3.1-flash-lite)
    instead of re-triggering the switch on every call.
    """
    global ACTIVE_CONSULTANT_MODEL, ACTIVE_PRIMARY_BRAIN_MODEL
    print(f"\n[Secretary] ⚠️  AIPASS auto-switched the model: "
          f"{switch_info['from_model']} → {switch_info['to_model']} "
          f"(reason: {switch_info['reason']})")
    print(f"[Secretary] ℹ️  Requested model was: {requested_model}")
    if switch_info.get("to_model") and switch_info["to_model"] != "unknown":
        ACTIVE_CONSULTANT_MODEL = switch_info["to_model"]
        ACTIVE_PRIMARY_BRAIN_MODEL = switch_info["to_model"]
        print(f"[Secretary] 🔄 Secretary will use the switched model from now on: "
              f"{ACTIVE_CONSULTANT_MODEL}")
    log_event(logging.WARNING, "model_switched", workflow_id=workflow_id,
              requested_model=requested_model,
              active_model=ACTIVE_CONSULTANT_MODEL, **switch_info)


def get_current_model() -> Optional[str]:
    """Return the model the bridge is currently using (its /status defaultModel)."""
    import requests
    try:
        response = requests.get(f"{AIPASS_BRIDGE_URL}/status", timeout=5)
        response.raise_for_status()
        return response.json().get("defaultModel")
    except Exception as e:
        log_event(logging.WARNING, "current_model_lookup_failed",
                  error_type=type(e).__name__)
        return None


def prepare_consult_request(request: str, context: Dict[str, Any]) -> Dict[str, Any]:
    """Prepare the request payload for the consultant (uses the active model)."""
    return {
        "model": ACTIVE_CONSULTANT_MODEL,
        "messages": [
            {
                "role": "system",
                "content": """You are a Planning Consultant for an autonomous agent system.
Your job is to:
1. Analyze the user's request
2. Prepare a clear, structured plan as JSON
3. Identify potential risks and dependencies
4. For file operations, specify the exact action and any command hints.
IMPORTANT: For file operations, you MUST use these exact JSON keys:
- "action" (required): A clear description of the file operation in natural language
- "command_hint" (required): The suggested shell command or bridge agent command
- "is_file_operation" (required): true/false

DO NOT use these alternative key names: "step", "command", "steps", "instructions".
ALWAYS use "action" and "command_hint" for each plan item.

Example:
{
  "plan": [
    {"step": 1, "action": "Create file /path/to/file.txt with content 'Hello'", "command_hint": "echo 'Hello' > /path/to/file.txt", "expected_outcome": "File created", "is_file_operation": true}
  ]
}

Return a JSON object with this structure:
{
  "goal": "Brief description of the objective",
  "analysis": "Key observations and considerations",
  "plan": [
    {"step": 1, "action": "Description of action", "command_hint": "suggested command", "expected_outcome": "what should happen", "is_file_operation": true/false},
    {"step": 2, ...}
  ],
  "dependencies": ["list of required tools/libraries"],
  "risks": ["potential issues to watch for"],
  "next_action": "recommendation for immediate next step"
}"""
            },
            {
                "role": "user",
                "content": f"""Context:
{json.dumps(context, indent=2, ensure_ascii=False)}

Request:
{request}

Please analyze and provide a structured plan as JSON."""
            }
        ],
        "max_tokens": MAX_TOKENS,
        "temperature": 0.3,
    }


def _nous_credentials() -> Optional[Dict[str, Any]]:
    """Read a valid Nous Portal inference token from the Hermes auth store."""
    try:
        with open(NOUS_AUTH_FILE) as fh:
            auth = json.load(fh)
    except (OSError, json.JSONDecodeError):
        return None

    def _find(node, depth=0):
        if depth > 6:
            return None
        if isinstance(node, dict):
            if "access_token" in node and "inference_base_url" in node:
                return node
            for value in node.values():
                found = _find(value, depth + 1)
                if found:
                    return found
        elif isinstance(node, list):
            for value in node:
                found = _find(value, depth + 1)
                if found:
                    return found
        return None

    creds = _find(auth)
    if not creds:
        return None
    expires_at = creds.get("expires_at", 0)
    if isinstance(expires_at, (int, float)) and expires_at and time.time() > expires_at:
        return None
    return creds


def call_nous_consultant(request: str, context: Dict[str, Any],
                         model: str, effort: str,
                         workflow_id: Optional[str] = None) -> Optional[Dict[str, Any]]:
    """One Nous Portal consultant attempt. Returns a parsed plan dict or None."""
    creds = _nous_credentials()
    if not creds:
        print(f"[Secretary] ℹ️  No valid Nous Portal token ({NOUS_AUTH_FILE}); "
              f"skipping consultant {model}")
        return None
    payload = prepare_consult_request(request, context)
    payload["model"] = model
    payload["reasoning_effort"] = effort
    base = creds.get("inference_base_url", "https://inference-api.nousresearch.com/v1")
    started_at = time.monotonic()
    log_event(logging.INFO, "nous_consultation_started", workflow_id=workflow_id,
              model=model, effort=effort)
    try:
        resp = requests.post(
            base.rstrip("/") + "/chat/completions",
            json=payload,
            headers={"Authorization": f"Bearer {creds['access_token']}"},
            timeout=NOUS_TIMEOUT
        )
        resp.raise_for_status()
        content = resp.json()["choices"][0]["message"]["content"]
        parsed = None
        if "```" in content:
            lines = content.split("\n")
            starts = [i for i, ln in enumerate(lines) if ln.strip().startswith("```")]
            if len(starts) >= 2:
                block = "\n".join(lines[starts[0] + 1:starts[1]])
                try:
                    parsed = json.loads(block)
                except json.JSONDecodeError:
                    parsed = None
        if parsed is None:
            try:
                parsed = json.loads(content)
            except json.JSONDecodeError:
                parsed = None
        if parsed is None or not _extract_steps(parsed):
            record_latency("consultation", started_at, workflow_id, outcome="parse_error")
            log_event(logging.WARNING, "nous_consultation_parse_failed",
                      workflow_id=workflow_id, model=model)
            return None
        record_latency("consultation", started_at, workflow_id, outcome="success")
        log_event(logging.INFO, "nous_consultation_succeeded",
                  workflow_id=workflow_id, model=model, effort=effort,
                  step_count=len(_extract_steps(parsed)))
        return parsed
    except Exception as e:
        record_latency("consultation", started_at, workflow_id, outcome="error")
        log_event(logging.WARNING, "nous_consultation_failed", workflow_id=workflow_id,
                  model=model, error_type=type(e).__name__)
        print(f"[Secretary] ⚠️  Nous consultant {model} failed: {type(e).__name__}")
        return None


def call_consultant(request: str, context: Dict[str, Any], workflow_id: Optional[str] = None) -> Optional[Dict[str, Any]]:
    """Send request to the consultant chain: Nous Portal (free) then bridge."""
    if CONSULTANT_PROVIDER == "nous":
        for model, effort in NOUS_CONSULTANT_MODELS:
            parsed = call_nous_consultant(request, context, model, effort, workflow_id)
            if parsed is not None:
                print(f"[Secretary] ✅ Plan prepared by Nous consultant: "
                      f"{model} (effort={effort})")
                return parsed
        print("[Secretary] ℹ️  All Nous consultants unavailable; falling back to bridge consultant")
    consult_payload = prepare_consult_request(request, context)
    started_at = time.monotonic()
    log_event(logging.INFO, "consultation_started", workflow_id=workflow_id,
              requested_model=CONSULTANT_MODEL, active_model=ACTIVE_CONSULTANT_MODEL)

    try:
        response = requests.post(
            f"{AIPASS_BRIDGE_URL}/v1/chat/completions",
            json=consult_payload,
            timeout=60
        )
        response.raise_for_status()

        result = response.json()
        switch_info = detect_model_switch(result)
        if switch_info:
            notify_model_switch(switch_info, CONSULTANT_MODEL, workflow_id)
        model_used = result.get("model")
        if model_used and model_used != ACTIVE_CONSULTANT_MODEL:
            log_event(logging.WARNING, "model_mismatch", workflow_id=workflow_id,
                      requested_model=ACTIVE_CONSULTANT_MODEL, model_used=model_used)
        message_content = result["choices"][0]["message"]["content"]

        # Extract JSON from markdown code blocks
        if "```" in message_content:
            lines = message_content.split("\n")
            json_start = None
            json_end = None
            for i, line in enumerate(lines):
                if line.strip().startswith("```") and json_start is None:
                    json_start = i + 1
                elif json_start is not None and line.strip().startswith("```"):
                    json_end = i
                    break

            if json_start is not None and json_end is not None:
                json_str = "\n".join(lines[json_start:json_end])
                try:
                    parsed = json.loads(json_str)
                    record_latency("consultation", started_at, workflow_id, outcome="success")
                    log_event(logging.INFO, "consultation_succeeded", workflow_id=workflow_id,
                              step_count=len(_extract_steps(parsed)))
                    return parsed
                except json.JSONDecodeError:
                    pass

        # Try parsing whole response as JSON
        try:
            parsed = json.loads(message_content)
            record_latency("consultation", started_at, workflow_id, outcome="success")
            log_event(logging.INFO, "consultation_succeeded", workflow_id=workflow_id,
                      step_count=len(_extract_steps(parsed)))
            return parsed
        except json.JSONDecodeError:
            record_latency("consultation", started_at, workflow_id, outcome="parse_error")
            log_event(logging.WARNING, "consultation_parse_failed", workflow_id=workflow_id)
            return {"raw_analysis": message_content, "_parse_error": True}

    except Exception as e:
        record_latency("consultation", started_at, workflow_id, outcome="error")
        log_event(logging.ERROR, "consultation_failed", workflow_id=workflow_id,
                  error_type=type(e).__name__)
        return None


# ============================
# Plan Execution
# ============================

def _extract_steps(plan_response: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Extract step dicts from Consultant's response (multiple formats)."""
    if isinstance(plan_response, list):
        return plan_response

    inner_plan = plan_response.get("plan")
    if isinstance(inner_plan, dict):
        steps_list = inner_plan.get("steps") or inner_plan.get("plan")
        if isinstance(steps_list, list):
            return steps_list

    plan_list = plan_response.get("plan")
    if isinstance(plan_list, list):
        return plan_list

    steps_list = plan_response.get("steps")
    if isinstance(steps_list, list):
        return steps_list

    for key, value in plan_response.items():
        if isinstance(value, list) and value:
            first = value[0]
            if isinstance(first, dict) and ("step" in first or "id" in first or "action" in first):
                return value

    return []


def execute_plan(plan_response: Dict[str, Any], cwd: str = None, original_request: Optional[str] = None) -> Dict[str, Any]:
    """Execute the plan — uses bridge agent for file ops, shell for commands."""
    cwd = cwd or os.getcwd()
    steps = _extract_steps(plan_response)
    results = []

    for step in steps:
        step_num = step.get("step", len(results) + 1)
        action = step.get("action", step.get("command_hint", step.get("command", "")))
        command_hint = step.get("command_hint", step.get("command", ""))
        expected_outcome = step.get("expected_outcome", "")
        is_file_op = step.get("is_file_operation", False) or is_file_operation_task(action, command_hint)

        # If action is empty but we have a command field, use it as the action description
        if not action and command_hint:
            action = command_hint[:200]  # Truncate for display

        # If still empty, check step's description field
        if not action and step.get("description"):
            action = step["description"][:200]

        # If still empty, use original_request as fallback
        if not action and original_request:
            action = original_request[:200]

        # Check for file operation using description field too
        desc = step.get("description", "")
        if not is_file_op and desc:
            is_file_op = is_file_operation_task(desc, "") or bool(_extract_file_path_from_action(desc, cwd))

        # If step has file_path + content but no command_hint, construct a shell command
        if not command_hint and step.get("file_path") and step.get("content"):
            file_path = step["file_path"]
            if not file_path.startswith("/"):
                file_path = str(Path(cwd) / file_path)
            content = step["content"]
            command_hint = f"mkdir -p {Path(file_path).parent} && echo {content!r} > {file_path!r}"
            print(f"  [Executor] ⚡ Constructed shell command from file_path+content: {command_hint[:100]}...")
            is_file_op = True

        # If step has description with a file path but no command_hint, construct shell command
        if not command_hint and desc and not step.get("file_path"):
            file_path_from_desc = _extract_file_path_from_action(desc, cwd)
            if file_path_from_desc:
                # Try to extract content from description too
                content_match = re.search(
                    r'(?:content|ข้อความ|เนื้อหา|with|containing)\s+[\'"]([^\'"]+)[\'"]',
                    desc, re.IGNORECASE
                )
                content = content_match.group(1) if content_match else "Created by Secretary"
                if not file_path_from_desc.startswith("/"):
                    file_path_from_desc = str(Path(cwd) / file_path_from_desc)
                command_hint = f"mkdir -p {Path(file_path_from_desc).parent} && echo {content!r} > {file_path_from_desc!r}"
                print(f"  [Executor] ⚡ Constructed shell command from description: {command_hint[:100]}...")
                is_file_op = True

        print(f"\n[Executor] Step {step_num}: {action}")
        if expected_outcome:
            print(f"  Expected: {expected_outcome}")
        if is_file_op:
            print(f"  🏷️  File operation detected")

        # Execute via shell command if command_hint is provided (explicit command takes priority)
        if command_hint:
            print(f"[Executor] Executing shell command: {command_hint}")
            result = _run_command(command_hint)
            success = "Error:" not in result and result != ""
            results.append({
                "step": step_num,
                "action": action,
                "command": command_hint,
                "success": success,
                "output": result[:500] if result else "",
                "execution_method": "shell",
                "is_file_operation": is_file_op
            })

            if not success:
                print(f"[Executor] ❌ Step {step_num} failed via shell")
                return {
                    "status": "partial_failure",
                    "failed_step": step_num,
                    "error": result,
                    "completed_steps": results
                }

        # Execute file operations via the selected lane (only when no explicit command_hint)
        elif is_file_op:
            if EXECUTION_LANE == "hermes":
                print(f"  🪶  Using Hermes lane for file operation")
                lane_result = run_hermes_lane_task(task=action, cwd=cwd)
                results.append({
                    "step": step_num,
                    "action": action,
                    "command": f"hermes-lane: {action[:100]}",
                    "success": lane_result["success"],
                    "output": lane_result["output"][:500] if lane_result["output"] else "",
                    "execution_method": "hermes_lane",
                    "is_file_operation": True
                })
                if not lane_result["success"]:
                    print(f"[Executor] ❌ Step {step_num} failed via Hermes lane")
                    return {
                        "status": "partial_failure",
                        "failed_step": step_num,
                        "error": lane_result["output"],
                        "completed_steps": results
                    }

                # Verify real side effect: the bridge may silently credit-switch
                # to a tool-less model, so the lane can claim success without
                # writing anything. Fall back to the bridge agent when the
                # expected file is absent.
                expected_path = _extract_file_path_from_action(action, cwd)
                _hermes_fallback_needed = (
                    expected_path is not None
                    and not _file_exists(expected_path)
                    and not _is_delete_action(action.lower())
                )
                if _hermes_fallback_needed:
                    print(f"[Executor] ⚠️  Hermes lane reported success but {expected_path} is missing "
                          f"(likely credit-switched tool-less model); falling back to bridge agent")
                    bridge_result = run_bridge_agent_task(
                        task=action,
                        cwd=cwd,
                        apply=True,
                        bridge_url=AIPASS_BRIDGE_URL,
                        extra_flags=["--slim"] if step.get("is_slim", False) else None
                    )
                    results[-1]["execution_method"] = "hermes_lane+bridge_agent_fallback"
                    results[-1]["output"] += f"\n[bridge fallback] {bridge_result['output'][:300]}"
                    results[-1]["success"] = bridge_result["success"]
                    if not bridge_result["success"]:
                        print(f"[Executor] ❌ Step {step_num} bridge-agent fallback also failed")
                        return {
                            "status": "partial_failure",
                            "failed_step": step_num,
                            "error": bridge_result["output"],
                            "completed_steps": results
                        }
            else:
                print(f"  🏷️  Using bridge agent for file operation")
                bridge_result = run_bridge_agent_task(
                    task=action,
                    cwd=cwd,
                    apply=True,
                    bridge_url=AIPASS_BRIDGE_URL,
                    extra_flags=["--slim"] if step.get("is_slim", False) else None
                )

                results.append({
                    "step": step_num,
                    "action": action,
                    "command": f"bridge-agent: {action[:100]}",
                    "success": bridge_result["success"],
                    "output": bridge_result["output"][:500] if bridge_result["output"] else "",
                    "execution_method": "bridge_agent",
                    "is_file_operation": True
                })

                if not bridge_result["success"]:
                    print(f"[Executor] ❌ Step {step_num} failed via bridge agent")
                    return {
                        "status": "partial_failure",
                        "failed_step": step_num,
                        "error": bridge_result["output"],
                        "completed_steps": results
                    }

                # Post-execution verification for DELETE: if bridge says success but file still exists, fallback to shell
                if _is_delete_action(action.lower()):
                    file_path = _extract_file_path_from_action(action, cwd)
                    if file_path and _file_exists(file_path):
                        print(f"[Executor] ⚠️  Bridge reported success but file still exists, trying shell fallback...")
                        delete_result = _run_command(f'rm -f {file_path!r}')
                        # rm -f returns empty output on success, so check if file is actually gone
                        success = not _file_exists(file_path)
                        if success:
                            print(f"[Executor] ✅ Shell fallback succeeded in deleting file")
                            results[-1]["output"] += " | Shell fallback: deleted"
                        else:
                            print(f"[Executor] ❌ Shell fallback also failed")
                            return {
                                "status": "partial_failure",
                                "failed_step": step_num,
                                "error": f"Bridge reported success but file not deleted, shell fallback failed",
                                "completed_steps": results
                            }

        # No command — try bridge agent if file op, else log
        elif is_file_op and _check_bridge_available():
            bridge_result = run_bridge_agent_task(
                task=action,
                cwd=cwd,
                apply=True,
                bridge_url=AIPASS_BRIDGE_URL
            )

            results.append({
                "step": step_num,
                "action": action,
                "command": f"bridge-agent (no command_hint): {action[:100]}",
                "success": bridge_result["success"],
                "output": bridge_result["output"][:500] if bridge_result["output"] else "",
                "execution_method": "bridge_agent",
                "is_file_operation": True
            })

            if not bridge_result["success"]:
                print(f"[Executor] ❌ Step {step_num} failed via bridge agent")
                return {
                    "status": "partial_failure",
                    "failed_step": step_num,
                    "error": bridge_result["output"],
                    "completed_steps": results
                }

        else:
            # Fallback: if file operation detected but no bridge, try shell to create file
            if is_file_op:
                print(f"[Executor] ⚠️  Bridge not available, trying shell fallback for file operation")
                # Try to extract file path and create via shell
                file_path = _extract_file_path_from_action(action, cwd)
                action_lower = action.lower()
                
                if file_path and _is_create_action(action_lower):
                    # Create directory if needed
                    dir_path = str(Path(file_path).parent)
                    if dir_path and dir_path != '.':
                        mkdir_result = _run_command(f"mkdir -p {dir_path}")
                    # Create file with basic content
                    content_match = re.search(r'(?:ข้อความ|เนื้อหา|content|with|containing)\s+([^\n]+)', action, re.IGNORECASE)
                    content = content_match.group(1).strip() if content_match else "Created by Secretary"
                    create_result = _run_command(f'echo {content!r} > {file_path!r}')
                    success = "Error:" not in create_result and create_result != ""
                    results.append({
                        "step": step_num,
                        "action": action,
                        "command": f"shell fallback: echo ... > {file_path}",
                        "success": success,
                        "output": create_result[:500] if create_result else "",
                        "execution_method": "shell",
                        "is_file_operation": True
                    })
                    if not success:
                        print(f"[Executor] ❌ Step {step_num} failed via shell fallback")
                        return {
                            "status": "partial_failure",
                            "failed_step": step_num,
                            "error": create_result,
                            "completed_steps": results
                        }
                    continue
                
                elif file_path and _is_delete_action(action_lower):
                    # Delete file via shell
                    delete_result = _run_command(f'rm -f {file_path!r}')
                    success = "Error:" not in delete_result and delete_result != ""
                    results.append({
                        "step": step_num,
                        "action": action,
                        "command": f"shell fallback: rm -f {file_path}",
                        "success": success,
                        "output": delete_result[:500] if delete_result else "",
                        "execution_method": "shell",
                        "is_file_operation": True
                    })
                    if not success:
                        print(f"[Executor] ❌ Step {step_num} failed via shell fallback (DELETE)")
                        return {
                            "status": "partial_failure",
                            "failed_step": step_num,
                            "error": delete_result,
                            "completed_steps": results
                        }
                    continue

            results.append({
                "step": step_num,
                "action": action,
                "command": None,
                "success": True,
                "output": "Action noted (no command to execute)",
                "execution_method": "logged",
                "is_file_operation": is_file_op  # Always include this!
            })

    return {
        "status": "success",
        "completed_steps": results,
        "total_steps": len(steps)
    }


# ============================
# Automated Verification
# ============================

def verify_execution_result(
    plan: Optional[Dict[str, Any]],
    execution_result: Dict[str, Any],
    cwd: Optional[str] = None,
    original_request: Optional[str] = None
) -> Dict[str, Any]:
    """
    Verify that the execution result matches the expected outcome.
    ALWAYS called after execution.
    """
    cwd = cwd or os.getcwd()

    verification = {
        "verified": True,
        "details": [],
        "failures": []
    }

    if execution_result.get("status") != "success":
        verification["verified"] = False
        verification["failures"].append({
            "type": "execution_failed",
            "message": f"Execution status: {execution_result.get('status')}",
            "step": None
        })
        return verification

    for step_result in execution_result.get("completed_steps", []):
        step_num = step_result.get("step")
        
        # Find the corresponding plan step to get extra fields (file_path, content, description, etc.)
        plan_step = None
        plan_steps = _extract_steps(plan) if plan else []
        for ps in plan_steps:
            if ps.get("step") == step_num:
                plan_step = ps
                break
        
        # Build the step dict from execution result, enriched with plan step extra fields
        step = {
            "step_num": step_num,
            "action": step_result.get("action", ""),
            "command": step_result.get("command", ""),
            "success": step_result.get("success", False),
            "execution_method": step_result.get("execution_method", "unknown"),
            "is_file_operation": step_result.get("is_file_operation", False),
            # Enriched from plan step
            "file_path": plan_step.get("file_path") if plan_step else None,
            "content": plan_step.get("content") if plan_step else None,
            "description": plan_step.get("description") if plan_step else None,
        }

        # Derive effective action text from execution result + plan step + original request
        effective_action = step_result.get("action", "")
        if not effective_action and plan_step:
            effective_action = plan_step.get("action", "")
        if not effective_action and step_result.get("description"):
            effective_action = step_result["description"]
        if not effective_action and original_request:
            effective_action = original_request

        detail = {
            "step": step_num,
            "action": effective_action,
            "verified": True,
            "notes": []
        }

        if not step_result.get("success", False):
            detail["verified"] = False
            detail["notes"].append(f"Execution failed: {step_result.get('error', 'unknown')}")
            verification["failures"].append({
                "type": "execution_failure",
                "step": step["step_num"],
                "message": f"Step {step['step_num']} ({step['action']}) failed during execution"
            })
            continue

        # For file operations, verify actual file state
        if step.get("is_file_operation") or step.get("execution_method") == "bridge_agent":
            action_for_path = step["action"] if step["action"] else None
            # First try to extract from command_hint (which was updated with new paths)
            command_hint = step.get("command", "") or step_result.get("command", "")
            file_path = None
            if command_hint:
                file_path = _extract_path_from_string(command_hint, cwd)
            
            # If still no path, try the action string
            if not file_path and action_for_path:
                file_path = _extract_file_path_from_action(action_for_path or "", cwd, original_request)
            
            # If still no path, check the plan step's file_path field directly
            if not file_path and step.get("file_path"):
                file_path = step["file_path"]
            
            # If still no path, try the description field
            if not file_path and step.get("description"):
                file_path = _extract_file_path_from_action(step["description"], cwd, original_request)
            
            # If still no path and we have content (CREATE case), try to extract from content
            if not file_path and step.get("content"):
                # content might contain a path reference, but unlikely — skip
                pass

            if file_path:
                # Determine action type: prefer effective_action, fall back to original_request
                # Also check parameters.task from the plan step (for bridge agent actions)
                action_for_type = effective_action.lower() if effective_action else ""
                if not action_for_type and original_request:
                    action_for_type = original_request.lower()
                # Check parameters.task for bridge agent actions
                if not action_for_type and step.get("parameters", {}).get("task"):
                    action_for_type = step["parameters"]["task"].lower()
                # Also check plan step's parameters.task
                if not action_for_type and plan_step and plan_step.get("parameters", {}).get("task"):
                    action_for_type = plan_step["parameters"]["task"].lower()
                
                if _is_create_action(action_for_type):
                    if _file_exists(file_path):
                        detail["notes"].append(f"File {file_path} exists as expected (CREATE)")
                    else:
                        detail["verified"] = False
                        detail["notes"].append(f"File {file_path} NOT found after CREATE")
                        verification["failures"].append({
                            "type": "file_not_found_after_create",
                            "step": step["step_num"],
                            "expected": "file exists",
                            "actual": "file not found",
                            "path": file_path
                        })

                elif _is_update_action(action_for_type):
                    if _file_exists(file_path):
                        try:
                            content = _read_file(file_path)
                            detail["notes"].append(f"File {file_path} exists, content length: {len(content)}")
                        except Exception as e:
                            detail["verified"] = False
                            detail["notes"].append(f"Error reading file: {e}")
                            verification["failures"].append({
                                "type": "file_read_error",
                                "step": step["step_num"],
                                "path": file_path,
                                "message": str(e)
                            })
                    else:
                        detail["verified"] = False
                        detail["notes"].append(f"File {file_path} NOT found after UPDATE")
                        verification["failures"].append({
                            "type": "file_not_found_after_update",
                            "step": step["step_num"],
                            "path": file_path
                        })

                elif _is_delete_action(action_for_type):
                    if not _file_exists(file_path):
                        detail["notes"].append(f"File {file_path} successfully deleted (DELETE)")
                    else:
                        detail["verified"] = False
                        detail["notes"].append(f"File {file_path} still exists after DELETE")
                        verification["failures"].append({
                            "type": "file_not_deleted",
                            "step": step["step_num"],
                            "path": file_path
                        })
                else:
                    # Path found but can't determine action type — still check file exists
                    if _file_exists(file_path):
                        detail["notes"].append(f"File {file_path} exists (action type unknown)")
                    else:
                        detail["verified"] = False
                        detail["notes"].append(f"File {file_path} not found (action type unknown)")

            if not detail["notes"]:
                detail["notes"].append("ไม่พบการระบุ file path ใน action — ตรวจสอบด้วยวิธีอื่น")

        verification["details"].append(detail)

    verification["verified"] = len(verification["failures"]) == 0
    return verification


def _is_create_action(action_lower: str) -> bool:
    """Check if action implies file creation."""
    keywords = ["สร้าง", "create", "ใหม่", "make", "write", "ใหม่"]
    return any(kw in action_lower for kw in keywords)


def _is_update_action(action_lower: str) -> bool:
    """Check if action implies file modification."""
    keywords = ["แก้ไข", "update", "edit", "modify", "เปลี่ยน", "update", "แก้"]
    return any(kw in action_lower for kw in keywords)


def _is_delete_action(action_lower: str) -> bool:
    """Check if action implies file deletion."""
    keywords = ["ลบ", "delete", "remove", "ลบออก", "ลบ"]
    return any(kw in action_lower for kw in keywords)


def _file_exists(path: str) -> bool:
    """Check if file exists."""
    return Path(path).exists()


def _read_file(path: str, encoding: str = "utf-8") -> str:
    """Read file contents."""
    return Path(path).read_text(encoding=encoding)


def _extract_file_path_from_action(action: str, cwd: str, original_request: Optional[str] = None) -> Optional[str]:
    """Extract file path from action string (heuristic).
    
    If original_request is provided and action path doesn't match, try extracting from original_request.
    """
    # First try the action string
    path = _extract_path_from_string(action, cwd)
    if path:
        return path
    
    # If original_request provided and we didn't find path in action, try original request
    if original_request:
        path = _extract_path_from_string(original_request, cwd)
        if path:
            return path
    
    return None


def _extract_path_from_string(text: str, cwd: str) -> Optional[str]:
    """Extract file path from a text string using patterns."""
    # Pattern WITHOUT leading slash FIRST - avoids matching slash in middle of path
    patterns = [
        r'([\w\-./]+\.(py|js|ts|json|md|txt|css|html))',
        r'(/[\w\-./]+\.(py|js|ts|json|md|txt|css|html))',
    ]

    for pattern in patterns:
        matches = re.findall(pattern, text, re.IGNORECASE)
        for match in matches:
            path = match[0] if isinstance(match, tuple) else match

            if path and not path.startswith('/'):
                full_path = str(Path(cwd) / path)
                if _file_exists(full_path) or path.endswith(('.py', '.js', '.ts', '.json', '.md', '.txt', '.css', '.html')):
                    return full_path
                return path

            if path and path.startswith('/'):
                return path

    path_pattern = r'([\w./\-]+\.(py|js|ts|json|md|txt|css|html|yml|yaml))'
    matches = re.findall(path_pattern, text, re.IGNORECASE)

    for match in matches:
        path = match[0] if isinstance(match, tuple) else match

        if path and not path.startswith('/'):
            full_path = str(Path(cwd) / path)
            if _file_exists(full_path):
                return full_path
            return path
        elif path:
            return path

    return None


# ============================
# Skill Library Management
# ============================

def _update_plan_paths(plan: Dict[str, Any], new_cwd: str, original_request: str) -> Dict[str, Any]:
    """Update file paths in a plan to use the current working directory."""
    if not plan:
        return plan
    
    import copy
    plan = copy.deepcopy(plan)
    
    steps = plan.get("plan", [])
    for step in steps:
        # Update command_hint to use new cwd
        command_hint = step.get("command_hint", "")
        if command_hint:
            # Replace old paths with new ones
            # First, extract the file path from the original request
            new_file_path = _extract_file_path_from_action(original_request, new_cwd)
            if new_file_path:
                # Find old file path in command_hint and replace
                # We need to find the full old path in the command_hint
                old_file_path = None
                
                # Try to extract old path from command_hint - look for paths with the same filename
                import re
                # Pattern to match full paths in command_hint
                path_pattern = r'([\w\-./]+?/[\w\-./]+\.(py|js|ts|json|md|txt|css|html))'
                path_matches = re.findall(path_pattern, command_hint, re.IGNORECASE)
                for match in path_matches:
                    if isinstance(match, tuple):
                        old_file_path = match[0]
                    else:
                        old_file_path = match
                    break
                
                # Also try absolute paths
                if not old_file_path:
                    abs_pattern = r'(/[\w\-./]+\.(py|js|ts|json|md|txt|css|html))'
                    abs_matches = re.findall(abs_pattern, command_hint, re.IGNORECASE)
                    for match in abs_matches:
                        if isinstance(match, tuple):
                            old_file_path = match[0]
                        else:
                            old_file_path = match
                        break
                
                if old_file_path:
                    # Replace the old path with the new path
                    command_hint = command_hint.replace(old_file_path, new_file_path)
                    step["command_hint"] = command_hint
    
    return plan


def load_skill(request: str) -> Optional[Dict[str, Any]]:
    """Load a saved skill for this request, if exists (strict match).

    Matching rules:
    - Must match operation type (create/update/delete)
    - Must have the same file path OR same filename in same parent dir
    - Then score by significant word overlap (excluding common terms)
    """
    request_lower = request.lower()
    skill_files = list(SKILLS_DIR.glob("*.json"))

    best_match = None
    best_score = 0

    # Detect operation type from request
    def get_operation_type(text: str) -> str:
        text = text.lower()
        if any(kw in text for kw in ["สร้าง", "create", "ใหม่", "make", "write"]):
            return "create"
        if any(kw in text for kw in ["แก้ไข", "update", "edit", "modify", "เปลี่ยน", "แก้"]):
            return "update"
        if any(kw in text for kw in ["ลบ", "delete", "remove", "ลบออก"]):
            return "delete"
        return "other"

    def get_filename_from_path(path: str) -> str:
        """Extract just the filename from a path."""
        return Path(path).name if path else ""

    request_op = get_operation_type(request)
    request_path = _extract_file_path_from_action(request, os.getcwd())
    request_filename = get_filename_from_path(request_path) if request_path else ""

    # Common irrelevant terms to exclude from scoring
    common_exclude = {
        "ไฟล์", "file", "พร้อม", "ข้อความ", "เนื้อหา", "content",
        "create", "สร้าง", "แก้ไข", "update", "edit", "modify",
        "delete", "ลบ", "remove", "ลบออก", "โดย", "เป็น", "เปลี่ยน",
        "และ", "ด้วย", "ให้", "แก้", "เพิ่ม", "ใหม่", "make", "write"
    }

    for skill_file in skill_files:
        try:
            skill_data = json.loads(skill_file.read_text(encoding="utf-8"))
            # Keep the original case for path extraction; lowering a request
            # would corrupt paths on case-sensitive path components (macOS temp
            # dirs contain e.g. "/T/"), breaking exact-path skill matching.
            skill_name = skill_data.get("request", "")
            skill_name_lower = skill_name.lower()

            # Must match operation type first
            skill_op = get_operation_type(skill_name_lower)
            if request_op != skill_op:
                continue

            skill_path = _extract_file_path_from_action(skill_name, os.getcwd())
            skill_filename = get_filename_from_path(skill_path) if skill_path else ""

            if request_path and skill_path:
                # Path exact match = best case
                if request_path == skill_path:
                    pass  # continue to scoring
                elif request_filename and skill_filename and request_filename == skill_filename:
                    # Different dirs but same filename — allow only for file ops
                    # if parent dirs are the same (same project/workspace)
                    req_parent = str(Path(request_path).parent)
                    skill_parent = str(Path(skill_path).parent)
                    if req_parent != skill_parent:
                        continue
                else:
                    # Different paths AND different filenames — no match
                    continue

            # Score by significant word overlap (exclude common terms)
            request_words = set(request_lower.split())
            skill_words = set(skill_name_lower.split())
            common = request_words & skill_words
            common_filtered = common - common_exclude

            if len(common_filtered) > best_score:
                best_score = len(common_filtered)
                best_match = skill_data
        except Exception:
            continue

    if best_match and best_score >= 1:
        return best_match

    return None


def save_skill(request: str, plan: Dict[str, Any],
               execution_meta: Dict[str, Any] = None) -> Path:
    """Save a skill to the skill library."""
    execution_meta = execution_meta or {}

    skill_data = {
        "request": request,
        "plan": plan,
        "execution_meta": execution_meta,
        "created_at": _run_command("date -u +'%Y-%m-%dT%H:%M:%SZ'"),
        "version": 1
    }

    # Sanitize filename: replace all non-ASCII and special chars
    # Use only alphanumeric, dash, underscore
    safe_name = re.sub(r'[^a-zA-Z0-9\-_]', '_', request.lower())[:100]
    # Further sanitize: remove consecutive underscores, trim
    safe_name = re.sub(r'_+', '_', safe_name).strip('_')
    skill_file = SKILLS_DIR / f"{safe_name}.json"

    counter = 1
    while skill_file.exists():
        skill_file = SKILLS_DIR / f"{safe_name}_{counter}.json"
        counter += 1

    skill_file.write_text(
        json.dumps(skill_data, indent=2, ensure_ascii=False),
        encoding="utf-8"
    )

    return skill_file


def save_successful_skill(
    request: str,
    plan: Dict[str, Any],
    execution_result: Dict[str, Any],
    verification_result: Dict[str, Any]
) -> Optional[Path]:
    """Save skill only if execution and verification both passed."""
    if not verification_result.get("verified", False):
        log.info("ไม่บันทึก skill เพราะ verification ล้มเหลว")
        return None

    if execution_result.get("status") != "success":
        log.info("ไม่บันทึก skill เพราะ execution ไม่สำเร็จ")
        return None

    try:
        path = save_skill(request, plan, {
            "exec_status": execution_result.get("status"),
            "total_steps": execution_result.get("total_steps", 0),
            "all_steps_success": all(
                s.get("success", False)
                for s in execution_result.get("completed_steps", [])
            ),
            "verification_passed": True,
            "saved_at": _run_command("date -u +'%Y-%m-%dT%H:%M:%SZ'").strip()
        })
        log.info(f"บันทึก skill ลง {path.name}")
        return path
    except Exception as e:
        log.error(f"ไม่สามารถบันทึก skill: {e}")
        return None


# ============================
# Self-Healing (Re-consultation)
# ============================

def self_heal(original_request: str, failed_step: Dict[str, Any], context: Dict[str, Any],
              workflow_id: Optional[str] = None, attempt: Optional[int] = None) -> Optional[Dict[str, Any]]:
    """
    If execution fails, ask Consultant for an alternative approach.
    Uses .format() to avoid f-string issues with Thai characters.
    """
    step_num = failed_step.get('step', '?')
    action = failed_step.get('action', '?')
    command_hint = failed_step.get('command_hint', '?')
    error = failed_step.get('output', 'Unknown error')
    execution_method = failed_step.get('execution_method', 'unknown')

    heal_request = (
        "The following step failed during execution:\n\n"
        f"Step: {step_num} - {action}\n"
        f"Command: {command_hint}\n"
        f"Error: {error}\n"
        f"Execution method: {execution_method}\n\n"
        f"Original request: {original_request}\n\n"
        "Please provide an alternative approach or fix for this specific step.\n"
        "Return JSON with:\n"
        "{\n"
        '  "alternative_plan": [{"step": 1, "action": "...", "command_hint": "...", '
        '"expected_outcome": "...", "is_file_operation": true/false}],\n'
        '  "explanation": "Why this approach is different/better",\n'
        '  "risk_assessment": "assessment of the alternative"\n'
        "}"
    )

    heal_payload = {
        "model": ACTIVE_CONSULTANT_MODEL,
        "messages": [
            {
                "role": "system",
                "content": "You are a Consulting Engineer helping to fix a failed step in an autonomous agent workflow. Analyze the failure and provide an alternative approach as JSON."
            },
            {"role": "user", "content": heal_request}
        ],
        "max_tokens": 2048,
        "temperature": 0.4
    }

    started_at = time.monotonic()
    log_event(logging.WARNING, "self_heal_started", workflow_id=workflow_id, attempt=attempt,
              failed_step=step_num, execution_method=execution_method)

    try:
        import requests
        response = requests.post(
            f"{AIPASS_BRIDGE_URL}/v1/chat/completions",
            json=heal_payload,
            timeout=60
        )
        response.raise_for_status()
        result = response.json()
        switch_info = detect_model_switch(result)
        if switch_info:
            notify_model_switch(switch_info, CONSULTANT_MODEL, workflow_id)
        message = result["choices"][0]["message"]["content"]

        # Extract JSON
        try:
            if "```" in message:
                start = message.find("```") + 3
                end = message.find("```", start)
                json_str = message[start:end].strip()
                if json_str.startswith("json"):
                    json_str = json_str[4:].strip()
                parsed = json.loads(json_str)
            else:
                parsed = json.loads(message)
            record_latency("self_heal", started_at, workflow_id, attempt=attempt, outcome="success")
            log_event(logging.INFO, "self_heal_plan_received", workflow_id=workflow_id, attempt=attempt,
                      step_count=len(parsed.get("alternative_plan", [])))
            return parsed
        except (TypeError, json.JSONDecodeError):
            record_latency("self_heal", started_at, workflow_id, attempt=attempt, outcome="parse_error")
            log_event(logging.WARNING, "self_heal_parse_failed", workflow_id=workflow_id, attempt=attempt)
            return {"raw_alternative": message, "_parse_error": True}

    except Exception as e:
        record_latency("self_heal", started_at, workflow_id, attempt=attempt, outcome="error")
        log_event(logging.ERROR, "self_heal_failed", workflow_id=workflow_id, attempt=attempt,
                  error_type=type(e).__name__)
        return None


# ============================
# Main Workflow — Secretary Orchestration
# ============================

def _is_valid_plan_response(plan_response: Any) -> bool:
    """A consultant response is usable only when it yields executable steps."""
    if not isinstance(plan_response, dict):
        return False
    if plan_response.get("_parse_error"):
        return False
    return len(_extract_steps(plan_response)) > 0


def _extract_alternative_steps(alternative: Any) -> List[Dict[str, Any]]:
    """Extract actionable steps from a self-heal response, or [] when malformed."""
    if not isinstance(alternative, dict) or alternative.get("_parse_error"):
        return []
    steps = alternative.get("alternative_plan")
    if not isinstance(steps, list):
        return []
    return [
        s for s in steps
        if isinstance(s, dict) and (s.get("action") or s.get("command_hint") or s.get("command"))
    ]


def _locate_failed_step(execution_result: Dict[str, Any],
                        verification_result: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Find the first failed step dict from execution or verification results."""
    if execution_result.get("status") != "success":
        failed_step_num = execution_result.get("failed_step")
    else:
        failed_step_num = None
        for detail in verification_result.get("details", []):
            if not detail.get("verified", False):
                failed_step_num = detail.get("step")
                break

    if failed_step_num is None:
        return None
    try:
        idx = int(failed_step_num) - 1
    except (TypeError, ValueError):
        return None
    steps = execution_result.get("completed_steps", [])
    if 0 <= idx < len(steps):
        return steps[idx]
    return None


# ============================
# Primary-Brain Workflow (second brain loop)
# ============================

def build_turn_message(request: str, context: Dict[str, Any], *,
                       intro: bool = False,
                       last_steps: Optional[List[Dict[str, Any]]] = None,
                       exec_result: Optional[Dict[str, Any]] = None,
                       verif_result: Optional[Dict[str, Any]] = None,
                       answers: Optional[Dict[str, str]] = None) -> str:
    """Serialize one Secretary→Primary turn, bounded to the char limit."""
    parts: List[str] = []
    if intro:
        parts.append(BRAIN_PROTOCOL_INTRO)
        parts.append(f"Original request:\n{request}")
        slim = {k: context.get(k) for k in
                ("cwd", "os_info", "python_version", "relevant_files", "bridge_available")
                if context.get(k) is not None}
        parts.append("Machine context:\n" + json.dumps(slim, ensure_ascii=False, default=str))
    if last_steps is not None:
        parts.append("Steps you instructed:\n" + json.dumps(
            [{k: s.get(k) for k in ("step", "action", "is_file_operation") if k in s}
             for s in last_steps], ensure_ascii=False))
    if exec_result is not None:
        brief = {"status": exec_result.get("status"),
                 "total_steps": exec_result.get("total_steps")}
        per_step = []
        for s in exec_result.get("completed_steps", []):
            per_step.append({"step": s.get("step"), "success": s.get("success"),
                             "method": s.get("execution_method"),
                             "output_tail": (s.get("output") or "")[-300:]})
        brief["steps"] = per_step
        if exec_result.get("error"):
            brief["error"] = str(exec_result["error"])[:500]
        parts.append("Execution report:\n" + json.dumps(brief, ensure_ascii=False, default=str))
    if verif_result is not None:
        brief = {"verified": verif_result.get("verified"),
                 "failures": verif_result.get("failures", [])}
        parts.append("Verification report:\n" + json.dumps(brief, ensure_ascii=False, default=str))
    if answers:
        parts.append("Answers to your questions:\n" + json.dumps(answers, ensure_ascii=False))
    message = "\n\n".join(parts)
    if len(message) > PRIMARY_BRAIN_TURN_CHAR_LIMIT:
        keep = PRIMARY_BRAIN_TURN_CHAR_LIMIT
        message = (message[:keep // 2] + "\n...[middle truncated]...\n"
                   + message[-keep // 2:])
    return message


def _gather_question_answers(questions: List[str], cwd: str,
                             context: Dict[str, Any]) -> Dict[str, str]:
    """Best-effort answers to Primary's questions: read mentioned files; else say so."""
    answers: Dict[str, str] = {}
    for question in questions:
        text = str(question)
        found = False
        # Paths named explicitly by the brain first, then any token that exists.
        candidates = []
        explicit = _extract_file_path_from_action(text, cwd)
        if explicit:
            candidates.append(explicit)
        candidates.extend(re.findall(r'[\w./\-]+', text))
        for candidate_path in candidates:
            if not candidate_path or not candidate_path.startswith("/"):
                candidate_path = os.path.join(cwd, candidate_path or "")
            if os.path.isfile(candidate_path):
                try:
                    body = _read_file(candidate_path)[:2000]
                    answers[text] = f"file {candidate_path} (first 2000 chars):\n{body}"
                except Exception as e:
                    answers[text] = f"file {candidate_path} unreadable: {type(e).__name__}"
                found = True
                break
        if not found:
            answers[text] = ("No file matched this question automatically. Available files "
                             f"(up to 50): {context.get('relevant_files', [])[:50]}. "
                             "Issue an instruction with a shell command_hint if you need specific output.")
    return answers


def run_primary_brain_workflow(user_request: str, cwd: str = None) -> Dict[str, Any]:
    """Second-brain loop: dialogue with the Primary brain, execute its decisions."""
    cwd = cwd or os.getcwd()
    workflow_id = uuid.uuid4().hex[:12]
    started = time.monotonic()
    context = gather_context(user_request, cwd)

    # Skill reuse skips the brain entirely.
    saved_skill = load_skill(user_request)
    if saved_skill and saved_skill.get("plan"):
        print("[Secretary] ♻️  Reusing saved skill; skipping Primary brain loop")
        plan = _update_plan_paths(saved_skill["plan"], cwd, user_request)
        execution_result = execute_plan(plan, cwd, user_request)
        verification_result = verify_execution_result(plan, execution_result, cwd, user_request)
        if verification_result.get("verified") and execution_result.get("status") == "success":
            return {"status": "success", "plan": plan, "execution": execution_result,
                    "verification": verification_result, "context": context,
                    "consultation_used": False, "skill_reused": True, "skill_saved": False,
                    "saved_path": None, "orchestration": "primary", "turns": 0,
                    "brain_switched": False, "escalated": False}
        result = run_secrets_workflow(user_request, cwd)
        result["orchestration"] = "legacy_fallback"
        result["skill_reused"] = True
        return result

    if not context.get("bridge_available"):
        print("[Secretary] ℹ️  Bridge unavailable; falling back to legacy workflow")
        result = run_secrets_workflow(user_request, cwd)
        result["orchestration"] = "legacy_fallback"
        return result

    if brain_new_conversation(workflow_id) is None:
        print("[Secretary] ℹ️  Primary brain unavailable; falling back to legacy workflow")
        result = run_secrets_workflow(user_request, cwd)
        result["orchestration"] = "legacy_fallback"
        return result

    escalated = False
    brain_switched = False
    aggregate_steps: List[Dict[str, Any]] = []
    last_exec = last_verif = None
    message = build_turn_message(user_request, context, intro=True)

    for turn in range(1, PRIMARY_BRAIN_MAX_TURNS + 1):
        log_event(logging.INFO, "brain_turn_started", workflow_id=workflow_id, turn=turn)
        response = brain_turn(message, workflow_id)
        if response["error"]:
            response = brain_turn(BRAIN_PROTOCOL_REMINDER + "\n\n" + message, workflow_id)
            if response["error"]:
                print("[PrimaryBrain] ❌ Bridge unreachable twice; falling back to legacy workflow")
                result = run_secrets_workflow(user_request, cwd)
                result["orchestration"] = "legacy_fallback"
                result["brain_turns_attempted"] = turn
                return result

        if response["switch"]:
            brain_switched = True
            if (PRIMARY_BRAIN_ON_SWITCH == "escalate" and not escalated
                    and response["switch"].get("reason") == "credit_not_enough"):
                print("[PrimaryBrain] ⏫ Escalating remaining planning to Nous consultant chain")
                escalated = True
                plan = call_consultant(user_request, context, workflow_id=workflow_id)
                if plan is not None and _is_valid_plan_response(plan):
                    execution_result = execute_plan(plan, cwd, user_request)
                    verification_result = verify_execution_result(plan, execution_result, cwd, user_request)
                    if verification_result.get("verified") and execution_result.get("status") == "success":
                        save_successful_skill(user_request, plan, execution_result, verification_result)
                        return {"status": "success", "plan": plan,
                                "execution": execution_result, "verification": verification_result,
                                "context": context, "consultation_used": True,
                                "skill_reused": False,
                                "skill_saved": verification_result.get("verified", False),
                                "saved_path": None, "orchestration": "primary",
                                "turns": turn, "brain_switched": True, "escalated": True,
                                "elapsed_s": round(time.monotonic() - started, 3)}
                    result = run_secrets_workflow(user_request, cwd)
                    result["orchestration"] = "legacy_fallback"
                    result["escalated"] = True
                    result["brain_switched"] = True
                    return result
                print("[PrimaryBrain] ⚠️  Escalated planning unavailable; falling back to legacy workflow")
                result = run_secrets_workflow(user_request, cwd)
                result["orchestration"] = "legacy_fallback"
                result["escalated"] = True
                return result
            # PRIMARY_BRAIN_ON_SWITCH == "continue" → keep dialoguing with the
            # switched (weaker) brain; nothing to do here.

        parsed = parse_brain_response(response["content"])
        if parsed is None:
            message = BRAIN_PROTOCOL_REMINDER
            continue

        kind = parsed.get("type")
        if kind == "question":
            print(f"[PrimaryBrain] ❓ Primary asks: {parsed.get('questions')}")
            answers = _gather_question_answers(parsed.get("questions", []), cwd, context)
            message = build_turn_message(user_request, context, answers=answers)
            continue

        if kind == "instruction":
            steps = parsed.get("steps", [])
            plan = {"goal": parsed.get("analysis") or user_request, "plan": steps}
            last_steps = steps
            print(f"[PrimaryBrain] 📋 Instruction received: {len(steps)} step(s)")
            execution_result = execute_plan(plan, cwd, user_request)
            verification_result = verify_execution_result(plan, execution_result, cwd, user_request)
            last_exec, last_verif = execution_result, verification_result
            aggregate_steps.extend(steps)
            if verification_result.get("verified") and execution_result.get("status") == "success":
                print("[PrimaryBrain] ✅ Steps verified; reporting back for next decision")
                save_successful_skill(user_request, plan, execution_result, verification_result)
                message = build_turn_message(user_request, context, last_steps=last_steps,
                                             exec_result=execution_result,
                                             verif_result=verification_result)
            else:
                print("[PrimaryBrain] ❌ Steps failed verification; reporting failures")
                message = build_turn_message(user_request, context, last_steps=last_steps,
                                             exec_result=execution_result,
                                             verif_result=verification_result)
            continue

        if kind == "done":
            summary = parsed.get("summary", "")
            print(f"[PrimaryBrain] 🏁 Primary declared done: {summary[:200]}")
            return {"status": "success", "plan": {"goal": user_request,
                                                 "plan": aggregate_steps},
                    "execution": last_exec, "verification": last_verif,
                    "context": context, "consultation_used": False,
                    "skill_reused": False, "skill_saved": False, "saved_path": None,
                    "orchestration": "primary", "turns": turn,
                    "brain_switched": brain_switched, "escalated": escalated,
                    "brain_summary": summary,
                    "elapsed_s": round(time.monotonic() - started, 3)}

    print("[PrimaryBrain] ⏹️  Turn budget exhausted; falling back to legacy workflow")
    result = run_secrets_workflow(user_request, cwd)
    result["orchestration"] = "legacy_fallback"
    result["turn_budget_exhausted"] = True
    return result


def run_secrets_workflow(user_request: str, cwd: str = None) -> Dict[str, Any]:
    """
    Complete Secretary workflow:
    1. Gather context
    2. Check for saved skill (Skill Reuse) — use if found (never re-saved)
    3. Consult Sonnet 5 (if needed, unless saved skill exists)
    4. Execute plan
    5. **Verify execution result** (ALWAYS — Automated Verification)
    6. Save skill if successful and the plan was NOT reused (Skill Library)
    7. Self-heal with at most MAX_HEAL_ATTEMPTS valid alternative plans,
       then return a structured degradation result
    """
    workflow_id = uuid.uuid4().hex[:12]
    workflow_started = time.monotonic()
    cwd = cwd or os.getcwd()

    def finish(result: Dict[str, Any]) -> Dict[str, Any]:
        result["workflow_id"] = workflow_id
        record_latency("workflow_total", workflow_started, workflow_id,
                       outcome=result.get("status", "unknown"))
        log_event(logging.INFO, "workflow_completed", workflow_id=workflow_id,
                  status=result.get("status", "unknown"))
        return result

    # Initialize tracking
    needs_consult = False
    saved_skill = None
    saved_path = None

    print(f"\n{'='*60}")
    print(f"[Secretary] Starting workflow for: {user_request}")
    print(f"[Secretary] CWD: {cwd}")
    print(f"{'='*60}\n")
    log_event(logging.INFO, "workflow_started", workflow_id=workflow_id)

    # Step 1: Gather context
    print("[Secretary] 📋 Gathering context...")
    context = gather_context(user_request, cwd)
    print(f"[Secretary] Context gathered: {len(context.get('relevant_files', []))} files found")
    print(f"[Secretary] Bridge available: {context.get('bridge_available', False)}")

    # Step 2: Check for saved skill (Skill Reuse)
    print("\n[Secretary] 🔎 Checking for saved skill...")
    saved_skill = load_skill(user_request)
    if saved_skill:
        print(f"[Secretary] ✅ Found saved skill — reusing instead of consulting")
        print(f"[Secretary] Skill request: {saved_skill.get('request', 'N/A')}")
        plan = saved_skill.get("plan")
        # Update plan file paths to use current cwd
        plan = _update_plan_paths(plan, cwd, user_request)
    else:
        print("[Secretary] ℹ️  No saved skill found — will consult if needed")
        plan = None

    # Step 3: Decide if consultation needed (unless using saved skill)
    print("\n[Secretary] 🔍 Deciding whether to consult...")
    if not saved_skill:
        needs_consult = should_consult(user_request)
    print(f"[Secretary] Consultation needed: {needs_consult}")

    # Consult if no saved skill AND consultation is needed
    if not saved_skill and needs_consult:
        print(f"\n[Secretary] 🤔 Consulting Sonnet 5 via {AIPASS_BRIDGE_URL}...")
        plan = call_consultant(user_request, context, workflow_id=workflow_id)

        if plan is None:
            print("[Secretary] ❌ Consultant unavailable — degrading")
            return finish({
                "status": "degraded",
                "degradation": {
                    "reason": "consultant_unavailable",
                    "bridge_url": AIPASS_BRIDGE_URL,
                    "model": CONSULTANT_MODEL,
                },
                "context": context,
                "consultation_used": True,
                "skill_reused": False,
                "error": "Failed to get plan from Consultant",
            })

        if not _is_valid_plan_response(plan):
            print("[Secretary] ❌ Consultant returned malformed output — degrading")
            return finish({
                "status": "degraded",
                "degradation": {
                    "reason": "consultant_malformed_output",
                    "bridge_url": AIPASS_BRIDGE_URL,
                    "model": CONSULTANT_MODEL,
                },
                "context": context,
                "consultation_used": True,
                "skill_reused": False,
                "error": "Consultant output could not be parsed into a plan",
            })

        print(f"[Secretary] ✅ Received plan from Consultant")
        print(f"[Secretary] Goal: {plan.get('goal', 'N/A')}")
        print(f"[Secretary] Steps: {len(_extract_steps(plan))}")

    elif not saved_skill and not needs_consult:
        # Simple request — create basic plan
        print("[Secretary] ℹ️  Simple request, creating basic plan...")
        
        # For simple file operations, construct a proper plan with command_hint
        is_simple_file_op = False
        file_path = None
        content = None
        
        # Check if it's a CREATE file operation
        if "สร้างไฟล์" in user_request or "create file" in user_request.lower() or "create a file" in user_request.lower():
            file_path = _extract_file_path_from_action(user_request, cwd)
            if file_path:
                # Extract content
                content_match = re.search(r'(?:ข้อความ|เนื้อหา|content|with|containing)\s+["\']?([^"\']+)["\']?', user_request, re.IGNORECASE)
                content = content_match.group(1).strip() if content_match else "Created by Secretary"
                is_simple_file_op = True
        
        # Check if it's an UPDATE file operation
        elif "แก้ไขไฟล์" in user_request or "update file" in user_request.lower() or "edit file" in user_request.lower() or "modify file" in user_request.lower():
            file_path = _extract_file_path_from_action(user_request, cwd)
            if file_path:
                # Extract new content
                content_match = re.search(r'(?:เป็น|เปลี่ยนเป็น|change to|to)\s+["\']?([^"\']+)["\']?', user_request, re.IGNORECASE)
                content = content_match.group(1).strip() if content_match else "Updated content"
                is_simple_file_op = True
        
        # Check if it's a DELETE file operation
        elif "ลบไฟล์" in user_request or "delete file" in user_request.lower():
            file_path = _extract_file_path_from_action(user_request, cwd)
            if file_path:
                is_simple_file_op = True
        
        if is_simple_file_op and file_path:
            # Construct shell command for direct file operation
            if not file_path.startswith("/"):
                file_path = str(Path(cwd) / file_path)
            
            if "ลบไฟล์" in user_request or "delete file" in user_request.lower():
                command_hint = f"rm -f {file_path!r}"
                expected = "File deleted"
            elif "แก้ไขไฟล์" in user_request or "update file" in user_request.lower() or "edit file" in user_request.lower() or "modify file" in user_request.lower():
                command_hint = f"mkdir -p {Path(file_path).parent} && echo {content!r} > {file_path!r}"
                expected = "File updated"
            else:
                command_hint = f"mkdir -p {Path(file_path).parent} && echo {content!r} > {file_path!r}"
                expected = "File created"
            
            plan = {
                "goal": user_request,
                "analysis": "Direct execution requested - simple file operation",
                "plan": [{"step": 1, "action": user_request, "command_hint": command_hint, "expected_outcome": expected, "is_file_operation": True}],
                "dependencies": [],
                "risks": [],
                "next_action": "Execute request"
            }
        else:
            plan = {
                "goal": user_request,
                "analysis": "Direct execution requested",
                "plan": [{"step": 1, "action": user_request, "command_hint": None, "expected_outcome": "Request processed"}],
                "dependencies": [],
                "risks": [],
                "next_action": "Execute request"
            }

    # Step 4: Execute plan
    print(f"\n[Executor] 🚀 Executing plan...")

    if plan is None:
        print("[Secretary] ❌ No plan available — cannot execute")
        return finish({
            "status": "no_plan",
            "error": "No plan was generated",
            "context": context
        })

    execution_started = time.monotonic()
    execution_result = execute_plan(plan, cwd, user_request)
    record_latency("execution", execution_started, workflow_id, phase="initial")

    # Step 5: Automated Verification — ALWAYS run after execution
    print(f"\n[Secretary] 🔍 Verifying execution result...")
    verification_started = time.monotonic()
    verification_result = verify_execution_result(plan, execution_result, cwd, user_request)
    record_latency("verification", verification_started, workflow_id, phase="initial")

    if verification_result["verified"]:
        print(f"[Secretary] ✅ Verification passed ({len(verification_result['details'])} checks)")
        for detail in verification_result["details"]:
            if detail["notes"]:
                for note in detail["notes"]:
                    print(f"  [{detail['step']}] {note}")
    else:
        print(f"[Secretary] ❌ Verification failed!")
        for failure in verification_result["failures"]:
            print(f"  • {failure['type']}: {failure.get('message', failure.get('path', 'N/A'))}")

    # Step 6: Save skill if successful — but never re-save a reused skill
    if verification_result["verified"]:
        if saved_skill is not None:
            print(f"\n[Secretary] ℹ️  Skill was reused — skipping duplicate save")
            log_event(logging.INFO, "skill_save_skipped_reused", workflow_id=workflow_id)
        else:
            print(f"\n[Secretary] 💾 Saving skill to library...")
            saved_path = save_successful_skill(user_request, plan, execution_result, verification_result)
            if saved_path:
                print(f"[Secretary] ✅ Skill saved to {saved_path}")

    # Step 7: Handle success/failure
    if execution_result["status"] == "success" and verification_result["verified"]:
        print(f"\n[Executor] ✅ All steps completed and verified successfully!")
        return finish({
            "status": "success",
            "plan": plan,
            "execution": execution_result,
            "verification": verification_result,
            "context": context,
            "consultation_used": needs_consult,
            "skill_reused": saved_skill is not None,
            "skill_saved": saved_path is not None,
            "saved_path": str(saved_path) if saved_path is not None else None
        })

    # If execution failed OR verification failed -> self-healing loop with
    # at most MAX_HEAL_ATTEMPTS valid alternative plans.
    print(f"\n[Secretary] ⚠️  {'Execution failed' if execution_result['status'] != 'success' else 'Verification failed'}")
    print(f"[Secretary] 🔄 Self-healing: up to {MAX_HEAL_ATTEMPTS} alternative plan(s)...")
    log_event(logging.WARNING, "self_heal_loop_started", workflow_id=workflow_id,
              max_heal_attempts=MAX_HEAL_ATTEMPTS)

    heal_attempts: List[Dict[str, Any]] = []
    current_plan = plan
    current_exec = execution_result
    current_verif = verification_result

    for attempt in range(1, MAX_HEAL_ATTEMPTS + 1):
        failed_step = _locate_failed_step(current_exec, current_verif)
        if failed_step is None:
            print("[Secretary] ❌ Could not identify failed step for self-healing")
            break

        alternative = self_heal(user_request, failed_step, context,
                                workflow_id=workflow_id, attempt=attempt)

        if alternative is None:
            heal_attempts.append({"attempt": attempt, "outcome": "consultant_unavailable"})
            print(f"[Secretary] ❌ Heal attempt {attempt}: consultant unavailable")
            continue

        alt_steps = _extract_alternative_steps(alternative)
        if not alt_steps:
            heal_attempts.append({"attempt": attempt, "outcome": "malformed_output"})
            print(f"[Secretary] ❌ Heal attempt {attempt}: malformed consultant output")
            log_event(logging.WARNING, "self_heal_malformed_output", workflow_id=workflow_id,
                      attempt=attempt)
            continue

        alt_plan = dict(current_plan)
        alt_plan["plan"] = alternative.get("alternative_plan")

        print(f"[Secretary] ✅ Heal attempt {attempt}: executing alternative plan "
              f"({len(alt_steps)} step(s))")
        heal_exec_started = time.monotonic()
        alt_result = execute_plan(alt_plan, cwd, user_request)
        record_latency("execution", heal_exec_started, workflow_id, phase=f"heal_{attempt}")

        heal_verif_started = time.monotonic()
        alt_verification = verify_execution_result(alt_plan, alt_result, cwd, user_request)
        record_latency("verification", heal_verif_started, workflow_id, phase=f"heal_{attempt}")

        heal_attempts.append({
            "attempt": attempt,
            "outcome": "executed",
            "execution_status": alt_result.get("status"),
            "verified": alt_verification.get("verified", False),
        })

        if alt_result["status"] == "success" and alt_verification["verified"]:
            print(f"\n[Executor] ✅ Alternative plan verified on heal attempt {attempt}!")
            return finish({
                "status": "success",
                "plan": alt_plan,
                "original_plan": plan,
                "alternative_plan": alternative,
                "execution": alt_result,
                "verification": alt_verification,
                "context": context,
                "consultation_used": True,
                "self_healing_applied": True,
                "heal_attempts": heal_attempts,
                "skill_reused": saved_skill is not None,
                "skill_saved": False
            })

        current_plan, current_exec, current_verif = alt_plan, alt_result, alt_verification

    return finish({
        "status": "degraded",
        "degradation": {
            "reason": "heal_attempts_exhausted",
            "max_heal_attempts": MAX_HEAL_ATTEMPTS,
            "attempts": heal_attempts,
        },
        "plan": current_plan,
        "execution": current_exec,
        "verification": current_verif,
        "context": context,
        "consultation_used": needs_consult,
        "self_healing_attempted": True,
        "skill_reused": saved_skill is not None,
        "error": current_exec.get("error", "All self-heal attempts exhausted without a verified result")
    })


# ============================
# CLI Entry Point
# ============================

if __name__ == "__main__":
    import argparse
    
    parser = argparse.ArgumentParser(description='Secretary - Middle Gateway for AI Agent Workflow')
    parser.add_argument('request', nargs='+', help='User request text')
    parser.add_argument('--cwd', default=None, help='Working directory for execution')
    parser.add_argument('--skip-skill-reuse', action='store_true', help='Skip skill reuse check')
    args = parser.parse_args()
    
    user_request = " ".join(args.request)
    cwd = args.cwd or os.getcwd()
    
    if args.skip_skill_reuse:
        # Temporarily clear skill dir to skip reuse
        import tempfile
        original_skills_dir = SKILLS_DIR
        SKILLS_DIR = Path(tempfile.mkdtemp())

    result = (run_primary_brain_workflow(user_request, cwd)
              if ORCHESTRATION_MODE == "primary" else run_secrets_workflow(user_request, cwd))
    if ORCHESTRATION_MODE != "primary":
        result = dict(result)
        result["orchestration"] = "legacy"
    
    print(f"\n{'='*60}")
    print("Final Result:")
    print(json.dumps(result, indent=2, ensure_ascii=False))
    print(f"{'='*60}")
