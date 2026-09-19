# HANDOFF — aipass-web-bridge v0.6.3 (CI/CD-to-production checkpoint)

อัปเดต: 2026-09-19 · Asia/Bangkok · สถานะ: **v0.6.3 commit+push แล้ว · รอ GitHub Actions 4 jobs เขียวและ deploy ผ่าน**

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
   - push แล้ว: fork `10c8f2e → a291387` (main), repo หลัก `cc4c24f → 517df21 → …` (master)
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
   ตอนนี้เป็น 0.6.3 (commit `a291387` ใน fork + gitlink อัปเดตใน repo หลัก)

## ⏳ ค้างสำหรับ session ถัดไป

1. ดูผล GitHub Actions ของ push 0.6.3: `gh run watch` — ต้อง smoke+blueteam+redteam
   เขียวและ deploy รันจริง (secret `CLOUDFLARE_API_TOKEN` ตั้งแล้ว 2026-09-17) ·
   ถ้า fail ให้อ่าน `--log-failed` แก้แล้ว push ใหม่จนครบ (definition of done)
2. หลัง deploy ผ่าน: ยืนยัน production version ใหม่ + smoke `{"ok":true}` จาก
   post-deploy step แล้วอัปเดต plan/handoff ปิดจob
3. สร้าง built extension artifact/zip — ต้องมี `BRIDGE_AUTH_TOKEN` จาก Doppler/env
   (`python3 scripts/build-extension.py`) — source zip ล้วนใช้ไม่ได้ (placeholder)
4. ⚠️ ไฟล์ `/Users/kimlenglim/Project/HoroConsultant/.env` มี live secrets หลายตัว
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

