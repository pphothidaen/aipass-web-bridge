# AiPASS Dev Suite Guidelines

## Versioning & Release Notes (Mandatory Rule)

- Whenever any code modifications, features, bug fixes, or UI changes are made:
  1. Bump the version number in `package.json` (and `manifest.json` where applicable) following Semantic Versioning (`MAJOR.MINOR.PATCH`).
  2. Keep default version variables in source code synchronized with `package.json`.
  3. Add or update release notes in `CHANGELOG.md` documenting all additions, changes, and fixes.
  4. Ensure all automated tests (`npm test`) pass 100% and rebuild/re-package the extension.

## Extensions Release Guidelines

- See detailed release instructions in [AGENTS.md](./AGENTS.md).
