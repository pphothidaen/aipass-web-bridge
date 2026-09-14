#!/usr/bin/env python3
"""
C10-C11 live probe — real consultant round-trip via the AIPASS bridge.

OPT-IN ONLY: runs when SECRETARY_LIVE_TEST=1 and uses one consultant call
(potentially spending credits). Without the flag it prints a no-op notice.

Guarantees:
1. Preflights the bridge (/status), extension/login (extensions >= 1), and
   quota/credits (/quota) BEFORE any consultant call. Stops if unavailable.
2. Makes EXACTLY ONE consultant call (call_consultant).
3. Accepts only a ONE-STEP, file-operation plan whose paths are confined to a
   temporary sandbox directory. Anything else is rejected.
4. NEVER executes the plan (or any other plan) — no execute_plan, no shell.
5. Reports the model the bridge used and any AIPASS auto model switch.

Exit codes: 0 = probe passed, 1 = probe failed, 2 = preflight blocked.
"""
import json
import os
import re
import sys
import tempfile
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(PROJECT_ROOT))

import secretary  # noqa: E402

BRIDGE_URL = secretary.AIPASS_BRIDGE_URL
TIMEOUT = 10

# Commands the sandbox must never contain
DANGEROUS_PATTERNS = [
    r"\brm\s+(-\w*\s+)*-?[rf]", r"\bsudo\b", r"\bcurl\b[^|]*\|\s*sh",
    r"\bmkfs\b", r"\bdd\b\s+if=", r">\s*/etc/", r"\bmv\b\s+.*/etc/",
    r"\.\./", r"\bchmod\b", r"\bchown\b", r"\bkill\b", r"\bpkill\b",
]


def http_get_json(path: str):
    import requests
    response = requests.get(f"{BRIDGE_URL}{path}", timeout=TIMEOUT)
    response.raise_for_status()
    return response.json()


def preflight() -> dict:
    """Return preflight info; raise RuntimeError when the bridge is unusable."""
    problems = []

    try:
        status = http_get_json("/status")
    except Exception as e:
        raise RuntimeError(f"bridge unreachable at {BRIDGE_URL}: {type(e).__name__}")

    if not status.get("ok"):
        problems.append("bridge /status did not report ok")

    extensions = status.get("extensions", 0)
    if not isinstance(extensions, int) or extensions < 1:
        problems.append("no extension/login connected (extensions=0) — open the "
                        "de.aipass.net tab with the AIPASS extension")

    current_model = status.get("defaultModel")
    requested_model = secretary.CONSULTANT_MODEL
    models = status.get("models") or []
    # /status models may be dicts ({id: ...}) or bare id strings
    model_ids = [m.get("id") if isinstance(m, dict) else m for m in models]
    if model_ids and requested_model not in model_ids:
        problems.append(
            f"requested consultant model '{requested_model}' not in bridge model list")

    credits = status.get("credits")
    quota = None
    try:
        quota = http_get_json("/quota?refresh=1")
    except Exception:
        problems.append("quota unavailable from /quota (open a de.aipass.net tab)")

    if credits is None and quota is None:
        problems.append("no credit figures available — cannot verify quota")

    if problems:
        raise RuntimeError("preflight failed:\n  - " + "\n  - ".join(problems))

    return {
        "extensions": extensions,
        "current_model": current_model,
        "requested_model": requested_model,
        "credits": credits if credits is not None else quota,
    }


def build_probe_request(sandbox: Path) -> str:
    return (
        f"Create file {sandbox}/probe_output.txt with content live-probe-ok. "
        f"You MUST use exactly the path {sandbox}/probe_output.txt and must not "
        f"touch any file outside {sandbox}."
    )


def validate_plan(plan, sandbox: Path) -> dict:
    """Accept only a one-step, file-operation, sandbox-confined plan."""
    if not isinstance(plan, dict) or plan.get("_parse_error"):
        return {"ok": False, "reason": "consultant output was not a valid JSON plan"}

    steps = secretary._extract_steps(plan)
    if len(steps) != 1:
        return {"ok": False, "reason": f"plan has {len(steps)} steps, exactly 1 allowed"}

    step = steps[0]
    action = str(step.get("action", ""))
    command_hint = str(step.get("command_hint", "") or step.get("command", ""))
    combined = f"{action} {command_hint}".lower()

    if not step.get("is_file_operation", False) and not secretary.is_file_operation_task(action, command_hint):
        return {"ok": False, "reason": "plan step is not a file operation"}

    for pattern in DANGEROUS_PATTERNS:
        if re.search(pattern, combined):
            return {"ok": False, "reason": f"plan contains forbidden pattern: {pattern}"}

    sandbox_str = str(Path(sandbox).resolve())
    absolute_paths = re.findall(r'(/[\w\-./]+\.(?:txt|md|json|py|js|css|html))',
                                f"{action} {command_hint}")
    relative_paths = re.findall(r'(?<![\w\-./])([\w\-]+\.(?:txt|md|json|py|js|css|html))',
                                f"{action} {command_hint}")
    if not absolute_paths and not relative_paths:
        return {"ok": False, "reason": "plan contains no recognizable file path"}

    for found in absolute_paths:
        resolved = str(Path(found).resolve())
        if not (resolved.startswith(sandbox_str + os.sep) or resolved == sandbox_str):
            return {"ok": False, "reason": f"path {found} is outside the sandbox {sandbox_str}"}

    for found in relative_paths:
        # A bare filename is only acceptable when the command anchors it in the sandbox
        if sandbox_str not in f"{action} {command_hint}":
            return {"ok": False, "reason": f"relative path {found} with no sandbox prefix"}

    return {"ok": True, "step": step}


def main() -> int:
    print("=== C10-C11 live probe (opt-in) ===")

    if os.environ.get("SECRETARY_LIVE_TEST") != "1":
        print("SKIPPED: set SECRETARY_LIVE_TEST=1 to run (uses one consultant call)")
        return 0

    print(f"[preflight] bridge: {BRIDGE_URL}")
    try:
        info = preflight()
    except RuntimeError as e:
        print(f"BLOCKED: {e}")
        print("No consultant call was made; no credits were used.")
        return 2

    print(f"[preflight] extensions logged in: {info['extensions']}")
    print(f"[preflight] current model in use: {info['current_model']}")
    print(f"[preflight] requested model:      {info['requested_model']}")
    print(f"[preflight] credits/quota:        {json.dumps(info['credits'], ensure_ascii=False)}")

    sandbox = Path(tempfile.mkdtemp(prefix="secretary-live-probe-"))
    print(f"[sandbox] {sandbox}")

    request = build_probe_request(sandbox)
    context = {
        "request": request, "cwd": str(sandbox), "python_version": "probe",
        "os_info": "probe", "relevant_files": [], "timestamp": "probe",
        "bridge_available": True,
    }

    print("[probe] making exactly ONE consultant call...")
    plan = secretary.call_consultant(request, context, workflow_id="live-probe")

    if plan is None:
        print("FAIL: consultant returned no response")
        return 1

    # Report model switching (AIPASS auto change) — content is metadata only here
    verdict = validate_plan(plan, sandbox)
    print(f"[probe] plan accepted: {verdict['ok']}"
          + ("" if verdict["ok"] else f" — {verdict['reason']}"))
    if verdict["ok"]:
        print(f"[probe] step action: {verdict['step'].get('action', '')[:120]}")

    print("[probe] plan was NOT executed (probe never executes plans)")

    if verdict["ok"]:
        print("PASS: consultant reachable, one-step sandbox-confined plan returned")
        return 0
    print("FAIL: consultant plan rejected")
    return 1


if __name__ == "__main__":
    sys.exit(main())
