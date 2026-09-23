#!/usr/bin/env python3
"""
TDD Gate — Enforces TDD RED→GREEN→REFACTOR phase transitions.

Rules:
  1. If ticket is in 'TDD RED', commit MUST contain new/changed test files
  2. If ticket is in 'TDD GREEN', commit MUST NOT change test files (refactor only)
  3. Transition to 'TDD GREEN' only when CI passes (handled by GitHub Actions)
  4. Test files: *.test.*, *_test.*, test_*, *-test.*, spec/*, __tests__/*
  5. Empty test files (assert True / pass) are rejected

Usage:
  python3 scripts/tdd_gate.py --ticket KAN-123 --files-changed "file1 file2 ..."
  python3 scripts/tdd_gate.py --ticket KAN-123 --ci-status green
"""

import os
import sys
import re
import argparse
from typing import List, Set

# Add parent dir to path for imports
sys.path.insert(0, os.path.dirname(__file__))
from jira_api_helper import JiraClient, extract_jira_key


# Patterns that identify test files
TEST_FILE_PATTERNS = [
    re.compile(r'.*\.test\.(py|js|ts|jsx|tsx|mjs|cjs)$'),
    re.compile(r'.*_test\.(py|js|ts|jsx|tsx)$'),
    re.compile(r'^test_.*\.py$'),
    re.compile(r'.*-test\.(py|js|ts|jsx|tsx)$'),
    re.compile(r'^tests?/'),
    re.compile(r'^spec/'),
    re.compile(r'^__tests__/'),
    re.compile(r'.*\.spec\.(py|js|ts|jsx|tsx)$'),
]

# Patterns for empty/placeholder tests (anti-patterns)
EMPTY_TEST_PATTERNS = [
    re.compile(r'assert\s+True\b'),
    re.compile(r'pass\s*#?\s*$'),
    re.compile(r'^\s*pytest\.skip'),
    re.compile(r'^\s*skip\('),
    re.compile(r'^\s*def\s+test_\w+\s*\([^)]*\)\s*:\s*$'),  # empty test function
    re.compile(r'test\s*\(\s*["\']\s*["\']\s*,\s*\(\s*\)\s*=>\s*\{\s*\}\s*\)'),  # empty test callback
]


def is_test_file(filepath: str) -> bool:
    """Check if a file path matches test file patterns."""
    basename = os.path.basename(filepath)
    return any(p.match(filepath) or p.match(basename) for p in TEST_FILE_PATTERNS)


def is_empty_test(filepath: str) -> bool:
    """Check if a test file is empty or contains only placeholder assertions."""
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            content = f.read()
        
        # Remove whitespace/comments
        stripped = re.sub(r'#.*$', '', content, flags=re.MULTILINE)
        stripped = re.sub(r'""".*?"""', '', stripped, flags=re.DOTALL)
        stripped = re.sub(r"'''.*?'''", '', stripped, flags=re.DOTALL)
        stripped = re.sub(r'//.*$', '', stripped, flags=re.MULTILINE)
        stripped = re.sub(r'/\*.*?\*/', '', stripped, flags=re.DOTALL)
        stripped = stripped.strip()
        
        # If file is essentially empty
        if len(stripped) < 50:  # arbitrary minimum
            return True
        
        # Check for placeholder-only content
        for pattern in EMPTY_TEST_PATTERNS:
            if pattern.search(stripped):
                # If the ENTIRE file is just these patterns
                matches = pattern.findall(stripped)
                if len(matches) > 0 and len(stripped) < 200:
                    return True
    except (IOError, UnicodeDecodeError):
        pass
    return False


def validate_tdd_phase(client: JiraClient, ticket_id: str, changed_files: List[str]) -> dict:
    """
    Validate that the current commit respects TDD phase rules.
    
    Returns: {"valid": bool, "message": str, "action": str}
    """
    issue = client.get_issue(ticket_id)
    
    if issue.get("error"):
        return {"valid": False, "message": f"Cannot fetch issue: {issue.get('message')}", "action": "error"}
    
    fields = issue.get("fields", {})
    status = fields.get("status", {}).get("name", "")
    
    test_files = [f for f in changed_files if is_test_file(f)]
    non_test_files = [f for f in changed_files if not is_test_file(f)]
    
    # Check for empty tests in any phase
    for f in test_files:
        if os.path.exists(f) and is_empty_test(f):
            return {
                "valid": False,
                "message": f"❌ REJECTED: Empty/placeholder test detected: {f}\n"
                           f"   Tests must contain real assertions, not `assert True` or `pass`.",
                "action": "reject"
            }
    
    if status == "TDD RED":
        # In TDD RED phase, MUST have test files in commit
        if not test_files:
            return {
                "valid": False,
                "message": f"❌ REJECTED: Ticket {ticket_id} is in TDD RED phase.\n"
                           f"   Commit MUST contain test files (*.test.*, *_test.py, test_*, etc.)\n"
                           f"   Files changed: {', '.join(changed_files) or '(none)'}\n"
                           f"   Add failing tests first before implementation.",
                "action": "reject"
            }
        return {
            "valid": True,
            "message": f"✅ TDD RED: Test files added ({len(test_files)} files). Good TDD discipline.",
            "action": "allow"
        }
    
    elif status == "TDD GREEN":
        # In TDD GREEN, should NOT modify tests (refactor only)
        if test_files:
            return {
                "valid": False,
                "message": f"⚠️ WARNING: Ticket {ticket_id} is in TDD GREEN.\n"
                           f"   Modifying existing tests during GREEN phase.\n"
                           f"   If this is a test fix, consider reverting to TDD RED first.\n"
                           f"   Test files changed: {', '.join(test_files)}",
                "action": "warn"
            }
        return {
            "valid": True,
            "message": f"✅ TDD GREEN: Refactor-only commit (no test changes). Clean.",
            "action": "allow"
        }
    
    else:
        # No TDD enforcement in other statuses
        return {"valid": True, "message": f"ℹ️ No TDD gate for status '{status}'", "action": "allow"}


def transition_on_ci_result(client: JiraClient, ticket_id: str, ci_status: str) -> dict:
    """
    Called by GitHub Actions when CI completes.
    
    ci_status: 'green' or 'red'
    """
    transitions = client.get_transitions(ticket_id)
    transition_map = {t["name"].lower(): t["id"] for t in transitions}
    
    issue = client.get_issue(ticket_id)
    current_status = issue.get("fields", {}).get("status", {}).get("name", "")
    
    if ci_status == "green" and current_status == "TDD RED":
        # CI passed while in RED → move to GREEN
        if "tdd green" in transition_map:
            client.transition_issue(ticket_id, transition_map["tdd green"])
            client.add_comment(ticket_id, "🟢 CI GREEN — Auto-transitioned: TDD RED → TDD GREEN")
            return {"valid": True, "message": "Transitioned to TDD GREEN", "action": "transitioned"}
    
    elif ci_status == "red" and current_status in ("TDD GREEN", "Review"):
        # CI failed in GREEN → back to RED
        if "tdd red" in transition_map:
            client.transition_issue(ticket_id, transition_map["tdd red"])
            client.add_comment(ticket_id, "🔴 CI RED — Auto-transitioned back to TDD RED")
            return {"valid": True, "message": "Reverted to TDD RED", "action": "transitioned"}
    
    return {"valid": True, "message": "No transition needed", "action": "none"}


def main():
    parser = argparse.ArgumentParser(description="TDD Phase Enforcement Gate")
    parser.add_argument("--ticket", help="Jira ticket ID (e.g. KAN-123)")
    parser.add_argument("--files-changed", help="Space-separated list of changed files")
    parser.add_argument("--ci-status", choices=["green", "red"], help="CI status (for Actions)")
    parser.add_argument("--env-file", default=None, help="Path to .env file")
    args = parser.parse_args()
    
    # Load env
    if args.env_file:
        from jira_api_helper import load_env_file
        load_env_file(args.env_file)
    
    client = JiraClient()
    
    if args.ci_status and args.ticket:
        result = transition_on_ci_result(client, args.ticket, args.ci_status)
    elif args.ticket and args.files_changed:
        files = args.files_changed.split()
        result = validate_tdd_phase(client, args.ticket, files)
    else:
        parser.print_help()
        sys.exit(1)
    
    print(result["message"])
    sys.exit(0 if result["valid"] else 1)


if __name__ == "__main__":
    main()
