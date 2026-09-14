# Workspace instructions

## Versioning and Release Notes (Mandatory Rule)

- **Version Bumping**: Whenever any code modifications, new features, bug fixes, or UI changes are made:
  - You MUST bump the version number in `package.json` (and `manifest.json` for extension releases).
  - Use Semantic Versioning (`MAJOR.MINOR.PATCH`): increment `PATCH` for bug fixes, refinements, and UI updates; `MINOR` for new features or capabilities; `MAJOR` for breaking changes.
  - Keep default version strings in source code (e.g., `extensionVersion` in `packages/vscode-extension/src/extension.ts` and `src/ui/aipassViewProvider.ts`) synchronized with `package.json`.
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
