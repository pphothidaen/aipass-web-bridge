# AiPASS Dev Suite Guidelines

## Versioning & Release Notes (Mandatory Rule)

- Whenever any code modifications, features, bug fixes, or UI changes are made:
  1. Bump the version number in `package.json` (and `manifest.json` where applicable) following Semantic Versioning (`MAJOR.MINOR.PATCH`).
  2. Keep default version variables in source code synchronized with `package.json`.
  3. Add or update release notes in `CHANGELOG.md` documenting all additions, changes, and fixes.
  4. Ensure all automated tests (`npm test`) pass 100% and rebuild/re-package the extension.

## Extensions Release Guidelines

- See detailed release instructions in [AGENTS.md](./AGENTS.md).

## Pre-Flight Work Audit & TDD (Mandatory Workflow)

1. **Pre-Flight Audit**: Always inspect and verify past completed work in `plan.md` and `HANDOFF.md`, verify CI/CD run status, and test production health before starting any new task.
2. **TDD (Test-Driven Development)**: Write failing tests (Red) before implementation, make them pass (Green), and refactor without lowering test coverage.
3. **Blue Team & Red Team Security**:
   - Blue Team: Zero token leaks in source files/configs, `gitleaks` verification, build-time token injection.
   - Red Team: Pass all adversarial chaos tests (`red-team-chaos.test.mjs`, `ssrf.test.mjs`) for split-brain, epoch-replay, failover, and queue overflow before any push.
4. **Architectural Guardrails**: Follow the 5 pillars in [GUARDRAILS.md](./GUARDRAILS.md) (Security, Integrity, Isolation, Quality Gates, Fallback Governance).
