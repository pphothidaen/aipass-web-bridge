#!/usr/bin/env python3
"""
secretary_agent — CLI wrapper for the Middle Gateway / Secretary.

Usage:
    python3 packages/secretary_agent.py run "Enhance monitor.py..."
    python3 packages/secretary_agent.py dry-run "Enhance monitor.py..."
    python3 packages/secretary_agent.py skills list
    python3 packages/secretary_agent.py skills show <hash>

Alternatively:
    python3 run_secretary.py run "Enhance monitor.py..."
"""
import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from secretary import run_with_secretary, gather_context, should_consult, call_consultant, list_skills, SKILLS_DIR
import json
import argparse


def print_result(result):
    print("\n=== Result Summary ===")
    print(json.dumps(result.get("result_summary", {}), indent=2, ensure_ascii=False))
    print("\n=== Execution Details ===")
    exec_result = result.get("execution", {})
    if isinstance(exec_result, dict) and "results" in exec_result:
        for r in exec_result["results"]:
            status = "✅" if r.get("success") else "❌"
            print(f"{status} Step {r.get('step')}: {r.get('description')}")
            print(f"    CMD: {r.get('command')}")
            if r.get("stdout"):
                print(f"    STDOUT: {r.get('stdout')}")
            if r.get("stderr"):
                print(f"    STDERR: {r.get('stderr')}")
            print()


def main():
    p = argparse.ArgumentParser(prog="secretary_agent", description="Middle Gateway / Secretary CLI")
    sub = p.add_subparsers(dest="cmd")

    run_p = sub.add_parser("run", help="Run request with Secretary")
    run_p.add_argument("request", nargs="+", help="User request string")
    run_p.add_argument("--cwd", default=None, help="Working directory")
    run_p.add_argument("--no-save", action="store_true", help="Do not save skill on success")
    run_p.add_argument("--no-heal", action="store_true", help="Disable self-healing")

    dry_p = sub.add_parser("dry-run", help="Build context + plan without executing")
    dry_p.add_argument("request", nargs="+", help="User request string")
    dry_p.add_argument("--cwd", default=None, help="Working directory")

    skills_p = sub.add_parser("skills", help="Skill management")
    skills_sub = skills_p.add_subparsers(dest="skill_cmd")
    skills_sub.add_parser("list", help="List saved skills")
    show_p = skills_sub.add_parser("show", help="Show a saved skill by hash")
    show_p.add_argument("hash", help="Skill hash (filename without .json)")

    args = p.parse_args()

    if args.cmd == "run":
        request = " ".join(args.request)
        cwd = os.path.realpath(args.cwd) if args.cwd else os.getcwd()
        result = run_with_secretary(
            request,
            cwd=cwd,
            save_skill_if_success=not args.no_save,
            auto_heal=not args.no_heal,
        )
        print_result(result)

    elif args.cmd == "dry-run":
        request = " ".join(args.request)
        cwd = os.path.realpath(args.cwd) if args.cwd else os.getcwd()
        context = gather_context(request, cwd)
        print("\n=== Context ===")
        print(json.dumps(context, indent=2, ensure_ascii=False))
        use_consult = should_consult(request, context)
        print(f"\nWould consult: {use_consult}")
        if use_consult:
            plan = call_consultant(request, context)
            if plan:
                print("\n=== Plan ===")
                print(json.dumps(plan, indent=2, ensure_ascii=False))
            else:
                print("\n[Secretary] Could not reach Consultant")
        else:
            print("\n[Secretary] Would run directly (no consultation)")

    elif args.cmd == "skills":
        if args.skill_cmd == "list":
            skills = list_skills()
            if not skills:
                print("No skills saved yet.")
            else:
                print("\n=== Saved Skills ===")
                for s in skills:
                    print(f"- {s['hash']}: {s['goal'] or s['request'][:80]}")
                    print(f"    saved: {s['saved_at']}")
        elif args.skill_cmd == "show":
            path = SKILLS_DIR / (args.hash + ".json")
            if not path.exists():
                print(f"Skill not found: {args.hash}")
            else:
                print(path.read_text())
        else:
            p.print_help()
            sys.exit(1)
    else:
        p.print_help()
        sys.exit(1)


if __name__ == "__main__":
    main()
