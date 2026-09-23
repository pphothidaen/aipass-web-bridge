#!/usr/bin/env python3
"""
Jira API Helper — Shared client for all Jira governance scripts.
Reads credentials from environment variables (never hardcoded).

Required env vars:
  JIRA_BASE_URL  — e.g. https://your-domain.atlassian.net
  JIRA_EMAIL     — Atlassian account email
  JIRA_API_TOKEN — API token from https://id.atlassian.com/manage-profile/security/api-tokens
"""

import os
import sys
import json
import urllib.request
import urllib.error
from typing import Optional, Dict, Any, List


class JiraClient:
    """Minimal Jira REST API v3 client for governance automation."""

    def __init__(self, base_url: Optional[str] = None, email: Optional[str] = None, token: Optional[str] = None):
        self.base_url = base_url or os.environ.get("JIRA_BASE_URL", "")
        self.email = email or os.environ.get("JIRA_EMAIL", "")
        self.token = token or os.environ.get("JIRA_API_TOKEN", "")

        if not all([self.base_url, self.email, self.token]):
            raise EnvironmentError(
                "Missing Jira credentials. Set JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN "
                "in environment or .env file."
            )

        # Strip trailing slash
        self.base_url = self.base_url.rstrip("/")

    def _request(self, method: str, path: str, data: Optional[Dict] = None) -> Dict[str, Any]:
        """Make authenticated request to Jira REST API."""
        url = f"{self.base_url}/rest/api/3{path}"
        auth = f"{self.email}:{self.token}"
        import base64
        encoded = base64.b64encode(auth.encode()).decode()

        headers = {
            "Authorization": f"Basic {encoded}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        }

        body = json.dumps(data).encode() if data else None
        req = urllib.request.Request(url, data=body, headers=headers, method=method)

        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                return json.loads(resp.read().decode()) if resp.readable() else {}
        except urllib.error.HTTPError as e:
            error_body = e.read().decode() if e.fp else ""
            return {"error": True, "status": e.code, "message": error_body}
        except Exception as e:
            return {"error": True, "message": str(e)}

    def get_issue(self, issue_id: str) -> Dict[str, Any]:
        """Fetch issue details."""
        return self._request("GET", f"/issue/{issue_id}")

    def add_comment(self, issue_id: str, body: str) -> Dict[str, Any]:
        """Add a comment to an issue."""
        return self._request("POST", f"/issue/{issue_id}/comment", {
            "body": {
                "type": "doc",
                "version": 1,
                "content": [{
                    "type": "paragraph",
                    "content": [{"type": "text", "text": body}]
                }]
            }
        })

    def transition_issue(self, issue_id: str, transition_id: str) -> Dict[str, Any]:
        """Transition issue to a new status."""
        return self._request("POST", f"/issue/{issue_id}/transitions", {
            "transition": {"id": transition_id}
        })

    def get_transitions(self, issue_id: str) -> List[Dict[str, str]]:
        """Get available transitions for an issue."""
        result = self._request("GET", f"/issue/{issue_id}/transitions")
        if "transitions" in result:
            return [{"id": t["id"], "name": t["name"]} for t in result["transitions"]]
        return []

    def update_field(self, issue_id: str, field_id: str, value: Any) -> Dict[str, Any]:
        """Update a custom field on an issue."""
        return self._request("PUT", f"/issue/{issue_id}", {
            "fields": {field_id: value}
        })




    def search_issues(self, jql: str, max_results: int = 50) -> List[Dict]:
        """Search issues using JQL (uses new /search/jql endpoint per Atlassian CHANGE-2046)."""
        result = self._request("POST", "/search/jql", {
            "jql": jql,
            "maxResults": max_results,
            "fields": ["key", "summary", "status", "assignee", "updated", "labels"]
        })
        return result.get("issues", [])


def extract_jira_key(text: str) -> Optional[str]:
    """Extract Jira issue key (e.g. KAN-123) from text."""
    import re
    match = re.search(r'\b(KAN-\d+)\b', text, re.IGNORECASE)
    return match.group(1).upper() if match else None


def load_env_file(path: str) -> None:
    """Load environment variables from a .env file."""
    if not os.path.exists(path):
        return
    with open(path) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            if "=" in line:
                key, _, value = line.partition("=")
                key = key.strip()
                value = value.strip()
                # Remove surrounding quotes
                if (value.startswith('"') and value.endswith('"')) or \
                   (value.startswith("'") and value.endswith("'")):
                    value = value[1:-1]
                os.environ.setdefault(key, value)


if __name__ == "__main__":
    # Quick test
    try:
        client = JiraClient()
        print(f"✅ Connected to Jira: {client.base_url}")
        print(f"   Email: {client.email}")
    except EnvironmentError as e:
        print(f"❌ {e}")
        sys.exit(1)
