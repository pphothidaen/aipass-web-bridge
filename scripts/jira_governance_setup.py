#!/usr/bin/env python3
"""
Jira Governance Setup — Automate Jira configuration via REST API.
Sets up custom statuses, custom fields, and automation rules.

Required env vars (loaded from /Users/kimlenglim/Project/HoroConsultant/.env):
  JIRA_BASE_URL
  JIRA_EMAIL
  JIRA_API_TOKEN

Usage:
  python3 scripts/jira_governance_setup.py
  python3 scripts/jira_governance_setup.py --dry-run
"""

import os
import sys
import json
import time
import argparse
from typing import Dict, List, Optional, Any

sys.path.insert(0, os.path.dirname(__file__))
from jira_api_helper import JiraClient, load_env_file


PROJECT_KEY = "KAN"

# Custom statuses to create
CUSTOM_STATUSES = [
    {"name": "TDD RED", "description": "Failing test written — implementation pending", "category": "To Do"},
    {"name": "TDD GREEN", "description": "Test passes — implementation complete", "category": "In Progress"},
    {"name": "Review", "description": "Code review in progress", "category": "In Progress"},
]

# Custom fields to create
CUSTOM_FIELDS = [
    {
        "name": "TDD Phase",
        "type": "com.atlassian.jira.plugin.system.customfieldtypes:select",
        "description": "Current TDD phase for this ticket",
        "options": ["RED", "GREEN", "REVIEW", "N/A"]
    },
    {
        "name": "Epic Link",
        "type": "com.atlassian.jira.plugin.system.customfieldtypes:epiclink",
        "description": "Parent epic for this story/subtask",
    }
]

# Automation rules to create (Jira Cloud Automation API)
AUTOMATION_RULES = [
    {
        "name": "PR Opened → Review",
        "trigger": {"type": "webhook", "filter": {"pull_request": {"action": "opened"}}},
        "action": {"type": "transition", "status": "Review", "comment": "PR opened: {{pullRequest.url}}"}
    },
    {
        "name": "PR Merged → Done",
        "trigger": {"type": "webhook", "filter": {"pull_request": {"action": "merged"}}},
        "action": {"type": "transition", "status": "Done", "comment": "PR merged by {{author.displayName}}"}
    },
    {
        "name": "Branch Created → In Progress",
        "trigger": {"type": "webhook", "filter": {"branch": {"action": "created", "regex": "KAN-\\d+"}}},
        "action": {"type": "transition", "status": "In Progress"}
    },
    {
        "name": "CI Failed → TDD RED",
        "trigger": {"type": "webhook", "filter": {"check_run": {"conclusion": "failed"}}},
        "action": {"type": "transition", "status": "TDD RED", "comment": "CI failed — {{checkRun.name}}"}
    },
    {
        "name": "Orphan Epic Alert",
        "trigger": {"type": "schedule", "cron": "0 9 * * *"},
        "filter": {"jql": "project = KAN AND issuetype = Epic AND updated < -7d AND issuesCount = 0"},
        "action": {"type": "comment", "comment": "⚠️ Orphan Epic — no Stories for 7+ days"}
    },
    {
        "name": "Stale In-Progress Alert",
        "trigger": {"type": "schedule", "cron": "0 */4 * * *"},
        "filter": {"jql": "project = KAN AND status = 'In Progress' AND updated < -24h"},
        "action": {"type": "comment", "comment": "⏰ In Progress >24h — needs attention"}
    },
]


class JiraGovernanceSetup:
    """Automate Jira governance setup via REST API."""

    def __init__(self, client: JiraClient, dry_run: bool = False):
        self.client = client
        self.dry_run = dry_run
        self.project_id: Optional[str] = None
        self.workflow_scheme_id: Optional[str] = None

    def setup(self) -> None:
        """Run full setup: statuses, fields, automation rules."""
        print("=" * 60)
        print("🚀 Jira Governance Setup")
        print("=" * 60)
        print(f"Project: {PROJECT_KEY}")
        print(f"Base URL: {self.client.base_url}")
        print(f"Dry run: {self.dry_run}")
        print()

        # Step 1: Verify project exists
        self._verify_project()

        # Step 2: Create custom statuses
        self._create_custom_statuses()

        # Step 3: Create custom fields
        self._create_custom_fields()

        # Step 4: Add statuses to project workflow
        self._update_workflow()

        # Step 5: Create automation rules
        self._create_automation_rules()

        # Step 6: Verify setup
        self._verify_setup()

        print()
        print("=" * 60)
        print("✅ Setup complete!")
        print("=" * 60)

    def _verify_project(self) -> None:
        """Verify project exists and get ID."""
        print("📌 Verifying project...")
        result = self.client._request("GET", f"/project/{PROJECT_KEY}")

        if result.get("error"):
            print(f"❌ Project {PROJECT_KEY} not found: {result.get('message')}")
            sys.exit(1)

        self.project_id = result.get("id")
        print(f"   ✅ Project ID: {self.project_id}")

        # Get project statuses
        statuses = self.client._request("GET", f"/project/{PROJECT_KEY}/statuses")
        existing = [s["name"] for t in statuses for s in t.get("statuses", [])]
        print(f"   Existing statuses: {existing}")
        print()

    def _create_custom_statuses(self) -> None:
        """Create custom statuses for TDD governance."""
        print("📌 Creating custom statuses...")

        # Get existing statuses
        result = self.client._request("GET", "/status")
        existing_names = {s["name"].lower() for s in result}  # type: ignore[arg-type]

        for status in CUSTOM_STATUSES:
            name = status["name"]
            if name.lower() in existing_names:
                print(f"   ⏭️ {name} already exists")
                continue

            if self.dry_run:
                print(f"   🔸 Would create status: {name}")
                continue

            # Create status
            result = self.client._request("POST", "/status", {
                "name": name,
                "description": status["description"],
                "statusCategory": self._get_status_category(status["category"]),
            })

            if result.get("error"):
                print(f"   ❌ Failed to create {name}: {result.get('message')}")
            else:
                print(f"   ✅ Created status: {name}")

            time.sleep(0.5)  # Rate limiting

        print()

    def _create_custom_fields(self) -> None:
        """Create custom fields for governance tracking."""
        print("📌 Creating custom fields...")

        # Get existing fields
        result = self.client._request("GET", "/field")
        existing = {f["name"].lower(): f["id"] for f in result}

        for field in CUSTOM_FIELDS:
            name = field["name"]
            if name.lower() in existing:
                print(f"   ⏭️ {name} already exists: {existing[name.lower()]}")
                continue

            if self.dry_run:
                print(f"   🔸 Would create field: {name} ({field['type']})")
                continue

            # Create field
            data = {
                "name": name,
                "type": field["type"],
                "description": field.get("description", ""),
            }

            if "options" in field:
                # For select fields, we need to add context with options
                pass

            result = self.client._request("POST", "/field", data)

            if result.get("error"):
                print(f"   ❌ Failed to create {name}: {result.get('message')}")
            else:
                print(f"   ✅ Created field: {name}")

            time.sleep(0.5)

        print()

    def _update_workflow(self) -> None:
        """Add custom statuses to the project workflow."""
        print("📌 Updating workflow to include new statuses...")

        if self.dry_run:
            print("   🔸 Would add TDD RED, TDD GREEN, Review to workflow")
            print()
            return

        # Get workflow scheme for project
        schemes = self.client._request("GET", f"/project/{PROJECT_KEY}/workflowscheme")

        if schemes.get("error") or not schemes.get("values"):
            print("   ⚠️ Could not get workflow scheme — manual step required")
            print("   → Go to Jira Settings → Workflows → Add statuses to workflow")
            print()
            return

        scheme = schemes["values"][0]
        self.workflow_scheme_id = scheme.get("workflowScheme", {}).get("id")
        print(f"   Workflow scheme ID: {self.workflow_scheme_id}")

        # Note: Full workflow modification requires:
        # 1. Creating a draft workflow
        #  # 2. Adding statuses
        # 3. Publishing the draft
        # This is complex via API — recommend UI for this step
        print("   ⚠️ Workflow update via API is complex")
        print("   → Go to Jira Settings → Workflows → Edit workflow")
        print("   → Add statuses: TDD RED, TDD GREEN, Review")
        print()

    def _create_automation_rules(self) -> None:
        """Create automation rules via Jira Cloud Automation API."""
        print("📌 Creating automation rules...")

        # Jira Automation API endpoint
        base = self.client.base_url

        for rule in AUTOMATION_RULES:
            name = rule["name"]

            if self.dry_run:
                print(f"   🔸 Would create rule: {name}")
                continue

            # Build rule payload
            payload = {
                "name": name,
                "state": "ENABLED",
                "trigger": self._build_trigger(rule["trigger"]),
                "components": self._build_components(rule),
                "projects": [{"projectId": self.project_id}],
            }

            # Create via automation API
            result = self.client._request(
                "POST",
                "/rest/automation/1.0/rule",
                payload
            )

            if result.get("error"):
                print(f"   ❌ Failed to create {name}: {result.get('message')}")
            else:
                rule_id = result.get("id", "?")
                print(f"   ✅ Created rule: {name} (ID: {rule_id})")

            time.sleep(0.5)

        print()

    def _build_trigger(self, trigger: Dict) -> Dict:
        """Build Jira Automation trigger payload."""
        if trigger["type"] == "webhook":
            return {
                "type": "webhook-event",
                "filter": trigger["filter"]
            }
        elif trigger["type"] == "schedule":
            return {
                "type": "cron-expression",
                "cron": trigger["cron"]
            }
        return {}

    def _build_components(self, rule: Dict) -> List[Dict]:
        """Build Jira Automation components list."""
        components = []

        # Add filter if specified
        if "filter" in rule and "jql" in rule["filter"]:
            components.append({
                "type": "jql-condition",
                "query": rule["filter"]["jql"]
            })

        # Add action
        action = rule["action"]
        if action["type"] == "transition":
            components.append({
                "type": "transition-issue",
                "value": {"to": action["status"]}
            })
        elif action["type"] == "comment":
            components.append({
                "type": "add-comment",
                "comment": action["comment"]
            })

        return components

    def _get_status_category(self, category_name: str) -> str:
        """Map category name to Jira status category key."""
        return {
            "To Do": "2",
            "In Progress": "4",
            "Done": "3",
        }.get(category_name, "2")

    def _verify_setup(self) -> None:
        """Verify setup by listing created items."""
        print("📌 Verifying setup...")

        # Check statuses
        result = self.client._request("GET", "/status")
        all_statuses = {s["name"] for s in result}
        for status in CUSTOM_STATUSES:
            if status["name"] in all_statuses:
                print(f"   ✅ Status '{status['name']}' exists")
            else:
                print(f"   ❌ Status '{status['name']}' NOT FOUND")

        # Check fields
        result = self.client._request("GET", "/field")
        field_names = {f["name"] for f in result}
        for field in CUSTOM_FIELDS:
            if field["name"] in field_names:
                print(f"   ✅ Field '{field['name']}' exists")
            else:
                print(f"   ❌ Field '{field['name']}' NOT FOUND")

        print()


def main():
    parser = argparse.ArgumentParser(description="Jira Governance Setup via API")
    parser.add_argument("--dry-run", action="store_true", help="Show what would be done without making changes")
    parser.add_argument("--env-file", default="/Users/kimlenglim/Project/HoroConsultant/.env")
    args = parser.parse_args()

    # Load env
    load_env_file(args.env_file)

    try:
        client = JiraClient()
        setup = JiraGovernanceSetup(client, dry_run=args.dry_run)
        setup.setup()
    except EnvironmentError as e:
        print(f"❌ {e}")
        sys.exit(1)
    except KeyboardInterrupt:
        print("\n⚠️ Aborted")
        sys.exit(1)


if __name__ == "__main__":
    main()
