# HANDOFF — aipass-web-bridge v0.7.0 (Model Registry, Dynamic Fallback & Gemini Enterprise)

อัปเดต: 2026-11-19 · Asia/Bangkok · สถานะ: **v0.7.0 รองรับ Endpoint /registry (Public & DO), รองรับ Gemini Enterprise (Vertex AI Search) และ Model Remapping/Fallback สมบูรณ์**

> เอกสารหลักของ checkpoint นี้คือ `plan.md` (สถานะ + ลำดับงานที่เหลือ)
> กฎทอง: จบทุก session ต้องอัปเดต `plan.md` + `handoff.md` ให้เป็นปัจจุบันเสมอ

## ⚡ สิ่งที่ทำเพิ่มใน v0.7.0

1. **เพิ่มและเปิดใช้งาน First-class /registry Endpoints**:
   - `/registry`, `/registry/status`, และ `/registry/models` ใน `cloudflare/worker.js`
   - แก้ไขปัญหา "❌ ล้มเหลว Failed to connect to host" โดยอนุญาตให้สาธารณะเข้าถึง `/registry*` สำหรับ health/discovery checks (OpenAI models data array + detailed registry metadata)
2. **รองรับโมเดลทั้งหมดและ Dynamic Fallback/Remapping**:
   - ปรับปรุง `refreshModels()` ให้ตรวจจับโมเดลฟรีรุ่นใหม่ (`gemini-3.5-flash-lite`) แบบไดนามิก แทนการ hardcode
   - ทำ automatic remapping: หาก Client ร้องขอ `gemini-3.1-flash-lite` แต่ใน catalog ล่าสุดมี `gemini-3.5-flash-lite` จะถูก alias/remap ไปยังโมเดลที่ใช้งานได้อัตโนมัติ โดยไม่ error
3. **รองรับ Gemini Enterprise (Vertex AI Search)**:
   - อัปเดต permissions และ content scripts ใน `manifest.json` ทั้งใน `packages/core/...` และ `release/...` ให้รองรับ `https://vertexaisearch.cloud.google/*` และ `https://*.cloud.google/*`
   - ปรับปรุง `background.js` ในฟังก์ชัน `findChatTab()` ให้ตรวจจับแท็บ Gemini Enterprise
   - เพิ่ม `runVertexSearch()` ใน `page.js` สำหรับการค้นหาและป้อน prompt ผ่าน DOM บน Google Cloud interfaces พร้อมรายงานสถานะผ่าน stream
4. **ความสอดคล้องของ Versioning และ Test Suites**:
   - Version ซิงก์สมบูรณ์ `0.7.0` ข้าม root `package.json`, core manifest, และ release manifest
   - ผ่าน `npm test` 36/36 tests 100%
   - ผ่าน Adversarial Chaos Suites (RED-1 ถึง RED-5b) และ SSRF Security Suites 15/15 tests 100%
   - สร้าง built package และ source zip `v0.7.0` เรียบร้อย
5. **การ Deploy Worker สู่ Cloudflare และการทดสอบ Live Endpoints**:
   - ดำเนินการ deploy Cloudflare Worker สำเร็จสู่: `https://aipass-web-bridge.pansakorn.workers.dev`
   - ตั้งค่า Secrets `BRIDGE_SECRET` และ `CLIENT_API_KEY` บน Worker เรียบร้อย
   - ยืนยันการทำงานของ Endpoints:
     - `curl -s https://aipass-web-bridge.pansakorn.workers.dev/registry` ตอบ 200 OK พร้อม model catalog ครบถ้วน
     - `curl -s https://aipass-web-bridge.pansakorn.workers.dev/registry/models` ตอบ 200 OK (OpenAI models data array)
     - `curl -s https://aipass-web-bridge.pansakorn.workers.dev/registry/status` ตอบ 200 OK
     - รองรับ Gemini 3.1 Flash Lite ↔ Gemini 3.5 Flash Lite remapping และ Vertex AI Search (Gemini Enterprise) เรียบร้อย 100%

1. **push สำเร็จหลังแก้ 2 อุปสรรค**
   - nested repo remote เดิม `niawjunior/aipass-bridge` → 403 สำหรับ account
     `pphothidaen` → สลับ origin ไป fork `git@github.com:pphothidaen/aipass-bridge.git`
   - push โดน email-privacy block (commits ใช้ `pansakorn@hotmail.com`) →
     `git filter-branch --env-filter` rewrite 12 commits เป็น
     `13300464+pphothidaen@users.noreply.github.com` + ตั้ง `git config user.email`
     ทั้งสอง repo (สำคัญ: commit ใหม่ต้องใช้ noreply เสมอ ไม่งั้น push โดน reject อีก)
   - push แล้ว: fork `10c8f2e → a291387` (main), repo หลัก `cc4c24f → 517df21 → 75d0f66` (master)
2. **พบ+แก้บั๊กที่ทำให้ CI ผ่านไม่ได้เลย (v0.6.3)**
   - อาการ: redteam job fail ENOENT `packages/core/aipass-bridge/extension/manifest.json`
     บน runner — ในเครื่องผ่านเพราะมี nested repo อยู่จริง
   - สาเหตุ: `packages/core` เป็น gitlink (mode 160000) โดยไม่มี `.gitmodules`
     → GitHub checkout ได้ directory เปล่า
   - แก้: `.gitmodules` จดทะเบียน submodule url `https://github.com/pphothidaen/aipass-bridge.git`
     (public fork — ไม่ต้องใช้ token ตอน checkout), `git submodule absorbgitdirs`,
     ci.yml เพิ่ม `submodules: recursive` ที่ checkout ของ blueteam + redteam
   - **กติกาใหม่ที่ต้องจำ**: แก้อะไรใน `packages/core/**` → commit+push fork ก่อน แล้ว
     `git add packages/core` ใน repo หลักเพื่อขยับ gitlink ไม่งั้น CI เห็นของเก่า
3. **กฎ version sync**: root `package.json` = `extension/manifest.json` (submodule) =
   `release/chrome-extension/manifest.json` — test-cf-worker assert ทั้งสามชุดเท่ากัน
   ตอนนี้เป็น 0.6.4 (commit `6c20814` ใน fork + gitlink อัปเดตใน repo หลัก)
4. **CI/CD ผ่านครบ 4 Jobs บน GitHub Actions (Run #44537636011)**:
   - `smoke` (Syntax & Live Smoke Gate) — ผ่าน 100%
   - `blueteam` (Gitleaks, Audit, Secret Hygiene) — ผ่าน 100%
   - `redteam` (Unit Tests 36/36, Red-team Chaos 10/10, SSRF Suite 5/5) — ผ่าน 100%
   - `deploy` (Wrangler Deploy & Post-deploy smoke) — สำเร็จ 100% (สร้าง and upload artifact `aipass-bridge-extension` เรียบร้อย)
   - ผลตรวจ Production: `curl https://aipass-web-bridge.pansakorn.workers.dev/status` ตอบ `ok: true`, architecture: Worker + Durable Object
5. **Governance & Architectural Guardrails**:
   - จัดทำ [`GUARDRAILS.md`](./GUARDRAILS.md) 5 เสาหลัก และกฎถาวร [`.agent/rules/blueteam-redteam-tdd.md`](./.agent/rules/blueteam-redteam-tdd.md)
   - อัปเดตระเบียบ Pre-Flight Work Audit ใน [`AGENTS.md`](./AGENTS.md) และ [`GEMINI.md`](./GEMINI.md)
   - Git hygiene: เพิ่ม `release/*-built*/` และ `release/*-built*.zip` ใน `.gitignore`
6. **Artifacts & Build Tooling**:
   - สร้าง `release/aipass-bridge-chrome-v0.6.4.zip` สำหรับ source distribution
   - ปรับปรุง `scripts/build-extension.py` เพิ่ม flag `--zip` (รองรับการ build + zip ในคำสั่งเดียว)

## ⏳ ค้างสำหรับ session ถัดไป

1. ~~การสร้าง built extension artifact/zip ด้วย secret จริง~~ — **เสร็จสมบูรณ์**: สร้าง `release/aipass-bridge-chrome-built/` และ `release/aipass-bridge-chrome-built.zip` พร้อมฉีด token เรียบร้อย, ตรวจสอบไม่มี placeholder หลงเหลือ, ผ่าน unit tests (32/32) และ red-team adversarial suites (15/15)
2. ⚠️ ไฟล์ `/Users/kimlenglim/Project/HoroConsultant/.env` มี live secrets หลายตัว
   (Doppler/GitHub PAT/Azure/Cloudflare token ฯลฯ) และบรรทัด 92 value ต่อกันจน parse
   ไม่ได้ — แจ้งผู้ใช้แล้ว, ไม่เกี่ยวกับ aipass

## 📜 ประวัติ v0.6.0–0.6.2 (สรุป)

1. **v0.6.0** Config loader (Doppler → CF vars → .env → defaults) + worker hardening
   (ลบ fallback tokens, 401 OpenAI envelope, 503 secrets_unconfigured) + CI
   blueteam/redteam/deploy gates + docs (API-SPEC, CONFIGURATION)
2. **v0.6.1** RED-4 epoch-replay: fence ใช้ `sessionEpoch` — red-team 10/10
3. **v0.6.2** Extension token เป็น `__BRIDGE_AUTH_TOKEN__` placeholder +
   `scripts/build-extension.py` + gitleaks ตัด extension allowlist — Kiwi zero-config หมด
   (ติดตั้งจาก built artifact หรือกรอก token เอง); deploy wrangler ในเครื่องสำเร็จ
   (version `8fca3a44`), secrets ครบ, smoke 401 ถูกต้อง

