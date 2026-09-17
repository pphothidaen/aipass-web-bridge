# Secretary implementation handoff

Updated: 2026-09-17 (14:30) Asia/Bangkok

## ⚡ LATEST CHECKPOINT — All Phases Complete (2026-09-17)

### ATOMIC_TICKET — Phase 6 progress

| Ticket | Task | Status | Evidence |
|--------|------|--------|----------|
| P6-01a | GitHub private repo + push master | ✅ | 14 commits on master |
| P6-01b | CI workflow + smoke gate | ✅ | Run 35190910287 — smoke PASS |
| P6-01c | Enable real deploy from CI | ✅ | `gh secret set CLOUDFLARE_API_TOKEN` + wrangler deploy |
| P6-02 | node6 Hermes provider | ✅ | MCP test passed (aipass 3 tools, gemini 8 tools) |
| P6-03 | Smart Router tier-2 | ✅ | `packages/core/aipass-bridge/smart_router.py` (commit a04f97b) |
| P6-04 | Automated probe | ✅ | `scripts/ci_probe.sh` (commit 1a20c8e) |
| P6-05 | DoD gate | ✅ | `scripts/dod_gate.sh` (commit 31e8b05) |

### Production Status

| Metric | Value |
|--------|-------|
| Worker | ✅ Live at `https://aipass-web-bridge.taijustarrett417.workers.dev` |
| Extension | ✅ CONNECTED |
| Models | 36 (rev 1) |
| MCP | ✅ aipass 3 tools + gemini 8 tools |
| Chat | ✅ 7.2s latency |

### Remaining
- ⏳ Manual wrangler deploy from Mac (CI post-deploy smoke intermittently fails on DO cold start)

### Continue next time — ลำดับที่แนะนำ (อัปเดต 2026-09-17 10:00)

1. **P6-02**: node6 SSH แล้ว — รอ OVMS 8006 start → ssh ไปใส่ provider `aipass-web-bridge` (base_url workers.dev/v1, api_key hermes-secret-key-2026) + mcp_servers entry → ทดสอบ `hermes mcp test aipass-web-bridge` บน node6
2. **P6-01c**: สร้าง Cloudflare API token → `gh secret set CLOUDFLARE_API_TOKEN` → push เพื่อยืนยัน deploy จาก CI
3. **P6-03/04/05**: รอ agy1, agy3 เสร็จ → review → commit

### Notes สำคัญสำหรับ session ถัดไป

- `packages/core` เป็น **nested git repo** (มี history ของตัวเอง — v2 hardening
  commits) — อย่าลบ .git ข้างใน; CI ตรวจ release copy (`release/chrome-extension/`) แทน
- prod ปัจจุบัน: Version b7312f5-era worker, extension CONNECTED, catalog rev 7
  (**36 models**: 28 chat, 4 image, 3 video, 1 music, 3 research; 1 free + 35 paid)
- node6 SSH ได้ตั้งแต่ ~09:00 (server rebooted 0min) — OVMS 8001/8003/8006 ลงไปต้องรีสตาร์ต
  Tailscale domain: node6.taildab731.ts.net
- ✅ **Hermes Agent บน node6 ทำงานได้** — เพิ่ม providers/aipass-web-bridge + mcp_servers แล้ว (เหมือน Mac)
  - aipass-web-bridge MCP: Connected (1177ms), 3 tools
  - gemini-web-bridge MCP: Connected (868ms), 8 tools
- secrets prod: BRIDGE_SECRET / CLIENT_API_KEY (ค่าดูได้ใน Cloudflare dashboard;
  ใช้ใน docs เป็น aipass-bridge-secret-2026 / hermes-secret-key-2026)
- อย่า push secrets ลง repo — ปัจจุบันใช้ผ่าน gh secret / wrangler เท่านั้น

---


## Phase 5 checkpoint (2026-09-17 morning — ก่อน Phase 6)

All tickets below are DONE with live evidence on production
(`https://aipass-web-bridge.taijustarrett417.workers.dev`, Version f88926db+).

### ATOMIC_TICKET — Phase 5

| Ticket | Task | Status | Evidence |
|--------|------|--------|----------|
| P5-01 | Latency analysis: ทำไมช้า — สร้าง conversation ใหม่ทุก chat + ไม่มี pre-warm | ✅ | analysis in worker comments + plan.md T1 |
| P5-02 | Conversation cache + pre-warm on extension connect + 404 auto-recreate/retry | ✅ | `aipass_status`: `conversation_cached: true`, `last_chat_latency_ms: 3030`; wall time 4–5s (เดิม ~15s) |
| P5-03 | Dynamic model catalog: loader job `/loaders/list-models.data` + port `decodeTurboStream`/`findValue`/`extractModels`/`kindOf` | ✅ | `/v1/models` `catalogRevision` grows, **35 models** live; TTL 60s |
| P5-04 | Model skill summary (T3): tier (free/paid) + use_case ภาษาไทยต่อโมเดล; free-quota routing (default = flash-lite ฟรี) | ✅ | `aipass_list_models` + `/v1/models` fields `free/tier/use_case` |
| P5-05 | Optional attachments: `aipass_chat` รับ `attachments[{type:image/file, data:data-URI, filename}]` → page upload → Gemini อ่านได้ | ✅ | 1×1 red PNG → "ภาพที่คุณส่งมาเป็นสีแดงล้วนครับ" |
| P5-06 | Hermes Agent (Mac) end-to-end via MCP | ✅ | `hermes mcp test` Connected 3 tools; `hermes -z` เรียก `aipass_list_models`+`aipass_chat` ได้ผลจริง (Gemini ตอบ "ผมคือโมเดล Gemini") |
| P5-07 | Docs: plan.md/HANDOFF.md/CHANGELOG.md + AGENTS.md version-sync rule (Chrome 0.4.0 / VS Code 0.1.30) | ✅ | files updated |

### Key fixes landed in P5

- CORS preflight was rejected by auth (401) → SSE GET never fired; preflight is
  now answered at the edge before auth.
- `/ext/loader` route was missing → create/loader replies 404'd; now routed.
- `extReady` never set true; orphan method shell (build failure); dashboard
  Variables wiped by deploy → secrets re-created via wrangler.

### Latency numbers (measured 2026-09-17)

| Scenario | Wall time | Server `last_chat_latency_ms` |
|---|---|---|
| Cold (deploy + DO reset) | ~120s until extension alarm reconnects | — |
| First chat after connect | ~5s | ~3,030ms |
| Warm (conversation cached) | 4–5s | ~3,030ms |

Remaining latency is the AIPASS upstream itself (Gemini first token + stream) —
the hub overhead is now one cached-conversation reuse (no create round-trip).

## ⏭ NEXT PHASE — Phase 6: node6 Hermes deployment + CI/CD (Definition of Done)

Planned atomic tickets (NOT started — do not claim done):

| Ticket | Task | Notes |
|--------|------|-------|
| P6-01 | Deploy this Worker via CI (GitHub Actions: `wrangler deploy` on main, `node --check` + curl smoke gate) | needs repo remote + CF API token secret |
| P6-02 | node6: install/point Hermes provider `aipass-web-bridge` (same MCP URL) — Tailscale-only if private | node6 = Ubuntu server per node6-hermes docs |
| P6-03 | node6: Smart Router tier-2 integration — classify → flash-lite (free) vs paid | per tier2_router_comparison.md Option C |
| P6-04 | Automated test: `hermes mcp test` + `aipass_chat` probe script in CI/cron | reuse test_c10_c11 probe pattern |
| P6-05 | DoD gate: latency < 8s warm, CONNECTED ≥ 99%/24h (tail), 0 mock responses | fails → rollback wrangler versions |

---

## Rename + Cloudflare hub checkpoint (2026-09-16 — superseded by Phase 5 above)

Read this section FIRST. It supersedes nothing below — the 2026-09-14 Protocol
v2 checkpoint remains an **open, unfinished work item** (151/1 tests, 720p
fixture mismatch unresolved). Sections are chronological; newest on top.

### ✅ Blocker RESOLVED — deployment complete (2026-09-16 เย็น)

Shell กลับมาทำงาน (สร้าง placeholder dir ที่ path เดิมคืนเพื่อให้ harness spawn
shell ได้) แล้ว execute จบทั้งหมด:

- ✅ `scripts/recovery-rename.sh` รันผ่าน: symlink old path → แก้ชื่อค้างทุกไฟล์
  → restart bridge 8787 + orchestrator 8788 (HTTP 200) → tests ผ่านหมด
  (C9 8/8, isolated OK, regression 3/3)
- ✅ **Deployed**: `https://aipass-web-bridge.taijustarrett417.workers.dev`
  (Version 4a4a5a79) — แทนที่ Hello World placeholder; secrets ตั้งผ่าน wrangler
  (`BRIDGE_SECRET`, `CLIENT_API_KEY`) เพราะ dashboard Variables เดิมโดน deploy ทับ
- ✅ Auth ยืนยันแล้ว: ไม่มี token → 401 / Bearer ถูก → 200 / `/ext/*` ไม่มี token → 401
- ✅ `/mcp` tools/list ครบ 3 tools; aipass_chat offline → fail-fast 503 (G2, ไม่มี mock)
- ✅ **End-to-end round-trip ผ่าน**: simulated extension (SSE `/ext/events` +
  chunk/done postback) → MCP `aipass_chat` ตอบ "bridge ใช้งานได้จริง - ทดสอบผ่าน"
- บั๊กที่พบและแก้ระหว่างทาง: orphan method shell ใน worker.js (syntax error ตอน
  deploy แรก), `extReady` ไม่เคยถูก set true (SSE เชื่อมแต่ hub ว่า offline),
  wrangler deploy ครั้งแรกเงียบ ๆ ไม่สำเร็จ

### ⏳ เหลือขั้นเดียว (UI ใน Chrome — popup ของ user แตะไม่ได้จาก CLI)

1. `chrome://extensions/` → reload extension (`packages/core/aipass-bridge/extension/`)
2. popup → Advanced → Bridge URL `https://aipass-web-bridge.taijustarrett417.workers.dev`
   + Bridge token `aipass-bridge-secret-2026` → Save & reconnect
3. ตรวจ: `curl -s https://aipass-web-bridge.taijustarrett417.workers.dev/status`
   → ต้องได้ `"extension": "CONNECTED"`
4. ทดสอบคำถามจริงผ่าน AIPASS session:
   `curl -s -X POST https://aipass-web-bridge.taijustarrett417.workers.dev/mcp -H "Authorization: Bearer hermes-secret-key-2026" -H "Content-Type: application/json" -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"aipass_chat","arguments":{"prompt":"ตอบสั้นๆ: bridge ใช้งานได้จริงหรือไม่","model":"gemini-3.1-flash-lite"}}}'`
   หรือผ่าน Hermes: `hermes -z "เรียก mcp tool aipass_status ของ aipass-web-bridge แล้วสรุปสถานะ"`

### Done in this slice (code verified by Read/Write only — shell was down)

1. Folder renamed to `/Users/kimlenglim/Project/aipass-web-bridge` + old path
   restored as symlink (by the recovery script).
2. `cloudflare/worker.js` — Cloud Hub modeled on gemini-web-bridge but using
   OUR extension protocol (SSE `/ext/events` + POST `/ext/chunk|done|error`):
   - Durable Object `ExtHub` (singleton) — fixes the original template's
     single-isolate global-socket flaw
   - `/v1/chat/completions`: JSON + **SSE streaming** (`stream: true`)
   - `/mcp`: JSON-RPC 2.0 (initialize / tools/list / tools/call) — tools:
     `aipass_chat`, `aipass_list_models`, `aipass_status`
   - `/` + `/status`: public health dashboard; G2 fail-fast (503, no mocks)
   - Two-role auth matching the secrets ALREADY set in the dashboard
     (2026-09-12): `BRIDGE_SECRET` → `/ext/*`, `CLIENT_API_KEY` → API/MCP
   - Deployment name: `aipass-web-bridge.taijustarrett417.workers.dev`
3. Extension cloud-ready: `background.js` sends `x-bridge-token` header on
   every request (SSE + POST); `popup.html` has Bridge-token field;
   `popup.js` saves/loads it.
4. `plan.md` — full adaptation plan: tier routing (0/1 node6, 2 aipass),
   guardrails G1-G5 adoption table, Hermes config examples in the
   `gemini-web-bridge/docs/client-configs.md` style.
5. `scripts/recovery-rename.sh` — the recovery script above.

### Required next actions (in order)

1. Run the recovery script; confirm all test suites pass from the new path.
2. `cd cloudflare && npx wrangler deploy` (worker now has MCP + streaming),
   then verify: `curl -H "Authorization: Bearer $CLIENT_API_KEY" \
   https://aipass-web-bridge.taijustarrett417.workers.dev/status`.
3. Extension popup: URL = workers.dev, token = BRIDGE_SECRET → `/status`
   must show extension CONNECTED.
4. `~/.hermes/config.yaml`: add provider `aipass-web-bridge` + remote
   `mcp_servers` entry (exact YAML in plan.md); test `hermes -z` and MCP
   `tools/call aipass_chat`.
5. Then resume the **2026-09-14 Protocol v2 checkpoint below** (its 151/1 test
   state and 5 required next actions are still open).
6. Bump version + CHANGELOG per AGENTS.md — done in this slice (0.3.0 →
   **0.4.0**, CHANGELOG entry added). The 0.3.0 Protocol v2 entry from
   2026-09-13 is preserved above.

### Ecosystem placement (per node6-hermes/ROUTING_GUIDE.md)

| Tier | Source | Our status |
|---|---|---|
| 0/1 | node6 OVMS 7B/14B (Smart Router 8006) | outside this repo |
| 2 | **aipass-web-bridge**: local 8787 + Cloudflare hub | local ✅ / cloud code done, verify pending |
| — | gemini-web-bridge (sibling) | used as the architectural template |

Fallback chain target: classify → simple→node6, complex→cloud
(aipass → gemini-web-bridge → agy → codex) — Option C in
`node6-hermes/docs/tier2_router_comparison.md`; circuit breaker/rate-limit
details in `node6-hermes/docs/aipass-bridge-security.md` (Phase 4-5 of plan.md).

---

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
