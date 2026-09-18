# HANDOFF — aipass-web-bridge v0.6.2 (extension token build-time injection checkpoint)

อัปเดต: 2026-09-19 · Asia/Bangkok · สถานะ: **v0.6.2 เสร็จ + commit ทั้งสอง repo แล้ว · เหลือตรวจ Cloudflare secrets → deploy**

> เอกสารหลักของ checkpoint นี้คือ `plan.md` (สถานะ + ลำดับงานที่เหลือ)

## ⚡ สิ่งที่ทำเพิ่มใน session นี้ (v0.6.2)

1. **plan.md ข้อ 5 เสร็จ** — extension ไม่มี default token literal อีกต่อไป:
   - `extension/background.js`, `popup.js`, `popup.html` ใช้ `__BRIDGE_AUTH_TOKEN__`
     placeholder; ถ้าไม่ถูกแทนจะไม่ส่ง header และโดน worker 401 (fail fast)
   - เพิ่ม `scripts/build-extension.py` — สร้าง `release/aipass-bridge-chrome-built/`
     โดยฉีด token จาก Doppler (`--project/--config` หรือ `$DOPPLER_PROJECT/$DOPPLER_CONFIG`)
     → env `BRIDGE_AUTH_TOKEN`; fail ถ้าเหลือ placeholder
   - `.gitleaks.toml` ตัด allowlist path ของ extension/ ออก (เหลือเฉพาะ docs/CHANGELOG)
   - `test/test-cf-worker.test.mjs` กลับ assertion: ห้ามมี `aipass-bridge-secret-2026`
     ใน extension source, ต้องมี placeholder
   - **ผลข้างเคียง**: Kiwi zero-config หมด — ต้องติดตั้งจาก built artifact หรือกรอก token เอง
2. **เก็บงาน uncommitted ใน nested repo (`packages/core`)** → commit `f665e72` (v0.3.0):
   brain/brain-orchestrator/autonomous-system, aipass-client, worker, longcat-worker,
   sqlite-queue/sqlite-task-queue/task-queue, mcp-agent, start scripts, secretary workflow
   tests (165/165 ผ่าน) — แก้ symlink `secretary.py` จากที่ชี้นอก repo (หาย) มาชี้
   `../../secretary.py` ที่ repo root, gitignore `.aipass-models.json`
   (runtime model cache)
3. **ลบ duplicate ที่ root** — `bridge/`, `test/harness.mjs`, `test/red-team-chaos.test.mjs`,
   `test/ssrf.test.mjs` เคยเป็น copy ซ้ำของ nested repo (byte-identical ยืนยันก่อนลบ);
   canonical อยู่ที่ nested repo และ CI ชี้ path ที่นั่น

## ⏳ ค้างสำหรับ session ถัดไป

1. ตรวจ Cloudflare secrets (`BRIDGE_SECRET`/`CLIENT_API_KEY`) → deploy worker (G3: ต้องผ่าน gates)
2. สร้าง built extension artifact/zip v0.6.2 — ต้องมี token จาก Doppler/env ก่อน
3. ⚠️ ไฟล์ `/Users/kimlenglim/Project/HoroConsultant/.env` มี live secrets หลายตัว
   (Doppler/GitHub PAT/Azure/Cloudflare token ฯลฯ) และบรรทัด 92 มี value ต่อกับ
   `CLOUDFLARE_ACCOUNT_ID` จน parse ไม่ได้ — แจ้งผู้ใช้แล้ว, ไม่เกี่ยวกับ aipass

## 📜 ประวัติ v0.6.0–0.6.1 (สรุป)

1. **Config loader ใหม่** `packages/core/aipass-bridge/bridge/config.mjs`
   - Precedence: **Doppler (DOPPLER_PROJECT/DOPPLER_CONFIG) → Cloudflare
     `wrangler.toml [vars]` → `.env` → schema defaults**
   - บั๊กที่เคยเจอ: lookup ต้องใช้ชื่อ env var (`AIPASS_PORT`) ไม่ใช่ config key (`PORT`),
     ค่าที่ coerce ไม่ได้ต้อง fall through ไป layer ถัดไป
2. **Worker hardening** `cloudflare/worker.js` — ลบ fallback tokens, 401 เป็น
   OpenAI-style envelope, ไม่มี secrets → `503 secrets_unconfigured`
3. **CI/CD** `blueteam` (gitleaks + npm audit + token-literal grep) / `redteam`
   (npm test + chaos + ssrf) / deploy needs ทั้งสาม, รันบน PR ด้วย
4. **RED-4 epoch-replay** แก้แล้ว (v0.6.1): fence ใช้ `sessionEpoch` — red-team 10/10

