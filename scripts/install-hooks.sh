#!/usr/bin/env bash
# Install git hooks for aipass-web-bridge governance
# Run: bash scripts/install-hooks.sh

set -euo pipefail

HOOKS_DIR=".git/hooks"
SCRIPT_DIR="scripts/hooks"

echo "Installing Git hooks for governance enforcement..."

# Create hooks directory if it doesn't exist
mkdir -p "$HOOKS_DIR"

# Function to install a hook
install_hook() {
  local hook_name="$1"
  local description="$2"
  
  if [ -f "$SCRIPT_DIR/$hook_name" ]; then
    cp "$SCRIPT_DIR/$hook_name" "$HOOKS_DIR/$hook_name"
    chmod +x "$HOOKS_DIR/$hook_name"
    echo "✅ Installed $hook_name ($description)"
  else
    echo "❌ $hook_name script not found at $SCRIPT_DIR/$hook_name"
    return 1
  fi
}

# Install all governance hooks
install_hook "pre-commit" "Secret scan + Jira ticket validation"
install_hook "commit-msg" "Jira key + 5W1H completeness enforcement"
install_hook "prepare-commit-msg" "Auto-inject 5W1H template"
install_hook "post-commit" "Push commit info to Jira"
install_hook "pre-push" "Test suite + atomic gate + Jira validation"

echo ""
echo "All governance hooks installed successfully!"
echo ""
echo "Installed hooks:"
echo "  - pre-commit: Secret scan + Jira ticket existence/status check"
echo "  - commit-msg: Jira key + 5W1H completeness enforcement"
echo "  - prepare-commit-msg: Auto-inject 5W1H template from branch name"
echo "  - post-commit: Push commit info to Jira"
echo "  - pre-push: Test suite + atomic gate + Jira validation"
echo ""
echo "Jira credentials loaded from: ${HORO_CONSULTANT_ENV:-/Users/kimlenglim/Project/HoroConsultant/.env}"
echo ""
echo "To bypass hooks in emergency (not recommended):"
echo "  git commit --no-verify"
echo "  git push --no-verify"
