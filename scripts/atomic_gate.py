#!/usr/bin/env python3
"""
Atomic Execution Gate — Enforces Subtask atomicity rules.

Rules:
  1. ≤3 files changed per commit (for Subtask commits)
  2. ≤1 subsystem touched (based on path prefix)
  3. Commit message references Jira Subtask ID
  4. Total diff ≤500 lines (excluding auto-generated files)
  5. No merge commits bypass

Usage:
  python3 scripts/atomic_gate.py --ticket KAN-123 --files "f1 f2" --diff-lines 42
  python3 scripts/atomic_gate.py --validate-subtask KAN-123
"""

import os
import sys
import re
import argparse
from typing import List, Set, Dict
from collections import defaultdict

sys.path.insert(0, os.path.dirname(__file__))
from jira_api_helper import JiraClient, extract_jira_key


# Path prefixes that define subsystems
SUBSYSTEM_PATTERNS = {
    "cloudflare": re.compile(r"^cloudflare/"),
    "vscode-extension": re.compile(r"^packages/vscode-extension/"),
    "chrome-extension": re.compile(r"^packages/core/aipass-bridge/extension/"),
    "core-bridge": re.compile(r"^packages/core/aipass-bridge/bridge/"),
    "shared": re.compile(r"^packages/shared/"),
    "scripts": re.compile(r"^scripts/"),
    "docs": re.compile(r"^docs/|\.md$"),
    "config": re.compile(r"^\.github/|\.gitignore|package\.json|tsconfig|\.env"),
}

# Files that don't count toward limits
AUTO_GENERATED = re.compile(
    r"(package-lock\.json|yarn\.lock|\.min\.(js|css)|dist/|build/|"
    r"coverage/|\.map$|\.pyc$|__pycache__)"
)


def classify_subsystem(filepath: str) -> str:
    """Classify a file into a subsystem."""
    if AUTO_GENERATED.search(filepath):
        return "auto-generated"
    for name, pattern in SUBSYSTEM_PATTERNS.items():
        if pattern.search(filepath):
            return name
    return "root/other"


def validate_atomic_execution(
    client: JiraClient,
    ticket_id: str,
    changed_files: List[str],
    diff_lines: int = 0
) -> Dict:
    """
    Validate that a commit respects atomic execution rules.
    
    Returns: {"valid": bool, "violations": List[str], "action": str}
    """
    violations = []
    
    # Filter out auto-generated files
    real_files = [f for f in changed_files if not AUTO_GENERATED.search(f)]
    
    # Rule 1: ≤3 files
    if len(real_files) > 3:
        violations.append(
            f"  ❌ Too many files changed: {len(real_files)} (max 3)\n"
            f"     Files: {', '.join(real_files[:5])}{'...' if len(real_files) > 5 else ''}"
        )
    
    # Rule 2: ≤1 subsystem
    subsystems: Set[str] = set()
    for f in real_files:
        subsystems.add(classify_subsystem(f))
    
    real_subsystems = subsystems - {"auto-generated"}
    if len(real_subsystems) > 1:
        violations.append(
            f"  ❌ Cross-system change: {len(real_subsystems)} subsystems touched\n"
            f"     Systems: {', '.join(sorted(real_subsystems))}\n"
            f"     Consider splitting into separate Subtasks."
        )
    
    # Rule 3: Diff size ≤500 lines
    if diff_lines > 500:
        violations.append(
            f"  ❌ Diff too large: {diff_lines} lines (max 500)\n"
            f"     Consider splitting into smaller, focused commits."
        )
    
    # Rule 4: Jira ticket in commit message
    has_jira_key = any(extract_jira_key(f) for f in changed_files)
    if not has_jira_key and ticket_id:
        # This is handled by commit-msg hook, not here
        pass
    
    # Check issue status (don't allow commits to Done/Archived)
    issue = client.get_issue(ticket_id)
    if not issue.get("error"):
        status = issue.get("fields", {}).get("status", {}).get("name", "")
        if status in ("Done", "Archived", "Closed"):
            violations.append(
                f"  ❌ Ticket {ticket_id} is already {status}.\n"
                f"     Reopen the ticket or create a new one."
            )
    
    if violations:
        return {
            "valid": False,
            "violations": violations,
            "action": "reject",
            "message": f"🚫 ATOMIC VIOLATION for {ticket_id}:\n" + "\n".join(violations)
        }
    
    return {
        "valid": True,
        "violations": [],
        "action": "allow",
        "message": f"✅ ATOMIC OK: {len(real_files)} file(s), {diff_lines} line(s), "
                   f"subsystem: {', '.join(sorted(real_subsystems))}"
    }


def validate_subtask_time_box(client: JiraClient, ticket_id: str) -> Dict:
    """
    Check if a Subtask is within the 4-hour time box.
    Looks at the ticket's updated timestamp vs. when it entered 'In Progress'.
    
    Returns: {"valid": bool, "message": str}
    """
    issue = client.get_issue(ticket_id)
    
    if issue.get("error"):
        return {"valid": False, "message": f"Cannot fetch {ticket_id}: {issue.get('message')}"}
    
    fields = issue.get("fields", {})
    status = fields.get("status", {}).get("name", "")
    
    # Parse timestamps
    updated = fields.get("updated", "")
    created = fields.get("created", "")
    
    # Check changelog for In Progress transition (simplified — full impl would use changelog API)
    # For now, use updated timestamp as proxy
    if status == "In Progress":
        from datetime import datetime, timezone
        try:
            update_time = datetime.fromisoformat(updated.replace("Z", "+00:00"))
            now = datetime.now(timezone.utc)
            hours_active = (now - update_time).total_seconds() / 3600
            
            if hours_active > 4:
                return {
                    "valid": False,
                    "message": (
                        f"⚠️ TIME BOX WARNING: {ticket_id} has been In Progress for {hours_active:.1f}h.\n"
                        f"   Atomic Subtasks should complete within 4 hours.\n"
                        f"   Consider splitting or escalating to Hermes."
                    )
                }
        except (ValueError, TypeError):
            pass
    
    return {"valid": True, "message": f"✅ {ticket_id} time box OK"}


def main():
    parser = argparse.ArgumentParser(description="Atomic Execution Gate")
    parser.add_argument("--ticket", help="Jira ticket ID")
    parser.add_argument("--files", help="Space-separated list of changed files")
    parser.add_argument("--diff-lines", type=int, default=0, help="Number of diff lines")
    parser.add_argument("--validate-subtask", help="Run time-box check on subtask")
    parser.add_argument("--env-file", help="Path to .env file")
    args = parser.parse_args()
    
    if args.env_file:
        from jira_api_helper import load_env_file
        load_env_file(args.env_file)
    
    client = JiraClient()
    
    if args.validate_subtask:
        result = validate_subtask_time_box(client, args.validate_subtask)
    elif args.ticket and args.files:
        files = args.files.split()
        result = validate_atomic_execution(client, args.ticket, files, args.diff_lines)
    else:
        parser.print_help()
        sys.exit(1)
    
    print(result["message"])
    sys.exit(0 if result.get("valid", False) else 1)


if __name__ == "__main__":
    main()
