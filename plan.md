# PLAN — aipass-web-bridge: ประยุกต์สถาปัตยกรรม gemini-web-bridge

อัปเดต: 2026-09-16 · เวอร์ชัน 0.3.0 (ระหว่างพัฒนา)

> เอกสารอ้างอิงหลัก (จาก `~/Project/gemini-web-bridge`):
> `HANDOFF.md` (blueprint ครบ), `GUARDRAILS.md` (กฎเหล็ก G1-G5),
> `docs/client-configs.md` (Hermes config style), `ARCHITECTURE.md` (protocol),
> `PLANNING-HANDOFF.md` (roadmap pattern: Health Recovery → Context Memory → Multi-Session)

## เป้าหมายระดับสูง

ปรับโปรเจกต์นี้ (เดิม aipass-web-bridge) ให้มีสถาปัตยกรรมระดับ high-level เหมือน
`gemini-web-bridge` (อ้างอิง: `/Users/kimlenglim/Project/gemini-web-bridge`):

1. **Chrome extension ↔ Cloudflare Durable Object ↔ AI Clients**
2. ใช้งานกับ **Hermes Agent บน Mac เครื่องนี้** ได้ทั้งแบบ model provider และ MCP
3. **Remote MCP Server** (JSON-RPC 2.0) บน Cloudflare

## สถาปัตยกรรมเป้าหมาย (Tiered Routing)

```
┌──────────────────────────────────────────────────────────────┐
│ Clients (HTTPS) — Hermes Agent (Mac), OpenAI clients, MCP    │
└──────────────┬───────────────────────────────────────────────┘
               │ Bearer CLIENT_API_KEY (+ BRIDGE_SECRET ฝั่ง extension)
               ▼
┌──────────────────────────────────────────────────────────────┐
│ Cloudflare Worker: aipass-web-bridge  (Tier 0 — primary)     │
│  GET  /            Health dashboard (public)                 │
│  POST /v1/chat/completions  OpenAI API (JSON + SSE stream)   │
│  GET  /v1/models   Model catalog                             │
│  POST /mcp         MCP JSON-RPC 2.0 (tools/list, tools/call) │
│  /ext/*            Extension channel (SSE + POST, secret)    │
│  ── Durable Object: ExtHub (single-isolate state) ──         │
└──────────────┬───────────────────────────────────────────────┘
               │ SSE (outbound) — x-bridge-token: BRIDGE_SECRET
               ▼
┌──────────────────────────────────────────────────────────────┐
│ Chrome extension (AIPASS) — de.aipass.net session (Mac)      │
│  popup: Bridge URL + Bridge token                            │
└──────────────┬───────────────────────────────────────────────┘
               ▼
        AIPASS web session (credits/gemini/claude)
```

### Tier routing (ประยุกต์จาก dynamic_routing_architecture.md ของ gemini-web-bridge)

| Tier | ช่องทาง | ใช้เมื่อ | สถานะใน plan นี้ |
|---|---|---|---|
| 0 | Cloudflare Worker hub | ปกติ — เข้าถึงจากที่ไหนก็ได้ | ✅ worker.js เสร็จแล้ว |
| 1 | Local bridge on Mac (`127.0.0.1:8787`) | Cloudflare ล่ม/latency สูง/ออฟไลน์ — **Mac fallback** | ✅ มีอยู่แล้ว (Hermes fallback chain) |
| 2 | Nous free consultant chain (`longcat`, `solar-pro`) | quota หมด / ทั้งสอง tier ล่ม | ✅ มีอยู่แล้วใน secretary.py |

- **Smart routing / classification** (จาก smart_routing_logic.md): จำแนก request
  simple file-op → ทำตรง, งานวางแผน → Tier 0, heal → Tier 2 — Secretary มี
  `should_consult()` อยู่แล้ว, จะเพิ่ม tier selector ภายหลัง (Phase 4)
- **Security / anti-ban / circuit breaker** (จาก aipass-bridge-security.md):
  token แยก 2 role แล้ว (BRIDGE_SECRET / CLIENT_API_KEY), fail-fast 503 เมื่อ
  extension offline (ไม่ mock), circuit breaker จะเพิ่มใน Phase 5

## Guardrails ที่ยึดตาม GUARDRAILS.md ของ gemini-web-bridge (G1-G5)

| กฎ | การประยุกต์กับ aipass-web-bridge | สถานะ |
|---|---|---|
| **G1 Zero-Token-Leak** | session cookies ของ de.aipass.net อยู่แค่ใน Chrome — Worker ไม่เห็น; token ยืนยันเป็น BRIDGE_SECRET/CLIENT_API_KEY เท่านั้น | ✅ โดยดีไซน์ |
| **G2 Strict Fail-Closed** | extension offline → 503 `unavailable` จริง; ไม่มี mock/canned response | ✅ worker.js ทำแล้ว |
| **G3 State Isolation** | DO เดียว (`idFromName("singleton")`), จำกัด job timeout 120s; ควรเพิ่ม FIFO queue max 10 + 429 ตาม reference | ⏳ Phase 5 |
| **G4 Zero Debt + Tests** | ทุก phase ต้องผ่าน python suites + probe; worker ควรมี node --test ชุดของตัวเอง | ⏳ Phase 5 |
| **G5 Hybrid Transparency** | เมื่อ fallback ข้าม tier ต้องแจ้ง client (เช่น header `X-Provider` หรือ JSONL event) — model switch notification มีแล้วฝั่ง Secretary | ⏳ Phase 4 |

## Config style ตาม docs/client-configs.md (ตัวอย่างจริงสำหรับ Phase 3)

```yaml
# ~/.hermes/config.yaml — model provider (แทนที่ local bridge เป็น cloud)
providers:
  aipass-web-bridge:
    type: custom
    name: aipass-web-bridge
    base_url: https://aipass-web-bridge.taijustarrett417.workers.dev/v1
    api_key: <CLIENT_API_KEY>
    discover_models: true
    refresh_models_on_connect: true
    models:
      - gemini-3.1-flash-lite
      - claude-sonnet-5@default
    timeout: 120
    connect_timeout: 30

# Remote MCP — สไตล์เดียวกับ gemini-web-bridge
mcp_servers:
  aipass-web-bridge:
    url: https://aipass-web-bridge.taijustarrett417.workers.dev/mcp
    headers:
      Authorization: "Bearer <CLIENT_API_KEY>"
```

## Secrets (ตรงกับที่ deploy แล้วใน Workers dashboard)

| Secret | ใช้โดย | ตั้งค่า |
|---|---|---|
| `BRIDGE_SECRET` | Chrome extension → `/ext/*` (header `x-bridge-token`) | ✅ deploy แล้ว (2026-09-12) |
| `CLIENT_API_KEY` | Hermes/API clients → `/v1/*`, `/mcp` (Bearer) | ✅ deploy แล้ว (2026-09-12) |
| `WEBHOOK_URL` (อนาคต) | Health alert — ตาม PLANNING-HANDOFF.md Sprint 1 | ⏳ |

## สถานะปัจจุบัน (2026-09-17 เช้า)

### Phase 6 — Orchestrator dispatch (2026-09-17 09:00)
| Ticket | Task | Status | Worker |
|--------|------|--------|--------|
| P6-01a | GitHub private repo + push master | ✅ | Mac |
| P6-01b | CI workflow + smoke gate | ✅ | Mac |
| P6-01c | Enable real deploy from CI | ⏳ | ต้อง `gh secret set CLOUDFLARE_API_TOKEN` |
| P6-02 | node6 Hermes provider | ⏳ | SSH reachable (server rebooted, OVMS 8006 coming up) |
| P6-03 | Smart Router tier-2 | ⏳ | agy1 dispatched (--print) |
| P6-04 | Automated probe (aipass_chat) | ⏳ | agy3 dispatched (--print) |
| P6-05 | DoD gate | ⏳ | agy2 dispatched — scripts/dod_gate.sh สร้างแล้ว |

### Live status (ตรวจผ่าน MCP aipass_status)
- Extension: **CONNECTED** ✅
- Catalog Revision: **7** (35 models)
- Warm latency: **null** (no recent chat recorded — DO state ใหม่)
- Conversation Cached: **true**

### ✅ เสร็จแล้ว
- `cloudflare/worker.js` — DO hub เต็มรูปแบบ: `/ext/*` (SSE, โปรโตคอล extension
  จริง), `/v1/chat/completions` (**JSON + SSE streaming**), `/v1/models`,
  `/mcp` (initialize / tools/list / tools/call — tools: `aipass_chat`,
  `aipass_list_models`, `aipass_status`), `/` + `/status` public health
- Auth 2 roles: `BRIDGE_SECRET` (extension) / `CLIENT_API_KEY` (API) —
  ตรงกับ secrets ที่ deploy แล้วใน dashboard
- `wrangler.toml` — DO binding + migration
- Extension รองรับ remote bridge: `background.js` ส่ง `x-bridge-token` ทุก
  request (SSE + POST), `popup.html` มีช่อง Bridge token
- Deploy แล้วจริง: `https://aipass-web-bridge.taijustarrett417.workers.dev`
  (secrets: BRIDGE_SECRET, CLIENT_API_KEY ตั้งใน dashboard แล้ว)
- ย้ายโฟลเดอร์ → `/Users/kimlenglim/Project/aipass-web-bridge`

### ⚠️ Blocker ต้องรันคำสั่งด้วยมือ (shell ของ session พังหลังย้ายโฟลเดอร์)
รัน `scripts/recovery-rename.sh` (สร้างไว้ให้แล้ว) ใน Terminal:
symlink path เดิม → อัปเดตชื่อในไฟล์ที่เหลือ → restart bridge/orchestrator →
verify ทุก tier

### ✅ ค้างรอ verify — ครบแล้ว (2026-09-16)
- popup.js save/load token ✅ (ทำแล้วก่อน deploy)
- Hermes MCP config ✅ (ใส่ใน config.yaml แล้ว)

### ✅ เสร็จแล้วในรอบ deploy (2026-09-16 เย็น)
- popup.js save/load token ครบแล้ว
- Recovery script รันสำเร็จ: symlink, references, bridge restart, tests ผ่านหมด
- Deployed `aipass-web-bridge` worker (แทน Hello World), secrets ตั้งผ่าน
  wrangler (BRIDGE_SECRET + CLIENT_API_KEY), auth ยืนยันแล้ว (401/200)
- End-to-end round-trip ผ่าน: simulated extension → MCP aipass_chat → คำตอบจริง


### Phase 5 — Performance + Dynamic Catalog + Skills + Attachments ✅ (2026-09-17)
- [x] T1 latency: conversation cache + pre-warm on connect + 404 auto-recreate → **3–5s/chat** (เดิม ~15s)
- [x] T2 dynamic model catalog: loader job + decodeTurboStream port → **35 models live**, TTL 60s, revision tracking
- [x] T3 skills summary: tier free/paid + use_case ไทยต่อโมเดล (SKILL_RULES); free-quota routing (default = flash-lite)
- [x] T4 attachments: `aipass_chat` รับ image/file (data URI, optional) — พิสูจน์ด้วยรูปสีแดง 1×1 → Gemini ตอบ "สีแดงล้วน"
- [x] T5 deploy Version f88926db+ + Hermes MCP test ผ่าน (`hermes -z` เรียก aipass_list_models/aipass_chat ได้จริง)

### Phase 6 — node6 Hermes + CI/CD (IN PROGRESS — 2026-09-17 09:00)
- [x] P6-01a GitHub private repo + push master ✅
- [x] P6-01b CI workflow + smoke gate ✅ (Run 35131179993)
- [ ] P6-01c Enable real deploy from CI — ต้อง `gh secret set CLOUDFLARE_API_TOKEN`
- [ ] P6-02 node6 Hermes provider — SSH reachable (rebooted), OVMS 8006 coming up
- [ ] P6-03 Smart Router tier-2 — agy1 dispatched (smart_router.py)
- [ ] P6-04 Automated probe — agy3 dispatched (ci_probe.sh)
- [ ] P6-05 DoD gate — agy2 dispatched, scripts/dod_gate.sh created

## Checkpoints (ตามลำดับทำ)

### Phase 0 — Recovery ✅ (2026-09-16)
- [x] `bash scripts/recovery-rename.sh` ผ่านทั้งหมด (symlink, references)
- [x] Shell/tests รันจาก path ใหม่ได้ (C9 8/8, isolated OK, regression 3/3)
- [x] Bridge 8787 + orchestrator 8788 รันจาก path ใหม่ (HTTP 200)

### Phase 1 — Cloudflare hub live ✅ (2026-09-16)
- [x] Deployed: `https://aipass-web-bridge.taijustarrett417.workers.dev`
      (worker ชื่อ `aipass-web-bridge` แทนที่ Hello World placeholder)
- [x] Secrets ตั้งผ่าน wrangler: BRIDGE_SECRET + CLIENT_API_KEY (dashboard
      Variables เดิมโดน deploy ทับ — ตั้งใหม่เป็น Secret จริง)
- [x] Auth ยืนยัน: ไม่มี token → 401, Bearer ถูก → 200, /ext/* → 401
- [x] `/mcp` tools/list + aipass_chat fail-fast (G2) ทำงานถูกต้อง
- [x] End-to-end: simulated extension (SSE /ext/events + chunk/done postback)
      → MCP `aipass_chat` ตอบ "bridge ใช้งานได้จริง - ทดสอบผ่าน"
      (บั๊กที่แก้: orphan method shell ทำ syntax error, extReady ไม่ถูก set)

### Phase 2 — Extension ชี้ cloud ✅ (2026-09-16)
- [x] chrome://extensions → reload extension
- [x] popup → URL = cloud workers.dev, token = aipass-bridge-secret-2026 → Save
- [x] `/status` ตอบ `"extension": "CONNECTED"` จาก extension จริง

### Phase 3 — Hermes on Mac ใช้งาน ⏳ (config ใส่แล้ว 2026-09-16)
- [x] Provider `aipass-web-bridge` + mcp_servers entry ใน `~/.hermes/config.yaml`
- [ ] หลัง extension CONNECTED: `hermes -z "เรียก mcp tool aipass_status ของ
      aipass-web-bridge"` + aipass_chat ผ่าน extension จริง (AIPASS session)

### Phase 4 — Smart tier routing ✅ (2026-09-16 — Hermes config)
- [x] Provider `aipass-web-bridge` + mcp_servers entry ใน `~/.hermes/config.yaml`
- [x] ตรวจสอบผ่าน `hermes -z "เรียก mcp tool aipass_status"` ได้ผลจริง

### Phase 5 — Security hardening (จาก aipass-bridge-security.md)
- [ ] Circuit breaker ฝั่ง Secretary/Worker (quota, error rate)
- [ ] Rate limit บน Worker, ลด CORS เหลือ origin ที่รู้จัก
- [ ] Live probe (C10-C11) รันผ่าน cloud URL ได้

## ตัวชี้วัดสำเร็จ (Definition of Done)

1. `hermes -z "ทดสอบ" --provider aipass-bridge` ผ่าน Cloudflare ได้คำตอบจริง
2. MCP `tools/call aipass_chat` ตอบจาก session จริง (ไม่มี mock)
3. ถอด Cloudflare ออก (หรือล่ม) → Secretary fallback local bridge อัตโนมัติ
4. ทุกเทสเดิม (C9, isolated 25, regression 3) ผ่านจาก path ใหม่
