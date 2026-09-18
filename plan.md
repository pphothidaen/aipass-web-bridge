# PLAN — aipass-web-bridge: การปรับแนวคิดและ API Spec ให้ตรงกับ gemini-web-bridge

อัปเดต: 2026-09-19 · เวอร์ชัน 0.6.2 (RED-4 แก้แล้ว · token placeholder เสร็จ · npm test 32/32 · nested 165/165 · red-team 10/10 · ssrf 5/5)

> เอกสารอ้างอิงหลัก (จาก `/Users/kimlenglim/Project/gemini-web-bridge`):
> `cloudflare-worker/src/index.js` (API spec), `.github/workflows/ci.yml`
> (blue/red-team CI pattern), `GUARDRAILS.md` (กฎเหล็ก G1–G5),
> และฝั่งนี้: `docs/API-SPEC.md`, `docs/CONFIGURATION.md`

## เป้าหมายระดับสูง

ให้ aipass-web-bridge และ gemini-web-bridge ใช้ "แนวทางเดียวกัน" 3 ด้าน:

1. **Unified API spec / auth** — OpenAI-compatible error envelope, สอง role
   (`CLIENT_API_KEY` / `BRIDGE_SECRET`), fail-fast codes
   (`503 secrets_unconfigured`, `422 model_unverified`, `429 queue_full`)
2. **Secret & config storage policy** — precedence: **Doppler → Cloudflare → .env → defaults**
3. **CI/CD blue-team + red-team** — ทุก push/PR ต้องผ่าน security gates ก่อน deploy

## สถานะงาน (2026-09-19)

### ✅ เสร็จแล้ว (v0.6.0, `npm test` 32/32 ผ่าน)

| งาน | หลักฐาน |
|---|---|
| Config loader รวมศูนย์ (Doppler → CF vars → .env → defaults) | `packages/core/aipass-bridge/bridge/config.mjs` + `server.mjs` ใช้ `loadConfig()` |
| ลบ hardcoded fallback tokens ออกจาก worker | `cloudflare/worker.js` (เดิม `aipass-bridge-secret-2026`/`hermes-secret-key-2026` ถูกยอมรับเสมอ) |
| Auth 401 envelope แบบ OpenAI + fail-fast 503 เมื่อไม่มี secrets | `cloudflare/worker.js` edge auth |
| CI blue-team (gitleaks + npm audit + secret-hygiene grep) | `.github/workflows/ci.yml` job `blueteam` |
| CI red-team (red-team-chaos + ssrf suites) | `.github/workflows/ci.yml` job `redteam` |
| deploy ต้องผ่าน smoke+blueteam+redteam, รันบน PR ด้วย | `ci.yml` |
| เอกสาร policy + unified spec | `docs/CONFIGURATION.md`, `docs/API-SPEC.md`, `.env.example` |
| Version 0.6.0 + CHANGELOG + manifests | `package.json`, `CHANGELOG.md`, `extension/manifest.json`, `release/chrome-extension/manifest.json` |
| Unit tests config precedence (7 tests) | `test/test-config-loader.test.mjs` (อยู่ใน `npm test`) |

### ⏳ งานที่เหลือ (ตามลำดับที่แนะนำ)

1. ~~แก้ RED-4~~ — **เสร็จ (v0.6.1)**: สาเหตุจริงไม่ใช่ Date.now collision แต่เป็น
   `validateEpochEnvelope()` ใน `protocol-v2.mjs` ตรวจฟิลด์ `epoch` ซึ่ง wire messages
   ใช้ `sessionEpoch` → envelope เก่าผ่าน fence ได้เสมอ แก้ให้ fence และ sequence
   tracker ใช้ `sessionEpoch` (fallback `epoch` สำหรับ envelope ภายใน) — red-team 10/10
2. ~~Sync release copy + zip~~ — **เสร็จ**: `release/chrome-extension` mirror แล้ว
   (diff ว่าง), สร้าง `release/aipass-bridge-chrome-v0.6.1.zip` (8 files, syntax/manifest ตรวจแล้ว)
3. **ตรวจสอบ Cloudflare secrets ก่อน deploy** — `BRIDGE_SECRET` / `CLIENT_API_KEY`
   ต้องตั้งไว้บน worker แล้ว ไม่งั้น deploy ชุดใหม่แล้ว extension/API โดน 401 ทันที
   (ตรวจด้วย `curl -H "x-bridge-token: <token>" https://.../bridge/message` หลัง deploy)
4. ~~Commit งาน~~ — **เสร็จ**: nested repo `3e0d040` → `f665e72` (v0.3.0 brain/orchestrator
   batch + extension v0.6.2) แล้ว commit repo หลัก
5. ~~ย้าย default token ไป build-time substitution~~ — **เสร็จ (v0.6.2)**:
   extension ใช้ `__BRIDGE_AUTH_TOKEN__` placeholder (background.js/popup.js/popup.html),
   เพิ่ม `scripts/build-extension.py` ฉีดค่าจาก Doppler → env (fail hard ถ้าเหลือ placeholder),
   `.gitleaks.toml` ตัด allowlist path ของ extension ออก, test กลับ assertion ให้ห้ามมี
   literal token ใน extension source — **Kiwi zero-config หมดไป**: ติดตั้งจาก
   `release/aipass-bridge-chrome-built/` (build ด้วย script) หรือกรอก token ใน popup
6. **(ค้าง)** สร้าง built artifact/zip รุ่น 0.6.2 จริง — ต้องมี `BRIDGE_AUTH_TOKEN`
   จาก Doppler หรือ env ก่อน (source zip ล้วนจะไม่ทำงานเพราะ placeholder ไม่ถูกแทน)

## กฎที่ต้องรักษาไว้ (สืบทอดจาก gemini-web-bridge GUARDRAILS)

- G1 ไม่มี secret รั่วใน code/comments/docs; fail fast ไม่ fabricate
- G2 error codes ตาม contract ใน `docs/API-SPEC.md` เท่านั้น
- G3 deploy ผ่าน blue+red team gates เท่านั้น
- G4 ทุกการเปลี่ยนแปลง bump version + CHANGELOG (ตาม AGENTS.md)
