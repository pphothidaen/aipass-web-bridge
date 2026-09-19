# -*- coding: utf-8 -*-
"""
secretary.py — Middle Gateway / Secretary core logic.
"""
import json
import os
import sys
import hashlib
import subprocess
from pathlib import Path
from typing import Any, Dict, List, Optional

import requests

# ------------------------------------------------------------
# Configuration
# ------------------------------------------------------------
BRIDGE_URL = os.environ.get("AIPASS_BRIDGE_URL", "https://aipass-web-bridge.taijustarrett417.workers.dev")
CONSULTANT_MODEL = os.environ.get("CONSULTANT_MODEL", "claude-sonnet-5")
MAX_TOKENS = int(os.environ.get("SECRETARY_MAX_TOKENS", "2048"))
SKILLS_DIR = Path(os.environ.get("SECRETARY_SKILLS_DIR", "skills")).resolve()
SKILLS_DIR.mkdir(parents=True, exist_ok=True)

# ------------------------------------------------------------
# Skill store
# ------------------------------------------------------------
def _skill_filename(request: str) -> str:
    h = hashlib.sha256(request.encode("utf-8")).hexdigest()[:16]
    return h + ".json"


def save_skill(request: str, plan: Dict[str, Any], result_summary: Dict[str, Any]) -> Path:
    path = SKILLS_DIR / _skill_filename(request)
    payload = {
        "request": request,
        "plan": plan,
        "result_summary": result_summary,
        "saved_at": subprocess.getoutput("date -u +'%Y-%m-%dT%H:%M:%SZ'"),
    }
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False))
    return path


def load_skill(request: str) -> Optional[Dict[str, Any]]:
    path = SKILLS_DIR / _skill_filename(request)
    if not path.exists():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def list_skills() -> List[Dict[str, Any]]:
    skills = []
    for p in sorted(SKILLS_DIR.glob("*.json")):
        try:
            data = json.loads(p.read_text(encoding="utf-8"))
            skills.append({
                "hash": p.stem,
                "request": data.get("request", ""),
                "saved_at": data.get("saved_at", ""),
                "goal": data.get("plan", {}).get("goal", ""),
            })
        except Exception:
            skills.append({
                "hash": p.stem,
                "request": "(unreadable)",
                "saved_at": "",
                "goal": "",
            })
    return skills


# ------------------------------------------------------------
# Context Preparation
# ------------------------------------------------------------
def gather_context(request: str, cwd: str = None) -> Dict[str, Any]:
    cwd = cwd or os.getcwd()
    context = {
        "cwd": cwd,
        "python_version": _run("python3 --version").strip() or "unknown",
        "relevant_files": _list_python_files(cwd),
        "available_tools": ["python3", "bash", "curl", "pip3"],
        "request": request,
    }
    return context


def _run(cmd: str) -> str:
    try:
        return subprocess.check_output(cmd, shell=True, text=True, stderr=subprocess.STDOUT).strip()
    except subprocess.CalledProcessError as e:
        return (e.output or "").strip()


def _list_python_files(cwd: str, max_files: int = 12) -> List[str]:
    try:
        files = [str(p) for p in Path(cwd).rglob("*.py")]
        return files[:max_files]
    except Exception as e:
        return [f"(file scan error: {e})"]


# ------------------------------------------------------------
# Routing Decision
# ------------------------------------------------------------
CONSULT_KEYWORDS = [
    "enhance", "add", "create", "build", "implement", "fix",
    "monitor", "health", "alert", "track", "system", "deploy",
    "setup", "configure", "refactor", "migrate", "upgrade",
]


def should_consult(request: str, context: Dict[str, Any]) -> bool:
    lower = request.lower()
    for kw in CONSULT_KEYWORDS:
        if kw in lower:
            return True
    return False


# ------------------------------------------------------------
# Consultant Call
# ------------------------------------------------------------
SYSTEM_PROMPT = """
You are a Planning Consultant for an autonomous agent system.
Your job is to analyze the user's request and produce a structured JSON plan.

The plan must match this schema exactly:
{
  "goal": "brief description of the objective",
  "steps": [
    {"step": 1, "command": "shell command to execute", "description": "what this step does"},
    {"step": 2, "command": "...", "description": "..."}
  ],
  "tools_needed": ["python3", "bash", ...],
  "risk_level": "low|medium|high"
}

Guidelines:
- Commands should be simple shell commands or Python one-liners.
- If a step may fail, include a fallback suggestion in the description.
- Keep the plan realistic for the provided context (available tools, files, environment).
- Respond ONLY with the JSON object, optionally wrapped in ```json ... ```.
"""


def build_consult_message(request: str, context: Dict[str, Any]) -> str:
    ctx_str = json.dumps(context, indent=2, ensure_ascii=False)
    return (
        f"Context:\n{ctx_str}\n\n"
        f"Request:\n{request}\n\n"
        "Respond with a JSON plan matching the schema described in the system prompt."
    )


def call_consultant(request: str, context: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    payload = {
        "model": CONSULTANT_MODEL,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": build_consult_message(request, context)},
        ],
        "max_tokens": MAX_TOKENS,
        "temperature": 0.3,
    }
    try:
        resp = requests.post(f"{BRIDGE_URL}/v1/chat/completions", json=payload, timeout=45)
        resp.raise_for_status()
        raw = resp.json()["choices"][0]["message"]["content"]
        if "```" in raw:
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:].strip()
            else:
                raw = raw.strip()
        return json.loads(raw)
    except Exception as e:
        print(f"[Secretary] Consultant call failed: {e}", file=sys.stderr)
        return None


# ------------------------------------------------------------
# Plan Schema (enforced by Consultant)
# ------------------------------------------------------------
SYSTEM_PROMPT = """
You are a Planning Consultant for an autonomous agent system.
Your job is to analyze the user's request and produce a structured JSON plan.

The plan must match this schema exactly:
{
  "goal": "brief description of the objective",
  "steps": [
    {"step": 1, "command": "shell command to execute", "description": "what this step does"},
    {"step": 2, "command": "...", "description": "..."}
  ],
  "tools_needed": ["python3", "bash", ...],
  "risk_level": "low|medium|high"
}

Guidelines:
- Commands should be simple shell commands or Python one-liners.
- If a step may fail, include a fallback suggestion in the description.
- Keep the plan realistic for the provided context (available tools, files, environment).
- Respond ONLY with the JSON object, optionally wrapped in ```json ... ```.
"""


# ------------------------------------------------------------
# Execution
# ------------------------------------------------------------
def execute_plan(plan: Dict[str, Any], cwd: str = None) -> Dict[str, Any]:
    cwd = cwd or os.getcwd()
    results = []
    for step_info in plan.get("steps", []):
        cmd = step_info.get("command", "")
        desc = step_info.get("description", "")
        print(f"[Agent] Executing step {step_info.get('step')}: {desc}")
        print(f"  Command: {cmd}")
        try:
            proc = subprocess.run(cmd, shell=True, cwd=cwd, capture_output=True, text=True)
            success = proc.returncode == 0
            results.append({
                "step": step_info.get('step'),
                "command": cmd,
                "success": success,
                "stdout": proc.stdout.strip(),
                "stderr": proc.stderr.strip(),
                "description": desc,
            })
            if not success:
                print(f"[Agent] Step failed: {proc.stderr.strip()}")
                return {"failed_step_index": len(results) - 1, "results": results, "error": proc.stderr}
        except Exception as e:
            results.append({
                "step": step_info.get('step'),
                "command": cmd,
                "success": False,
                "stdout": "",
                "stderr": str(e),
                "description": desc,
            })
            return {"failed_step_index": len(results) - 1, "results": results, "error": str(e)}
    return {"failed_step_index": None, "results": results, "error": None}


# ------------------------------------------------------------
# Self-Healing
# ------------------------------------------------------------
def self_heal(original_request: str, failed_step: Dict[str, Any], context: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    error_msg = failed_step.get("stderr", "Unknown error")
    original_cmd = failed_step.get("command", "")

    heal_request = (
        f"The following step failed:\n"
        f"Command: {original_cmd}\n"
        f"Error: {error_msg}\n\n"
        f"Original request: {original_request}\n"
        "Propose an alternative command or approach for this step only. "
        "Return a JSON plan with a single step that fixes or works around the issue."
    )

    heal_context = {
        "cwd": context.get("cwd", os.getcwd()),
        "python_version": context.get("python_version", ""),
        "available_tools": context.get("available_tools", []),
        "request": heal_request,
    }

    return call_consultant(heal_request, heal_context)


# ------------------------------------------------------------
# Main orchestration
# ------------------------------------------------------------
def run_with_secretary(
    user_request: str,
    cwd: str = None,
    save_skill_if_success: bool = True,
    auto_heal: bool = True,
) -> Dict[str, Any]:
    cwd = cwd or os.getcwd()
    print(f"[Secretary] Request: {user_request}")
    print(f"[Secretary] CWD: {cwd}")

    context = gather_context(user_request, cwd)
    print(f"[Secretary] Context gathered (files: {len(context['relevant_files'])})")

    if not should_consult(user_request, context):
        print("[Secretary] No consultation needed, falling back to direct execution")
        return {"plan": None, "execution": "skipped", "context": context, "consult_used": False}

    print("[Secretary] Consulting Sonnet 5 ...")
    plan = call_consultant(user_request, context)
    if plan is None:
        return {"plan": None, "execution": "consultation_failed", "context": context, "consult_used": True, "error": "Could not reach Consultant"}

    print(f"[Secretary] Plan received: {json.dumps(plan, indent=2)[:200]}...")
    print("[Agent] Executing plan ...")
    exec_result = execute_plan(plan, cwd)

    healing_attempted = False
    healing_result = None

    if exec_result.get("failed_step_index") is not None and auto_heal:
        failed_step = exec_result["results"][exec_result["failed_step_index"]]
        print("[Secretary] Step failed, triggering self-healing ...")
        heal_plan = self_heal(user_request, failed_step, context)
        if heal_plan:
            print(f"[Secretary] Healing plan: {json.dumps(heal_plan, indent=2)[:200]}...")
            heal_step = heal_plan["steps"][0] if heal_plan.get("steps") else None
            if heal_step:
                print(f"[Agent] Executing healing step: {heal_step}")
                proc = subprocess.run(heal_step.get("command", ""), shell=True, cwd=cwd, capture_output=True, text=True)
                heal_success = proc.returncode == 0
                healing_result = {
                    "command": heal_step.get("command"),
                    "success": heal_success,
                    "stdout": proc.stdout.strip(),
                    "stderr": proc.stderr.strip(),
                }
        else:
            exec_result["healing_attempted"] = False
            exec_result["healing_error"] = "Could not get healing plan"

    result_summary = {
        "plan_goal": plan.get("goal"),
        "total_steps": len(plan.get("steps", [])),
        "exec_success": exec_result.get("failed_step_index") is None,
        "healing_attempted": healing_attempted,
        "healing_success": healing_result.get("success") if healing_result else None,
        "final_error": exec_result.get("error"),
    }

    if save_skill_if_success and exec_result.get("failed_step_index") is None:
        try:
            save_skill(user_request, plan, result_summary)
            print("[Secretary] Skill saved")
        except Exception as e:
            print(f"[Secretary] Skill save failed: {e}")

    return {
        "plan": plan,
        "execution": exec_result,
        "context": context,
        "consult_used": True,
        "result_summary": result_summary,
        "request": user_request,
    }


# ------------------------------------------------------------
# Direct execution fallback (when no consultation needed)
# ------------------------------------------------------------
def run_direct(request: str, cwd: str = None) -> Dict[str, Any]:
    cwd = cwd or os.getcwd()
    print(f"[Direct] Request: {request}")
    print(f"[Direct] CWD: {cwd}")
    proc = subprocess.run(request, shell=True, cwd=cwd, capture_output=True, text=True)
    success = proc.returncode == 0
    return {
        "plan": None,
        "execution": {
            "failed_step_index": None if success else 0,
            "results": [{
                "step": 1,
                "command": request,
                "success": success,
                "stdout": proc.stdout.strip(),
                "stderr": proc.stderr.strip(),
                "description": "direct execution",
            }],
            "error": proc.stderr if not success else None,
        },
        "context": gather_context(request, cwd),
        "consult_used": False,
        "result_summary": {"exec_success": success},
    }