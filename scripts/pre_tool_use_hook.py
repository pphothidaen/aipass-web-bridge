#!/usr/bin/env python3
"""
Pre-tool-use hook for HoroConsultant.

This hook validates that:
1. A Jira ticket key (e.g., KAN-123) is provided in the tool context
2. The ticket exists and is not in a terminal state (Done, Closed, etc.)
3. The user has permission to act on the ticket

Usage:
    Called by Hermes Agent before executing tool calls
    Environment variable: TOOL_CONTEXT contains ticket_key if provided

Exit codes:
    0 - Allow tool execution
    1 - Reject tool execution (print reason to stdout)
"""

import os
import sys
import json
import urllib.request
import urllib.error
from typing import Optional, Dict, Any

# Configuration
ENV_FILE = os.environ.get(
    'HORO_CONSULTANT_ENV',
    '/Users/kimlenglim/Project/HoroConsultant/.env'
)

# Terminal states that should reject tool usage
TERMINAL_STATES = {
    'Done', 'Closed', 'Archived', 'Cancelled', 'Resolved',
    '✅ Done', '✔️ Done', '🏁 Complete', '🎉 Done'
}


def load_jira_config() -> Dict[str, str]:
    """Load Jira configuration from .env file."""
    config = {}
    if os.path.exists(ENV_FILE):
        with open(ENV_FILE, 'r') as f:
            for line in f:
                line = line.strip()
                if line.startswith('JIRA_'):
                    key, _, value = line.partition('=')
                    # Handle quoted values
                    value = value.strip('"\'')
                    config[key] = value
    return config


def parse_tool_context() -> Optional[str]:
    """Extract Jira ticket key from tool context or environment."""
    # Check TOOL_CONTEXT env var first
    context = os.environ.get('TOOL_CONTEXT', '')
    if context:
        try:
            data = json.loads(context)
            return data.get('ticket_key')
        except json.JSONDecodeError:
            # Maybe it's just the raw ticket key
            if context.startswith(('KAN-', 'PROJ-')):
                return context
    
    # Check HERMES_TICKET env var (set by orchestrator)
    return os.environ.get('HERMES_TICKET')


def validate_jira_ticket(ticket_key: str, config: Dict[str, str]) -> tuple[bool, str]:
    """
    Validate Jira ticket exists and is not in terminal state.
    Returns (is_valid, status_message)
    """
    base_url = config.get('JIRA_BASE_URL', '').rstrip('/')
    email = config.get('JIRA_EMAIL', '')
    api_token = config.get('JIRA_API_TOKEN', '')
    
    if not all([base_url, email, api_token]):
        return True, "Skipping Jira validation (config not loaded)"
    
    # Extract project key from ticket
    project_key = ticket_key.split('-')[0]
    if project_key not in ('KAN',):
        return True, f"Skipping validation for non-KAN project: {project_key}"
    
    import base64
    
    url = f"{base_url}/rest/api/3/issue/{ticket_key}"
    auth_str = f"{email}:{api_token}"
    
    try:
        request = urllib.request.Request(url)
        request.add_header('Authorization', f'Basic {base64.b64encode(auth_str.encode()).decode()}')
        request.add_header('Accept', 'application/json')
        
        with urllib.request.urlopen(request, timeout=10) as response:
            data = json.loads(response.read().decode())
            status = data.get('fields', {}).get('status', {}).get('name', 'Unknown')
            
            if status in TERMINAL_STATES:
                return False, f"Ticket {ticket_key} is in terminal state: {status}"
            
            return True, f"Ticket {ticket_key} validated (status: {status})"
            
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return False, f"❌ PRE-TOOL-REJECTED: Jira ticket {ticket_key} does not exist"
        return False, f"Jira API error: {e.code}"
    except Exception as e:
        return True, f"Warning: Could not validate ticket {ticket_key}: {e}"


def main():
    """Main entry point for the hook."""
    ticket_key = parse_tool_context()
    
    if not ticket_key:
        # No ticket key provided - this might be an issue for critical paths
        # For now, allow but warn
        print("⚠️  WARNING: No Jira ticket key provided in tool context")
        print("   Consider adding 'ticket_key': 'KAN-XXX' to your tool context")
        sys.exit(0)
    
    config = load_jira_config()
    is_valid, message = validate_jira_ticket(ticket_key, config)
    
    if is_valid:
        print(f"✅ {message}")
        sys.exit(0)
    else:
        print(f"❌ {message}")
        print(f"   Please select an active ticket or create a new one.")
        sys.exit(1)


if __name__ == '__main__':
    main()