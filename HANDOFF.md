# HANDOFF — aipass-web-bridge v0.6.0 (unified spec / config / CI checkpoint)

อัปเดต: 2026-09-19 · Asia/Bangkok · สถานะ: **งาน v0.6.0 เสร็จ ยังไม่ commit · รอแก้ RED-4 + release zip**

> เอกสารหลักของ checkpoint นี้คือ `plan.md` (สถานะ + ลำดับงานที่เหลือ)
> ไฟล์นี้คือบันทึกส่งต่อสำหรับ session ถัดไป — อ่านสองไฟล์นี้พอ ไม่ต้องไล่โค้ดทั้งหมด

## ⚡ สรุปงานที่ทำครั้งนี้ (2026-09-19)

เป้าหมาย: ให้ aipass-web-bridge ใช้แนวคิด/API spec/การเก็บค่า/CI เหมือน
`gemini-web-bridge` (ดูรายละเอียด contract ที่ `docs/API-SPEC.md`)

1. **Config loader ใหม่** `packages/core/aipass-bridge/bridge/config.mjs`
   - Precedence: **Doppler (DOPPLER_PROJECT/DOPPLER_CONFIG) → Cloudflare
     `wrangler.toml [vars]` → `.env` → schema defaults**
   - `server.mjs` เปลี่ยนจาก `process.env.AIPASS_*` ตรง ๆ มาใช้ `loadConfig()`
     ทั้งหมด; ค่าเริ่มต้นเดิมไม่เปลี่ยน (ยืนยันด้วยการยิง `/status` ได้ 200)
   - บั๊กที่เจอระหว่างทำ (แก้แล้ว): lookup ต้องใช้ **ชื่อ env var** (`AIPASS_PORT`)
     ไม่ใช่ชื่อ config key (`PORT`), และค่าที่ coerce ไม่ได้ต้อง fall through ไป
     layer ถัดไป ไม่ใช่ return default ทันที
2. **Worker hardening** `cloudflare/worker.js`
   - ลบ `allowed = [..., "aipass-bridge-secret-2026", "hermes-secret-key-2026"]`
     → auth ใช้ Worker secrets เท่านั้น
   - 401 เป็น envelope `{"error":{message,type:"invalid_request_error",code:"invalid_api_key"}}`
   - ไม่มี secrets เลย → `503 code:"secrets_unconfigured"` (fail fast)
   - `wrangler.toml` ลบค่า secret ออกจาก comment
3. **CI/CD** `.github/workflows/ci.yml` — job ใหม่ `blueteam` (gitleaks + npm audit +
   grep ห้ามเจอ token literal ใน worker/wrangler), `redteam` (npm test +
   red-team-chaos + ssrf), `deploy` needs ทั้งสาม, เพิ่ม trigger pull_request
   - `.gitleaks.toml` ใหม่: allowlist token default ที่ extension v0.5.5 ใช้
     (ที่เผยแพร่ไปแล้ว หมุนต้องออก extension รุ่นใหม่ — ตามข้อ 5 ใน plan.md)
4. **Docs/tests/version** — `docs/CONFIGURATION.md`, `docs/API-SPEC.md`,
   `packages/core/aipass-bridge/.env.example`, `test/test-config-loader.test.mjs`
   (7 tests, อยู่ใน `npm test`), version 0.6.0 + CHANGELOG + manifests ทั้งสองชุด

## ✅ ผลทดสอบ ณ ตอนนี้

- `npm test` (root): **32/32 ผ่าน**
- `test/test-config-loader.test.mjs`: 7/7 ผ่าน
- `ssrf.test.mjs`: 5/5 ผ่าน
- `red-team-chaos.test.mjs`: **9/10 — RED-4 fail (pre-existing, ด้านล่าง)**
- ยืนยันแล้วว่า RED-4 fail ทั้งบนโค้ดก่อนแก้ v0.6.0 (git stash แล้วรัน — fail 4 ตัว
  เพราะ server ไม่ขึ้นจากบั๊ก lookup; หลังแก้ lookup เหลือ fail เฉพาะ RED-4 ซึ่ง
  เป็น vulnerability จริงของ epoch fencing)

## 🐛 สิ่งที่ส่งต่อ: RED-4 epoch-replay (ทำต่อที่ #1 ใน plan.md)

- ไฟล์: `packages/core/aipass-bridge/bridge/bridge-do.mjs`
- `this.epochCounter = Date.now()` (บรรทัด ~41) + bump ที่ `addClient()` (~128–179)
  → reconnect ใน same-millisecond ทำให้ `sessionEpoch` ไม่เปลี่ยน → envelope เก่า
  replay ผ่าน `validateEpochEnvelope` ได้
- แก้: bump เป็น `Math.max(Date.now(), this.epochCounter + 1)` ทุกจุดที่ advance epoch
- หลังแก้: `node --test packages/core/aipass-bridge/test/red-team-chaos.test.mjs`
  ต้อง 10/10 แล้วรัน `npm test` ซ้ำ + bump patch (0.6.1) + CHANGELOG ตามกฎ AGENTS.md

## 📦 ไฟล์ที่แก้/เพิ่ม (ยังไม่ commit)

repo หลัก: `cloudflare/worker.js`, `cloudflare/wrangler.toml`,
`.github/workflows/ci.yml`, `.gitleaks.toml`(ใหม่), `docs/CONFIGURATION.md`(ใหม่),
`docs/API-SPEC.md`(ใหม่), `test/test-config-loader.test.mjs`(ใหม่),
`package.json`, `CHANGELOG.md`, `release/chrome-extension/manifest.json`, `plan.md`, `HANDOFF.md`

nested repo `packages/core/aipass-bridge`: `bridge/server.mjs`,
`bridge/config.mjs`(ใหม่), `.env.example`(ใหม่), `extension/manifest.json`
— **อย่าลืม commit ใน nested repo ก่อน แล้วค่อย commit repo หลัก**

## ⚠️ ข้อควรระวังก่อน deploy

Deploy worker ชุดใหม่แล้ว fallback token เดิมใช้ไม่ได้ทันที — ต้องแน่ใจว่า
`BRIDGE_SECRET` / `CLIENT_API_KEY` ตั้งอยู่บน Cloudflare worker แล้ว
(ตาม comment เดิมใน wrangler.toml ระบุว่าตั้งแล้ว แต่ควรตรวจจริงก่อน push)
ตรวจหลัง deploy: `curl -H "x-bridge-token: <BRIDGE_SECRET>" .../bridge/message`
ต้องได้ `{"ok":true,"protocolVersion":2}`
