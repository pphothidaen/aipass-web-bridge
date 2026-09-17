## [0.5.1] - 2026-09-17

### Fixed
- **Chrome Extension `host_permissions`**: Added `https://*.workers.dev/*` to `manifest.json` (both source and release copy) so Chrome MV3 permits fetch and SSE connections to Cloudflare Worker hubs.
- **Durable Object SSE Abort Race Condition**: In `cloudflare/worker.js`, guarded `request.signal.addEventListener("abort")` so that a disconnecting/cycling socket only clears `extWriter` and `extReady` if it matches the current active writer instance, preventing spurious drops during reconnects.
- **Bridge Token Fallback**: Added `DEFAULT_REMOTE_TOKEN` (`aipass-bridge-secret-2026`) fallback in `background.js` and `popup.js` when connecting to `.workers.dev` endpoints if the token field was left blank.
- **Protocol v2 Channel Routing**: Restricted `connectBridge()` to local host origins (`http://127.0.0.1` / `http://localhost`) to eliminate 404 spam against Cloudflare Workers, and added graceful DO route aliases for `/bridge` and `/bridge/message`.
- **Cloudflare Worker Deployment**: Deployed and activated `aipass-web-bridge` on Cloudflare with configured secrets (`BRIDGE_SECRET` and `CLIENT_API_KEY`).
- **Hermes Provider Config**: Synchronized `~/.hermes/config.yaml` provider `aipass-web-bridge` `base_url` to `https://aipass-web-bridge.taijustarrett417.workers.dev/v1`.

### Changed
- Bumped Chrome extension version to `0.5.1` (both `packages/core/aipass-bridge/extension/` and `release/chrome-extension/` kept in exact synchronization).
- Bumped project version in `package.json` to `0.5.1`.

## [0.5.0] - 2026-09-17

### Added
- **Performance**: conversation cache + pre-warm on extension connect + 404
  auto-recreate/retry — chat round-trip now ~3–5s (was ~15s with per-call
  conversation creation).
- **Dynamic model catalog**: hub pulls the live model list from the page
  (`/loaders/list-models.data`) via a loader job — 35 models with
  `catalogRevision` tracking and 60s TTL; ported `decodeTurboStream`,
  `findValue`, `extractModels`, `kindOf` from the local bridge.
- **Model skills summary**: every model carries `tier` (free/paid) and a Thai
  `use_case` recommendation; free-quota routing keeps `gemini-3.1-flash-lite`
  as default. Exposed via `/v1/models`, `/status`, and MCP `aipass_list_models`.
- **Optional attachments**: MCP `aipass_chat` accepts `attachments`
  (`[{type: image|file, data: dataURI, filename}]`) — the extension uploads
  them to the AIPASS session before sending the prompt (verified: Gemini
  correctly identified a 1×1 red PNG).
- `aipass_status` now reports `last_chat_latency_ms`, `model_catalog`
  revision/count, and `conversation_cached`.

## [0.4.0] - 2026-09-16

### Extensions (version bumps per AGENTS.md rule)
- Chrome extension (`packages/core/aipass-bridge/extension/manifest.json` +
  `release/chrome-extension/manifest.json`): **0.3.0 → 0.4.0** (token support,
  remote cloud bridge; release folder synced with packages copy).
- VS Code extension (`packages/vscode-extension`): **0.1.29 → 0.1.30**
  (workspace rename; `extensionVersion` fallbacks in `src/extension.ts` and
  `src/ui/aipassViewProvider.ts` synchronized).

> **Deployed to production** at `https://aipass-web-bridge.taijustarrett417.workers.dev`
> (Version 4a4a5a79) — end-to-end round-trip verified (MCP `aipass_chat` answered
> via the SSE extension channel). Remaining: point the real Chrome extension popup
> at the cloud URL (single UI step; see plan.md Phase 2).

### Added
- **Cloud Hub (`cloudflare/worker.js`)** modeled on gemini-web-bridge, adapted
  to the legacy extension protocol (SSE `/ext/events` + POST
  `/ext/chunk|done|error`) on a singleton Durable Object (`ExtHub`): OpenAI
  `/v1/chat/completions` with **SSE streaming**, **remote MCP server** (`/mcp`,
  JSON-RPC 2.0 — tools `aipass_chat`, `aipass_list_models`, `aipass_status`),
  public `/` health dashboard, and G2 fail-fast (503, zero mocks).
- **Two-role auth** matching the deployed secrets: `BRIDGE_SECRET` for the
  extension channel, `CLIENT_API_KEY` for API/MCP clients (both set in the
  Workers dashboard 2026-09-12; deployed at
  `aipass-web-bridge.taijustarrett417.workers.dev`).
- **Extension remote-bridge support**: `x-bridge-token` header on every request
  (`background.js`), Bridge-token field + save/load in popup.
- **`plan.md`**: full adaptation plan — tier routing (node6 Tier 0/1, aipass
  Tier 2, gemini-web-bridge sibling), guardrails G1-G5 adoption table, Hermes
  provider + remote MCP config examples in client-configs.md style.
- **`scripts/recovery-rename.sh`**: post-rename recovery (old-path symlink,
  reference updates, bridge/orchestrator restart, test verification).

### Changed
- Project folder renamed `aipass-web-bridge` → `aipass-web-bridge`; the old path
  is restored as a symlink by the recovery script. Some in-repo references
  still carry the old name until the script runs (see HANDOFF.md blocker).

## [0.3.0] - 2026-09-13

### Added
- **Stateful Coordinator (BridgeDO)**: Node.js In-Memory State Manager managing RAM state, FIFO request queue (Max 10, Timeout 60s), dynamic Model Catalog, and Evidence Registry.
- **Protocol v2 Wire Protocol**: Added `/bridge` SSE channel and `POST /bridge/message` endpoint handling stateful lifecycle frames (`SESSION_READY`, `MODELS_DISCOVERED`, `PREPARE_MODEL`, `MODEL_READY`, `EXECUTE_REQUEST`, `STREAM_CHUNK`, `STREAM_DONE`, `STREAM_ERROR`, `PING`, `PONG`).
- **CentralTabCoordinator (Leader Election)**: Integrated leader and standby tab election into `extension/background.js` over `aipass-tab` ports with automatic failover via `chrome.storage.session` and `sessionEpoch` notification.
- **Evidence Registry & Session Epoch**: Bound generation evidence to active `sessionEpoch` in `extension/page.js` and `bridge-do.mjs`, invalidating stale proof upon page refresh or coordinator failover.
- **Dynamic Model Catalog Sync**: Dynamic model discovery and catalog sync from `de.aipass.net` with revision tracking exposed in `/v1/models` and `/status`.
- **Automated Test Coverage**: Added dedicated test suites in `bridge.test.mjs` verifying `/bridge` SSE registration, `MODELS_DISCOVERED` sync, Evidence Registry epoch validation, and BridgeDO FIFO queue saturation.

### Changed
- **Strict Fail-Fast**: `/v1/chat/completions` responds immediately with HTTP 503 when no extension is connected, and HTTP 422 when model verification fails.
- `/status` and `/health` endpoints now report `bridgeReady`, `bridgeQueue` (`busy`, `pending`), and `bridgeModels`.
- Bumped workspace and extension versions to `0.3.0` across root `package.json`, `packages/core/package.json`, `bridge/package.json`, and `extension/manifest.json`.

### Fixed
- Fixed port name mismatch in `extension/background.js` (`aipass-tab` vs `keepalive`) enabling tab keepalive and leader election.
- Cleaned up stray duplicate listener block in `extension/background.js`.
- Fixed potential double-dequeue in `server.mjs`.
- Added `.unref()` to keepalive and queue timers in `bridge-do.mjs` and `server.mjs`, preventing orphaned background handles.
- Synchronized default extension version in `packages/vscode-extension/src/ui/aipassViewProvider.ts` to `0.1.29`.

## [0.2.3] - 2026-09-13

### Added
- Integrated BridgeDO FIFO queue and fail‑fast guard into chat completions.
- Implemented CentralTabCoordinator leader election in extension background script.
- Updated VS Code extension version constant and package version to 0.1.29.
- Bumped root package version to 0.2.3.



All notable changes to the Secretary (Middle Gateway) and workspace tooling are
documented here. Format based on [Keep a Changelog](https://keepachangelog.com/).

## [0.2.2] - 2026-09-13

### Added
- Added `gemini` wrapper script to invoke agy commands with the default server `gemini-web-bridge`.
- Added npm script `gemini` for easy execution.
- Updated documentation for using `gemini` as the unified entry point.


### Added
- Cloudflare deployment assessment (`docs/cloudflare-deployment-assessment.md`):
  the bridge's relay layer can run on Cloudflare, but the logged-in browser
  session (Chrome extension) must stay on a real machine; three options
  compared (Cloudflare Tunnel = zero code change, Worker + Durable Object,
  VPS).
- Adapted Cloudflare Worker template (`cloudflare/worker.js` +
  `cloudflare/wrangler.toml`): reworked from the user's WebSocket-hub template
  into a Durable Object SSE hub speaking the real extension protocol
  (`/ext/events` SSE + `/ext/chunk|done|error`), with token auth and an
  OpenAI-compatible surface (`/v1/models`, `/v1/chat/completions`, `/status`)
  so Hermes/Secretary need no changes beyond the base URL. The original
  template's single-isolate global-socket limitation is fixed by the DO.

## [0.2.0] - 2026-09-12

### Added
- Default consultant model is now `claude-sonnet-5@default` (previously
  `gemini-3.1-pro-preview`). When AIPASS auto-switches the model (e.g. quota
  exhausted → free `gemini-3.1-flash-lite`), the Secretary announces the switch,
  **adopts the switched-to model** (`ACTIVE_CONSULTANT_MODEL` /
  `ACTIVE_PRIMARY_BRAIN_MODEL`) for all subsequent consultant, self-heal, and
  primary-brain calls, and logs the adoption in JSONL
  (`model_switched` + `active_model`).
- Live verification of the full switch scenario: requested `claude-sonnet-5@default`
  → bridge auto-switched to `gemini-3.1-flash-lite` (`credit_not_enough`) →
  notification printed → next payload used the switched model → plan succeeded.

### Fixed
- C10-C11 live probe preflight compared the requested model against
  `/status`'s `models` entries as strings, but the bridge returns a list of
  objects (`{id: ...}`) — the check now extracts ids, so a correctly configured
  model no longer produces a false "not in bridge model list" block.
- The live probe now passes end-to-end (one consultant call via the Nous chain,
  one-step sandbox-confined plan accepted, never executed).

## [0.1.2] - 2026-09-10

### Added
- Hermes Agent (macOS) integration: an `aipass-bridge` provider was added to
  `~/.hermes/config.yaml` pointing at the AIPASS bridge's OpenAI-compatible
  protocol (`http://127.0.0.1:8787/v1`) with the consultant models
  `gemini-3.1-flash-lite` and `gemini-3.1-pro-preview`. Verified end-to-end
  with a one-shot Hermes call (`HERMES-AIPASS-OK`, no model switch).

### Fixed
- The existing `aipass` provider in `~/.hermes/config.yaml` listed models the
  orchestrator on port 8788 does not serve (`gemini-3.1-pro-preview`,
  `gemini-3.1-flash-lite`, `gpt-image-2`, `veo-3.1-fast-generate-001`); its
  list now matches reality (`claude-sonnet-5@default`,
  `meituan/longcat-2.0:free`). The Gemini consultant models are only reachable
  via the bridge on port 8787 — hence the new `aipass-bridge` provider.
- Config change backed up as `~/.hermes/config.yaml.backup-20260910`.

## [0.1.1] - 2026-09-10

### Added
- JSONL structured logging for the Secretary: one redacted JSON event per line to
  stdout and to a rotating `logs/secretary.jsonl` file, configurable via
  `SECRETARY_LOG_DIR`, `SECRETARY_LOG_LEVEL`, `SECRETARY_LOG_MAX_BYTES`, and
  `SECRETARY_LOG_BACKUP_COUNT`.
- Process-local latency metrics with structured lifecycle events; execution,
  verification, consultation, self-heal, and total workflow latency are measured
  per workflow (`workflow_id` included on every event).
- AIPASS auto model-switch notification: when the bridge switches the consultant
  model (e.g. `credit_not_enough`), the Secretary prints a visible warning and
  logs a `model_switched` event; `get_current_model()` reports the model the
  bridge is currently using, and `model_mismatch` is logged when a response comes
  from a model other than the requested one.
- Self-heal retry loop: after a failed/unverified execution, the Secretary now
  tries up to `SECRETARY_MAX_HEAL_ATTEMPTS` (default 2) valid alternative plans,
  consuming malformed or unavailable consultant output as attempts.
- Structured degradation results: exhausted heals, an unreachable consultant, or
  malformed consultant output now return `status: "degraded"` with a
  machine-readable `degradation` block (`reason`, attempts, limits) instead of a
  bare failure.
- `test_secretary_isolated.py`: 21 isolated local tests covering C9 routing,
  C12 skill reuse, C13 skill save, C14 execution/verification, C17 self-heal
  degradation, and model-switch detection — all mock-based with temporary
  directories, no network access.
- `test_c10_c11_live_probe.py`: opt-in (`SECRETARY_LIVE_TEST=1`) live probe that
  preflights bridge/extension-login/quota, makes exactly one consultant call,
  accepts only a one-step sandbox-confined file plan, and never executes it.

### Fixed
- Duplicate saved skills after reuse: a reused skill is no longer re-saved after
  a verified run (`skill_save_skipped_reused`).
- `load_skill()` no longer lowercases stored requests before path extraction, so
  skill matching works for paths containing uppercase components (e.g. macOS
  `/var/folders/.../T/` temp directories).

### Changed
- Root `package.json` version bumped 0.1.0 → 0.1.1; root `.gitignore` added with
  `logs/` excluded.
- `packages/core/aipass-bridge/secretary.py` kept in sync with the root
  `secretary.py`.
