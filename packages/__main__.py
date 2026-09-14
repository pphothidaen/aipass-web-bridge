"""
Middle Gateway / Secretary — package entry point.

Run with:
    python3 -m packages run "Enhance monitor.py..."
    python3 -m packages dry-run "Enhance monitor.py..."
    python3 -m packages skills list
    python3 -m packages skills show <hash>

Or use the wrapper script:
    python3 run_secretary.py run "Enhance monitor.py..."
"""
import sys

from .secretary import run_with_secretary, gather_context, should_consult, call_consultant, list_skills, SKILLS_DIR
import json
import os
import argparse


def main():
    p = argparse.ArgumentParser(prog="packages", description="Middle Gateway / Secretary")
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


def print_result(result):
    print("\n=== Result Summary ===")
    print(json.dumps(result.get("result_summary", {}), indent=2, ensure_ascii=False))
    if "execution" in result and isinstance(result["execution"], dict) and "results" in result["execution"]:
        print("\n=== Execution Details ===")
        for r in result["execution"]["results"]:
            status = "✅" if r.get("success") else "❌"
            print(f"{status} Step {r.get('step')}: {r.get('description')}")
            print(f"    CMD: {r.get('command')}")
            if r.get("stdout"):
                print(f"    STDOUT: {r.get('stdout')}")
            if r.get("stderr"):
                print(f"    STDERR: {r.get('stderr')}")
            print()


if __name__ == "__main__":
    main()
