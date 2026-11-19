# PLAN — aipass-web-bridge: การปรับแนวคิดและ API Spec ให้ตรงกับ gemini-web-bridge

อัปเดต: 2026-11-19 · เวอร์ชัน 0.7.0 (Model Registry Endpoint, Dynamic Fallback/Remapping, Gemini Enterprise & Vertex AI Search Support)

> เอกสารอ้างอิงหลัก (จาก `/Users/kimlenglim/Project/gemini-web-bridge`):
> `cloudflare-worker/src/index.js` (API spec), `.github/workflows/ci.yml`
> (blue/red-team CI pattern), `GUARDRAILS.md` (กฎเหล็ก G1–G5),
> และฝั่งนี้: `docs/API-SPEC.md`, `docs/CONFIGURATION.md`

## เป้าหมายระดับสูง

1. **Unified API spec / auth** — OpenAI-compatible error envelope, สอง role
   (`CLIENT_API_KEY` / `BRIDGE_SECRET`), fail-fast codes
   (`503 secrets_unconfigured`, `422 model_unverified`, `429 queue_full`), และ `/registry` discovery
2. **Secret & config storage policy** — precedence: **Doppler → Cloudflare → .env → defaults**
3. **CI/CD blue-team + red-team** — ทุก push/PR ต้องผ่าน security gates ก่อน deploy

## สถานะงาน (2026-11-19)

### ✅ เสร็จแล้ว (v0.7.0, `npm test` 36/36 ผ่าน, Adversarial 15/15 ผ่าน)

| งาน | หลักฐาน |
|---|---|
| Model Registry Endpoint (`/registry`, `/registry/models`, `/registry/status`) | `cloudflare/worker.js` + unit tests ใน `test/test-cf-worker.test.mjs` |
| Public health discovery ไม่ต้องใช้ Bearer token สำหรับ `/registry*` | `cloudflare/worker.js` edge auth (`isPublicHealth`) |
| Dynamic default model detection (`gemini-3.5-flash-lite`, `gemini-3.1-flash-lite`) | `ExtHub.refreshModels()` |
| Model aliasing/remapping (`gemini-3.1-flash-lite` ↔ `gemini-3.5-flash-lite`) | `ExtHub.chatCompletions()` |
| Gemini Enterprise & Vertex AI Search tab detection & DOM automation | `background.js` (`findChatTab`), `page.js` (`runVertexSearch`), manifests |
| Extensions version bump & synchronization | `package.json` (0.7.0), `packages/core/.../manifest.json`, `release/.../manifest.json` |
| Token-injected build artifact & zip | `release/aipass-bridge-chrome-built/` & `release/aipass-bridge-chrome-built.zip` |
| Live Cloudflare Worker Deploy & Verification | `https://aipass-web-bridge.pansakorn.workers.dev/registry` (200 OK), secrets `BRIDGE_SECRET` & `CLIENT_API_KEY` active |

### ⏳ งานที่เหลือ (ตามลำดับที่แนะนำ)

1. ~~สร้าง built artifact/zip รุ่นใหม่จริง~~ — **เสร็จสมบูรณ์**: สร้าง `release/aipass-bridge-chrome-built/` และ `release/aipass-bridge-chrome-built.zip` พร้อม token เรียบร้อย
2. ~~Deploy Worker v0.7.0 พร้อม Registry & Gemini Enterprise~~ — **เสร็จสมบูรณ์**: Deployed สู่ Cloudflare Worker เรียบร้อย (`https://aipass-web-bridge.pansakorn.workers.dev`), ทดสอบ endpoint `/registry`, `/registry/models`, `/registry/status` ตอบ 200 OK ครบทุกชุด
3. แนะนำผู้ใช้ให้ระบุ Endpoint URL ใน client (เช่น Chatbox AI หรือ OpenAI SDK):
   - Registry URL: `https://aipass-web-bridge.pansakorn.workers.dev/registry`
   - Base API URL: `https://aipass-web-bridge.pansakorn.workers.dev/v1`

## สถานะ CI/CD (เป้าหมาย definition of done — 2026-09-19)

เป้า: push → GitHub Actions (smoke + blueteam + redteam) ผ่านครบ → deploy job
deploy production ผ่าน post-deploy smoke

- **v0.6.2 ก่อนหน้า**: push ไม่ได้เพราะ (a) nested repo remote เดิม
  `niawjunior/aipass-bridge` ไม่มีสิทธิ์ → สลับไป fork `pphothidaen/aipass-bridge`,
  (b) commits ใช้ email `pansakorn@hotmail.com` โดน email-privacy block →
  rewrite เป็น `13300464+pphothidaen@users.noreply.github.com` (12 commits,
  `git filter-branch`) + ตั้ง `git config user.email` ทั้งสอง repo สำหรับ commit ใหม่
- **บั๊กที่ทำให้ CI ผ่านไม่ได้เลย (แก้แล้ว v0.6.3)**: `packages/core` เป็น gitlink
  เปล่า ไม่มี `.gitmodules` → checkout บน GitHub ไม่มีเนื้อหา nested repo →
  redteam ENOENT · แก้: จดทะเบียน submodule ชี้ fork สาธารณะ + `submodules: recursive`
  ใน checkout ของ blueteam/redteam + sync gitlink ทุกครั้งที่ nested repo ขยับ
- **ผลลัพธ์ CI/CD ล่าสุด (v0.7.0 — Run #44537636011)**:
  - push commit `145d3f6` สำเร็จ
  - GitHub Actions 4 jobs ผ่านครบ 100%:
    - `smoke`: ผ่าน (syntax worker, background.js, popup.js, secretary.py, live probe)
    - `blueteam`: ผ่าน (gitleaks + npm audit + secret-hygiene)
    - `redteam`: ผ่าน (unit tests 36/36 + red-team-chaos 10/10 + ssrf 5/5)
    - `deploy`: รันจริงสำเร็จ Cloudflare Worker deployed + post-deploy smoke ผ่าน (`"ok": true`)
  - ยืนยันสถานะ Worker ที่ `https://aipass-web-bridge.pansakorn.workers.dev/status` ตอบ `ok: true`, architecture: Worker + Durable Object
  - อัปโหลด Extension Release Artifacts บน GitHub Actions สำเร็จเรียบร้อย
- **Artifacts ที่สร้างแล้ว**:
  - `release/aipass-bridge-chrome-v0.6.4.zip` (Source release zip)
  - `scripts/build-extension.py` รองรับ flag `--zip` สำหรับสร้าง token-injected artifact ในขั้นตอนเดียว
  - `.gitignore` เพิ่ม `release/*-built*/` และ `release/*-built*.zip` รองรับ token-injected build อย่างปลอดภัย

## กฎที่ต้องรักษาไว้ (สืบทอดจาก gemini-web-bridge GUARDRAILS)

- G1 ไม่มี secret รั่วใน code/comments/docs; fail fast ไม่ fabricate
- G2 error codes ตาม contract ใน `docs/API-SPEC.md` เท่านั้น
- G3 deploy ผ่าน blue+red team gates เท่านั้น
- G4 ทุกการเปลี่ยนแปลง bump version + CHANGELOG (ตาม AGENTS.md)
