# Workspace instructions

## Versioning and Release Notes (Mandatory Rule)

- **Version Bumping**: Whenever any code modifications, new features, bug fixes, or UI changes are made:
  - You MUST bump the version number in `package.json` (and `manifest.json` for extension releases).
  - Use Semantic Versioning (`MAJOR.MINOR.PATCH`): increment `PATCH` for bug fixes, refinements, and UI updates; `MINOR` for new features or capabilities; `MAJOR` for breaking changes.
  - Keep default version strings in source code (e.g., `extensionVersion` in `packages/vscode-extension/src/extension.ts` and `src/ui/aipassViewProvider.ts`) synchronized with `package.json`.
  - **Both extensions must be bumped together with any change that touches them:**
    - Chrome extension: `packages/core/aipass-bridge/extension/manifest.json` AND the
      deployed copy `release/chrome-extension/manifest.json` (keep the two folders in
      sync — copy changed files into `release/chrome-extension/` on every change).
    - VS Code extension: `packages/vscode-extension/package.json` + the
      `extensionVersion` fallbacks in `src/extension.ts` and `src/ui/aipassViewProvider.ts`.
  - Per user request (2026-09-16): หากมีการเปลี่ยนแปลงอะไรก็ตามที่กระทบ VS Code
    extension หรือ Chrome extension ต้องอัปเดต version ของ extension นั้นทันที
    พร้อม release notes ทุกครั้ง
- **Release Notes / Changelog**:
  - You MUST add or update release notes in the corresponding `CHANGELOG.md` (e.g., `packages/vscode-extension/CHANGELOG.md`) for every modified version.
  - Document all user-facing changes, bug fixes, UI adjustments, and tool enhancements under standard sections (`### Added`, `### Changed`, `### Fixed`, `### Removed`).
  - Never finish a task involving code changes without bumping the version and documenting the changes in the release notes.

## VS Code extension release

- Build `packages/shared` before building `packages/vscode-extension`.
- The packaged VSIX must be self-contained: generated files under `packages/vscode-extension/out` must not require the workspace package name `@aipass/shared`; they must resolve to the bundled `out/shared` runtime.
- Before release, inspect the generated runtime imports, package the VSIX, install it with the VS Code CLI, and reload the extension host/window before testing commands.
- Verify that `aipass.startBridge` is declared in `contributes.commands`, registered by `activate()`, and that the extension host logs contain no activation failure.
- Run all test suites (`npm test`) and ensure 100% tests pass before packaging and distributing.

## Chrome extension release

- Package the complete directory `packages/core/aipass-bridge/extension` without the local Node bridge; produce both a load-unpacked directory and a versioned ZIP.
- Bump the version in `manifest.json` and document changes in its release notes.
- Validate `manifest.json`, all referenced scripts/pages, JavaScript syntax, and ZIP integrity before release.

## Pre-Flight Work Audit (Mandatory Before Starting New Work)

- **Audit Completed Work First**: Before starting any new task or feature, agents must:
  1. Review `plan.md` and `HANDOFF.md` to establish an accurate understanding of the latest state and completed work.
  2. Verify that previous work passed tests and has no uncommitted regressions.
  3. Verify CI/CD pipeline status and production worker health (`https://aipass-web-bridge.taijustarrett417.workers.dev/status`).
  4. Ensure git status and submodule (`packages/core`) are clean and properly synced.

## Blue Team & Red Team with TDD Governance

- **Test-Driven Development (TDD)**:
  - Write tests first (Red) before writing implementation code for any new feature or bug fix.
  - Implement minimum required code to make tests pass (Green).
  - Refactor while ensuring 100% test pass rate (`npm test`). Never disable or bypass test assertions.
- **Blue Team (Defensive Gates & Hygiene)**:
  - Strict Zero-Token-Leak (GUARDRAILS G1): No hardcoded secrets in source files, docs, or configs.
  - Built extension artifacts with real tokens (`release/*-built*/`) must remain strictly in `.gitignore`.
  - Pass `gitleaks` secret scan and `npm audit` dependency security checks.
- **Red Team (Offensive Adversarial Gates)**:
  - All changes must pass adversarial suites before release:
    - `packages/core/aipass-bridge/test/red-team-chaos.test.mjs` (RED-1 to RED-5b: split-brain, upstream 403 injection, failover, epoch-replay, queue overflow).
    - `packages/core/aipass-bridge/test/ssrf.test.mjs` (SSRF and network isolation).
  - CI gates (`smoke`, `blueteam`, `redteam`, `deploy`) must all pass green on GitHub Actions.
