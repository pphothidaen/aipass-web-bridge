---
title: Versioning and Release Notes Mandatory Rule
trigger: always_on
---

# Mandatory Rule: Version Bumping and Release Notes Updates

Whenever any code changes, feature additions, bug fixes, or UI enhancements are made in this repository:

1. **Automatic Version Bumping**:
   - Bump the version in the affected project's `package.json` (and `manifest.json` for extension releases).
   - Follow Semantic Versioning (`MAJOR.MINOR.PATCH`):
     - `PATCH` (+0.0.1): Bug fixes, UI/UX polish, styling, minor behavior adjustments.
     - `MINOR` (+0.1.0): New features, new commands, new tool support, non-breaking architectural enhancements.
     - `MAJOR` (+1.0.0): Incompatible API changes, major redesigns, breaking protocol shifts.
   - Synchronize default fallback version strings in source code (e.g. `extensionVersion` in `extension.ts` and `aipassViewProvider.ts`).

2. **Mandatory Release Notes / Changelog**:
   - Always update the corresponding `CHANGELOG.md` (e.g., `packages/vscode-extension/CHANGELOG.md`).
   - Group changes under clean Markdown headers:
     - `### Added` for new features or capabilities.
     - `### Changed` for modifications to existing behaviors or UI components.
     - `### Fixed` for bug fixes, error recoveries, and edge-case resolutions.
     - `### Removed` for deprecated or deleted features.
   - Ensure the changelog includes the new version header with the ISO date: `## [X.Y.Z] — YYYY-MM-DD`.

3. **Validation & Distribution**:
   - Run tests (`npm test`) and ensure 100% test passing before releasing.
   - Re-package artifacts (e.g., `.vsix` or `.zip`) and install locally to verify before reporting back to the user.
