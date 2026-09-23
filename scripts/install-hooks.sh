#!/usr/bin/env bash
# Install git hooks for aipass-web-bridge
# Run: bash scripts/install-hooks.sh

set -euo pipefail

HOOKS_DIR=".git/hooks"
SCRIPT_DIR="scripts/hooks"

echo "Installing Git hooks..."

# Create hooks directory if it doesn't exist
mkdir -p "$HOOKS_DIR"

# Install pre-commit hook
if [ -f "$SCRIPT_DIR/pre-commit" ]; then
  cp "$SCRIPT_DIR/pre-commit" "$HOOKS_DIR/pre-commit"
  chmod +x "$HOOKS_DIR/pre-commit"
  echo "✅ Installed pre-commit hook"
else
  echo "❌ pre-commit hook script not found at $SCRIPT_DIR/pre-commit"
  exit 1
fi

# Install pre-push hook
if [ -f "$SCRIPT_DIR/pre-push" ]; then
  cp "$SCRIPT_DIR/pre-push" "$HOOKS_DIR/pre-push"
  chmod +x "$HOOKS_DIR/pre-push"
  echo "✅ Installed pre-push hook"
else
  echo "❌ pre-push hook script not found at $SCRIPT_DIR/pre-push"
  exit 1
fi

echo ""
echo "Git hooks installed successfully!"
echo "  - pre-commit: Validates Jira key in message + secret scan"
echo "  - pre-push: Runs npm test before push"
echo ""
echo "To bypass hooks in emergency (not recommended):"
echo "  git commit --no-verify"
echo "  git push --no-verify"
