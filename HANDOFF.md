# HANDOFF — aipass-web-bridge v0.6.4 (Governance, Guardrails & TDD Checkpoint)

อัปเดต: 2026-09-19 · Asia/Bangkok · สถานะ: **v0.6.4 บรรจุ Governance, กฎเหล็ก GUARDRAILS.md 5 เสาหลัก, Pre-Flight Audit, และ TDD กฎถาวรเรียบร้อย**

> เอกสารหลักของ checkpoint นี้คือ `plan.md` (สถานะ + ลำดับงานที่เหลือ)
> กฎทอง: จบทุก session ต้องอัปเดต `plan.md` + `handoff.md` ให้เป็นปัจจุบันเสมอ

## ⚡ สิ่งที่ทำเพิ่มหลัง v0.6.2 (session นี้, เป้า "CI/CD to production")

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
4. **CI/CD ผ่านครบ 4 Jobs บน GitHub Actions (Run #35420092689)**:
   - `smoke` (Syntax & Live Smoke Gate) — ผ่าน 100%
   - `blueteam` (Gitleaks, Audit, Secret Hygiene) — ผ่าน 100%
   - `redteam` (Unit Tests 32/32, Red-team Chaos 10/10, SSRF Suite 5/5) — ผ่าน 100%
   - `deploy` (Wrangler Deploy & Post-deploy smoke) — สำเร็จ 100%
   - ผลตรวจ Production: `curl https://aipass-web-bridge.taijustarrett417.workers.dev/status` ตอบ `ok: true`, architecture: Worker + Durable Object
5. **Governance & Architectural Guardrails**:
   - จัดทำ [`GUARDRAILS.md`](./GUARDRAILS.md) 5 เสาหลัก และกฎถาวร [`.agent/rules/blueteam-redteam-tdd.md`](./.agent/rules/blueteam-redteam-tdd.md)
   - อัปเดตระเบียบ Pre-Flight Work Audit ใน [`AGENTS.md`](./AGENTS.md) และ [`GEMINI.md`](./GEMINI.md)
   - Git hygiene: เพิ่ม `release/*-built*/` และ `release/*-built*.zip` ใน `.gitignore`
6. **Artifacts & Build Tooling**:
   - สร้าง `release/aipass-bridge-chrome-v0.6.4.zip` สำหรับ source distribution
   - ปรับปรุง `scripts/build-extension.py` เพิ่ม flag `--zip` (รองรับการ build + zip ในคำสั่งเดียว)

## ⏳ ค้างสำหรับ session ถัดไป

1. การสร้าง built extension artifact/zip ด้วย secret จริง: รัน `BRIDGE_AUTH_TOKEN="<token>" python3 scripts/build-extension.py --zip` เมื่อผู้ใช้พร้อมระบุ token
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

