# Secretary implementation handoff

Updated: 2026-09-14 Asia/Bangkok

## Architecture v2 resume checkpoint (2026-09-14)

The Secretary handoff below remains the prior completed baseline. The new
`aipass-web-bridge` Stateful Gateway work from the operator brief is **IN
PROGRESS and NOT VERIFIED COMPLETE**. Work was intentionally stopped after one
implementation slice; do not claim release readiness or live compatibility.

### Confirmed target and baseline

- Target repository: `/Users/kimlenglim/Project/aipass-web-bridge`.
- The repository has no committed baseline; all files are currently untracked.
  Preserve the workspace and do not clean, reset, rebase, or infer history.
- Existing Protocol v2 files and focused tests were already present before this
  slice. The legacy `/ext/events` path must remain backward compatible.
- Syntax checks passed before the slice. The elevated core suite then produced
  **151 passed, 1 failed**. The remaining failure is the existing
  `--resolution and the video switches reach the job` case: the served fixture
  only advertises `480p`, while the test requests `720p`; it is not yet fixed.

### Changes made, pending post-change verification

- `packages/core/aipass-bridge/bridge/protocol-v2.mjs`
  - accepts structured `STREAM_CHUNK.parts` messages;
  - validates `MODEL_READY`, `STREAM_DONE`, and `STREAM_ERROR` request IDs.
- `packages/core/aipass-bridge/bridge/bridge-do.mjs`
  - imports the protocol version correctly;
  - tracks a coordinator `sessionEpoch` and invalidates evidence on reconnect;
  - rejects unverified/unselectable models;
  - adds `executeJob()` for structured Protocol v2 jobs with evidence, epoch,
    timeout, and terminal stream handling.
- `packages/core/aipass-bridge/bridge/server.mjs`
  - selects the strict Protocol v2 path when `/bridge` is connected;
  - returns `422 model_unverified` for absent/invalid live catalog entries;
  - routes v2 chat/media jobs through `BridgeDO.executeJob()` while preserving
    the legacy path when only `/ext/events` is connected;
  - validates bridge messages and rejects stale session epochs.
- `packages/core/aipass-bridge/extension/content.js`
  - maps page `jobId` to Protocol v2 `requestId` when forwarding responses.
- `packages/core/aipass-bridge/extension/background.js`
  - routes Protocol v2 work to the elected leader tab;
  - persists session epochs and propagates leader/standby role updates.

### Required next actions

1. Run `node --check` on all changed bridge and extension files.
2. Add/adjust focused Protocol v2 tests for strict model admission, structured
   parts, stale epochs, queue release on prepare/execute failure, and leader
   failover. Re-run the core suite and resolve the known 720p fixture mismatch.
3. Review the v2 path for cancellation semantics: `startBridgeChat().abort()`
   currently stops callbacks but does not yet send `CANCEL_REQUEST` upstream.
4. Validate that the background worker's session epoch handshake cannot race
   the initial `/bridge` `SESSION_READY` event, then exercise multiple-tab
   leader/standby/failover behavior in a browser harness.
5. Bump `package.json`/extension manifest versions and update the relevant
   `CHANGELOG.md` entries per `AGENTS.md` before considering the feature ready.
6. Preserve Video/Music, attachment SSRF, Cloudflare recovery, `/v1/models`
   revision behavior, and legacy `/ext/events` compatibility in regression
   evidence. Do not deploy or publish until all gates are green.

### Stop reason

Operator requested work to stop and this handoff to be updated. No commit,
package, deployment, publication, or live production claim was made.

## Current state

The resume plan is **completed and verified live**. The C10-C11 probe passes
end-to-end, and the model-switch scenario requested by the user works exactly
as specified:

- Default consultant model: `claude-sonnet-5@default` (user decision, 2026-09-12).
- When AIPASS auto-switches (quota exhausted → `gemini-3.1-flash-lite`), the
  Secretary announces the switch and **adopts the switched-to model** for all
  subsequent consultant / self-heal / primary-brain calls.
- Verified live: requested claude → switch event detected (`credit_not_enough`)
  → warning printed → next payload used `gemini-3.1-flash-lite` → plan OK.
- The probe's model preflight bug (string vs object list in `/status` models)
  was fixed; the probe now passes (consultant call went through the Nous chain,
  plan accepted, never executed, no credits used).

Earlier state (2026-09-10): the live consultant call was blocked by account
state (0 credits, model not selectable). That blocker no longer applies.

The workspace has no commits and every item is untracked. Preserve all
existing files and changes; do not clean, reset, or infer a baseline from Git.

## What was done on resume

- `run_secrets_workflow()` in `secretary.py` refactored:
  - self-heal loop with up to `SECRETARY_MAX_HEAL_ATTEMPTS` (default 2) valid
    alternative plans; unavailable/malformed heal output consumes an attempt.
  - structured degradation: `status: "degraded"` with a `degradation` block
    (`reason`: `heal_attempts_exhausted` | `consultant_unavailable` |
    `consultant_malformed_output`; attempts list; limits).
  - latency metrics for execution, verification, consultation, self-heal, and
    `workflow_total`, each tagged with a `workflow_id`.
  - reused skills are never re-saved (duplicate-skill bug fixed); `load_skill()`
    also no longer lowercases stored requests before path extraction, fixing
    matching for paths with uppercase components (macOS `/T/` temp dirs).
- AIPASS auto model-switch notification added: `detect_model_switch()` /
  `notify_model_switch()` detect `data-model_switched` in consultant responses
  (reason e.g. `credit_not_enough`) and print + log a `model_switched` warning;
  `get_current_model()` reports the bridge's current model; `model_mismatch`
  logged when a response uses a different model than requested.
- `test_secretary_isolated.py` (21 tests, all passing): C9 routing, C12 reuse,
  C13 save, C14 execution/verification, C17 heal/degradation, model-switch
  detection. All mock-based; temp dirs only; no network; does not reuse
  `test_secretary.py`'s env-var trick.
- `test_c10_c11_live_probe.py`: opt-in (`SECRETARY_LIVE_TEST=1`) probe with
  bridge/extension-login/quota preflight, exactly one consultant call, one-step
  sandbox-confined plan validation, never executes a plan. Exit 2 = preflight
  blocked, 0 = pass, 1 = fail.
- Root `.gitignore` added (`logs/`, `node_modules/`, `__pycache__/`),
  root `package.json` bumped 0.1.0 → 0.1.1, root `CHANGELOG.md` added.
- `packages/core/aipass-bridge/secretary.py` is a symlink to the root file —
  always in sync automatically.

## Verification results

- `python3 test_c9_should_consult.py`: 8/8 passed.
- `python3 -m unittest test_secretary_isolated`: 21/21 passed.
- `python3 test_secretary_regression.py` (isolated skills/log dirs): 3/3 passed.
- Probe no-op mode (no `SECRETARY_LIVE_TEST`): skipped correctly, exit 0.
- No skills files were created in the repo `skills/` during testing.

## Live probe blocker (unchanged root cause, now measured)

At ~23:45 Bangkok the probe preflight refused to call the consultant:

- Bridge `http://127.0.0.1:8787` is UP; extension logged in (`extensions: 1`).
- Credits: **0 available** (10000/10000 used; period ended 2026-09-10T19:00Z).
- Configured `CONSULTANT_MODEL` (`gemini-3.1-pro-preview`) is not in the
  bridge's current model list; bridge default model is `gemini-3.1-flash-lite`.

Per the earlier decision, `CONSULTANT_MODEL` was NOT changed implicitly. To run
the live probe after topping up credits: `SECRETARY_LIVE_TEST=1 python3
test_c10_c11_live_probe.py` (it re-preflights everything first).

## Remaining (optional) follow-ups

- Re-run the live probe once credits are available.
- Consider whether `CONSULTANT_MODEL` should be updated to a selectable model
  explicitly (a user decision, not an implicit change).
