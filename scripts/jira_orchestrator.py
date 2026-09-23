#!/usr/bin/env python3
"""
Orchestrator Monitor — Hermes views Jira board and delegates work.

This script is designed to be called by Hermes Agent (via execute_code or terminal).
It provides:
  1. Current board status summary (by status, by agent)
  2. Ready-to-delegate tickets (Ready status, unassigned)
  3. Stale tickets alert (In Progress > 24h)
  4. Orphan detection (Epics without Stories)
  5. TDD phase distribution

Usage:
  python3 scripts/jira_orchestrator.py
  python3 scripts/jira_orchestrator.py --ready-only
  python3 scripts/jira_orchestrator.py --stale-only
  python3 scripts/jira_orchestrator.py --full-board
"""

import os
import sys
import json
import argparse
from typing import Dict, List, Any
from collections import defaultdict
from datetime import datetime, timezone, timedelta

sys.path.insert(0, os.path.dirname(__file__))
from jira_api_helper import JiraClient, load_env_file


class OrchestratorMonitor:
    """Monitor Jira board for orchestrator delegation decisions."""

    def __init__(self, client: JiraClient):
        self.client = client
        self.project = "KAN"

    def get_full_board_summary(self) -> Dict[str, Any]:
        """Get complete board status for orchestrator overview."""
        print("📊 === JIRA BOARD SUMMARY ===\n")

        # 1. Get all active tickets
        issues = self.client.search_issues(
            f"project = {self.project} AND status != Done AND status != Closed",
            max_results=200
        )

        # Group by status
        by_status = defaultdict(list)
        by_agent = defaultdict(list)
        by_priority = defaultdict(list)

        for issue in issues:
            fields = issue.get("fields", {})
            status = fields.get("status", {}).get("name", "Unknown")
            assignee = fields.get("assignee", {})
            assignee_name = assignee.get("displayName", "Unassigned") if assignee else "Unassigned"
            labels = fields.get("labels", [])

            # Find agent label
            agent_label = "unassigned"
            for label in labels:
                if label.startswith("agent-"):
                    agent_label = label
                    break

            priority = fields.get("priority", {}).get("name", "None")
            summary = fields.get("summary", "")
            key = issue.get("key", "")

            ticket_info = {
                "key": key,
                "summary": summary[:60],
                "assignee": assignee_name,
                "agent_label": agent_label,
                "priority": priority,
                "updated": fields.get("updated", ""),
            }

            by_status[status].append(ticket_info)
            by_agent[agent_label].append(ticket_info)
            by_priority[priority].append(ticket_info)

        # Print summary
        print(f"Total active tickets: {len(issues)}\n")

        print("--- By Status ---")
        for status, tickets in sorted(by_status.items()):
            print(f"  {status}: {len(tickets)}")
            for t in tickets[:5]:
                print(f"    • {t['key']} [{t['priority']}] {t['summary']}")
            if len(tickets) > 5:
                print(f"    ... and {len(tickets) - 5} more")
            print()

        print("--- By Agent ---")
        for agent, tickets in sorted(by_agent.items(), key=lambda x: -len(x[1])):
            print(f"  {agent}: {len(tickets)} tickets")
            for t in tickets[:3]:
                print(f"    • {t['key']} [{t['summary'][:40]}]")

        print()

        return {
            "total": len(issues),
            "by_status": {k: len(v) for k, v in by_status.items()},
            "by_agent": {k: len(v) for k, v in by_agent.items()},
        }

    def get_ready_to_delegate(self) -> List[Dict]:
        """Find tickets in Ready status that need assignment."""
        print("🎯 === READY TO DELEGATE ===\n")

        issues = self.client.search_issues(
            f"project = {self.project} AND status = 'Ready' AND assignee is EMPTY",
            max_results=50
        )

        if not issues:
            print("  No tickets ready for delegation.\n")
            return []

        print(f"  Found {len(issues)} unassigned Ready tickets:\n")

        for issue in issues:
            fields = issue.get("fields", {})
            key = issue.get("key", "")
            summary = fields.get("summary", "")
            labels = fields.get("labels", [])
            priority = fields.get("priority", {}).get("name", "None")
            issue_type = fields.get("issuetype", {}).get("name", "Unknown")

            # Find agent label (if pre-assigned)
            agent_label = "unassigned"
            for label in labels:
                if label.startswith("agent-"):
                    agent_label = label
                    break

            print(f"  🎫 {key} [{issue_type}] Priority: {priority}")
            print(f"     Summary: {summary}")
            print(f"     Agent Label: {agent_label}")
            print(f"     Labels: {', '.join(labels)}")

            # Check parent (if subtask)
            parent = fields.get("parent")
            if parent:
                print(f"     Parent: {parent.get('key', '')} — {parent.get('fields', {}).get('summary', '')[:50]}")

            # Suggest agent based on labels
            if agent_label == "unassigned":
                # Suggest based on issue type / component
                if issue_type == "Epic":
                    print(f"     💡 Suggested: Hermes (orchestrator)")
                elif "redteam" in labels:
                    print(f"     💡 Suggested: agy/codex with red-team skill")
                elif "blueteam" in labels:
                    print(f"     💡 Suggested: Hermes + gitleaks CI")
                else:
                    print(f"     💡 Suggested: agy1-4 or codex1-3")

            print()

        return [
            {
                "key": i.get("key"),
                "summary": i.get("fields", {}).get("summary", ""),
                "labels": i.get("fields", {}).get("labels", []),
                "priority": i.get("fields", {}).get("priority", {}).get("name", ""),
            }
            for i in issues
        ]

    def get_stale_tickets(self, hours: int = 24) -> List[Dict]:
        """Find tickets that have been in progress too long."""
        print(f"⏰ === STALE TICKETS (>{hours}h in progress) ===\n")

        issues = self.client.search_issues(
            f"project = {self.project} AND status = 'In Progress' AND updated < -{hours}h",
            max_results=50
        )

        if not issues:
            print(f"  No stale tickets (all active within {hours}h).\n")
            return []

        print(f"  Found {len(issues)} stale tickets:\n")

        for issue in issues:
            fields = issue.get("fields", {})
            key = issue.get("key", "")
            summary = fields.get("summary", "")
            assignee = fields.get("assignee", {})
            assignee_name = assignee.get("displayName", "Unassigned") if assignee else "Unassigned"
            updated = fields.get("updated", "")

            print(f"  🚨 {key} — Last updated: {updated}")
            print(f"     Summary: {summary}")
            print(f"     Assignee: {assignee_name}")
            print(f"     ⚠️ Action: Escalate to Hermes for health-check")
            print()

        return [
            {
                "key": i.get("key"),
                "summary": i.get("fields", {}).get("summary", ""),
                "assignee": i.get("fields", {}).get("assignee", {}).get("displayName", "Unassigned"),
                "updated": i.get("fields", {}).get("updated", ""),
            }
            for i in issues
        ]

    def get_orphan_epics(self, days: int = 7) -> List[Dict]:
        """Find Epics without Stories."""
        print(f"🏚️ === ORPHAN EPICS (no Stories for {days}+ days) ===\n")

        issues = self.client.search_issues(
            f"project = {self.project} AND issuetype = Epic AND updated < -{days}d",
            max_results=50
        )

        orphans = []
        for issue in issues:
            fields = issue.get("fields", {})
            key = issue.get("key", "")
            summary = fields.get("summary", "")
            updated = fields.get("updated", "")

            # Count children via JQL
            children = self.client.search_issues(
                f"project = {self.project} AND 'Epic Link' = {key}",
                max_results=1
            )

            if not children:
                print(f"  🏚️ {key} — No Stories linked")
                print(f"     Summary: {summary}")
                print(f"     Last updated: {updated}")
                print(f"     ⚠️ Action: Add Stories or close Epic")
                print()
                orphans.append({
                    "key": key,
                    "summary": summary,
                    "updated": updated,
                })

        if not orphans:
            print(f"  No orphan epics (all have Stories).\n")

        return orphans

    def get_tdd_phase_distribution(self) -> Dict[str, int]:
        """Get distribution of tickets across TDD phases."""
        print("🔴🟢📋 === TDD PHASE DISTRIBUTION ===\n")

        phases = ["TDD RED", "TDD GREEN", "Review", "Ready", "In Progress", "Blocked"]
        distribution = {}

        for phase in phases:
            issues = self.client.search_issues(
                f"project = {self.project} AND status = '{phase}'",
                max_results=200
            )
            distribution[phase] = len(issues)
            print(f"  {phase}: {len(issues)}")

        print()
        return distribution

    def generate_delegation_recommendations(self) -> List[Dict]:
        """Generate delegation recommendations for Hermes."""
        print("🤖 === DELEGATION RECOMMENDATIONS ===\n")

        recommendations = []

        # 1. Ready tickets without assignee
        ready = self.client.search_issues(
            f"project = {self.project} AND status = 'Ready' AND assignee is EMPTY",
            max_results=10
        )

        for issue in ready:
            fields = issue.get("fields", {})
            labels = fields.get("labels", [])
            issue_type = fields.get("issuetype", {}).get("name", "")

            # Determine best agent
            agent = "agy1"  # default
            if "redteam" in labels:
                agent = "agy with red-team skill"
            elif "blueteam" in labels:
                agent = "Hermes + gitleaks"
            elif issue_type == "Epic":
                agent = "Hermes"

            rec = {
                "action": "DELEGATE",
                "ticket": issue.get("key"),
                "summary": fields.get("summary", "")[:60],
                "recommended_agent": agent,
                "priority": fields.get("priority", {}).get("name", "Medium"),
            }
            recommendations.append(rec)
            print(f"  🎯 DELEGATE {issue.get('key')} → {agent}")
            print(f"     {rec['summary']}")
            print()

        # 2. Stale tickets
        stale = self.client.search_issues(
            f"project = {self.project} AND status = 'In Progress' AND updated < -24h",
            max_results=10
        )

        for issue in stale:
            fields = issue.get("fields", {})
            assignee = fields.get("assignee", {}).get("displayName", "Unassigned")

            rec = {
                "action": "ESCALATE",
                "ticket": issue.get("key"),
                "summary": fields.get("summary", "")[:60],
                "assignee": assignee,
                "reason": "Stale >24h",
            }
            recommendations.append(rec)
            print(f"  🚨 ESCALATE {issue.get('key')} — Stale, assigned to {assignee}")
            print()

        # 3. Orphan epics
        orphans = self.get_orphan_epics(days=7)
        for orphan in orphans:
            rec = {
                "action": "INVESTIGATE",
                "ticket": orphan["key"],
                "summary": orphan["summary"][:60],
                "reason": "Orphan Epic — no Stories linked",
            }
            recommendations.append(rec)

        if not recommendations:
            print("  ✅ No delegation actions needed right now.")

        print()
        return recommendations


def main():
    parser = argparse.ArgumentParser(description="Jira Orchestrator Monitor")
    parser.add_argument("--full-board", action="store_true", help="Show complete board summary")
    parser.add_argument("--ready-only", action="store_true", help="Show only Ready tickets")
    parser.add_argument("--stale-only", action="store_true", help="Show only stale tickets")
    parser.add_argument("--orphans", action="store_true", help="Show orphan epics")
    parser.add_argument("--tdd-dist", action="store_true", help="Show TDD phase distribution")
    parser.add_argument("--recommend", action="store_true", help="Generate delegation recommendations")
    parser.add_argument("--env-file", default="/Users/kimlenglim/Project/HoroConsultant/.env")
    args = parser.parse_args()

    # Load env
    load_env_file(args.env_file)

    try:
        client = JiraClient()
        monitor = OrchestratorMonitor(client)

        # Default action if no args specified
        if not any([args.full_board, args.ready_only, args.stale_only, args.orphans, args.tdd_dist, args.recommend]):
            args.full_board = True
            args.recommend = True

        if args.full_board:
            monitor.get_full_board_summary()

        if args.ready_only or args.full_board:
            monitor.get_ready_to_delegate()

        if args.stale_only or args.full_board:
            monitor.get_stale_tickets(hours=24)

        if args.orphans:
            monitor.get_orphan_epics(days=7)

        if args.tdd_dist:
            monitor.get_tdd_phase_distribution()

        if args.recommend:
            monitor.generate_delegation_recommendations()

    except EnvironmentError as e:
        print(f"❌ {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
