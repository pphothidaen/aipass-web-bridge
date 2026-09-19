# 🛡️ AiPASS Web Bridge — Architectural & Execution Guardrails

> **เอกสารข้อบังคับและกฎเหล็ก (Guardrails) สำหรับการพัฒนา, การรัน Subagents, และการขยายระบบ**  
> **Baseline:** v0.6.3 | **สถานะ:** Active & Enforced  
> **เป้าหมาย:** ป้องกัน System Regression, ยึดหลัก Blue Team & Red Team with TDD, ตรวจสอบงานเก่าก่อนเริ่มงานใหม่เสมอ (Pre-Flight Audit), และรักษาความปลอดภัย Zero-Token-Leak

---

## 🏛️ สรุปภาพรวม 5 เสาหลักของ Guardrails

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                       AIPASS WEB BRIDGE GUARDRAILS                          │
├─────────────────┬─────────────────┬─────────────────┬───────────────────────┤
│  G1: Security   │  G2: Integrity  │  G3: Isolation  │  G4: Regression Gate  │
│  Zero Token Leak│  Strict Fail-   │  DO RAM & State │  Blue & Red Team TDD  │
│  Bearer Auth    │  Closed (No Mock│  Queue Deadlines│  Pre-Flight Audit     │
├─────────────────┴─────────────────┴─────────────────┴───────────────────────┤
│                     G5: Hybrid & Fallback Governance                        │
│          AiPASS Web Bridge (Primary) ↔ Local Agent Fallback Engine          │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 0. G0: Pre-Flight Work Audit & Governance (ตรวจสอบงานเดิมก่อนเริ่มงานใหม่)

* **[G0.1]** **ห้ามเริ่มงานใหม่โดยไม่ตรวจสอบงานที่ดำเนินการไปแล้ว**: ก่อนเริ่มพัฒนา Feature ใหม่, Refactor หรือเปิด Session งานใหม่ Agent ต้อง:
  1. อ่าน `plan.md` และ `HANDOFF.md` เพื่อสรุปสถานะล่าสุด
  2. ตรวจสอบ Git status (`git status`, `git submodule status`) ว่าสะอาดและซิงค์ถูกต้อง
  3. ตรวจสอบผล CI/CD ล่าสุดว่าผ่าน 100% ครบทุก Gates
  4. ทดสอบสถานะ Live Production Worker (`/status`) ว่าตอบสนองปกติ
* **[G0.2]** **Checkpoint Maintenance**: ทุกครั้งที่เสร็จสิ้นภารกิจหรือจบ Session ต้องอัปเดต `plan.md` และ `HANDOFF.md` ให้สะท้อนความเป็นจริง พร้อมบันทึกผลการทดสอบ

---

## 1. G1: Security & Token Privacy Guardrails (กฎเหล็กด้านความปลอดภัย)

### 1.1 Zero-Token-Leak & Build-Time Injection
* **[G1.1.1]** **ห้ามเด็ดขาด** ในการมี Hardcoded Secret Tokens หรือ API Keys ใน Source Code, Extension Source, Wrangler Config หรือ Documentation
* **[G1.1.2]** ซอร์สโค้ดของ Chrome Extension (`packages/core/aipass-bridge/extension/` และ `release/chrome-extension/`) ต้องมีเพียง Placeholder `__BRIDGE_AUTH_TOKEN__` เท่านั้น
* **[G1.1.3]** การสร้าง Distribution Artifacts สำหรับ Kiwi Browser หรือ Chrome ต้องผ่าน `scripts/build-extension.py` ซึ่งจะฉีดค่าจริงที่ Resolve จาก Doppler หรือ Environment ในขณะ Build เท่านั้น
* **[G1.1.4]** ไดเรกทอรี `release/*-built*/` และ `release/*-built*.zip` ที่มี Secret จริง **ต้องอยู่ใน `.gitignore` เสมอ** ห้าม commit หรือ stage เข้า git repository เด็ดขาด

### 1.2 Boundary Authentication
* **[G1.2.1]** Extension ↔ Cloudflare DO: ยืนยันตัวตนด้วย `BRIDGE_SECRET` ผ่าน `Authorization: Bearer <token>` หรือ `x-bridge-token`
* **[G1.2.2]** AI Client ↔ Cloudflare DO: ยืนยันตัวตนด้วย `CLIENT_API_KEY`
* **[G1.2.3]** Public Endpoints ที่อนุญาตโดยไม่ต้องใช้ Token มีเพียง `/`, `/health`, `/status`, และ Preflight `OPTIONS` เท่านั้น

---

## 2. G2: Integrity & Strict Fail-Closed Policy (กฎความซื่อสัตย์ของระบบ)

### 2.1 No Fabrication & Strict OpenAI Error Envelopes
* **[G2.1.1]** **ห้ามใช้ Canned Responses หรือ Mock Data หลอก Client เด็ดขาด** หากระบบไม่สามารถประมวลผลผ่าน AiPASS ได้จริง ต้องตอบ Error HTTP Status ที่ถูกต้องตาม `docs/API-SPEC.md` ทันที:
  * `401 Unauthorized` (`code: "invalid_api_key"`): เมื่อไม่มี Token หรือ Token ไม่ถูกต้อง
  * `503 Service Unavailable` (`code: "extension_disconnected"`): เมื่อไม่มี Extension เชื่อมต่ออยู่
  * `503 Service Unavailable` (`code: "secrets_unconfigured"`): เมื่อ Edge ขาดการตั้งค่า Secret ที่จำเป็น
  * `422 Unprocessable Entity` (`code: "model_unverified"`): เมื่อ Model ไม่อยู่ในแคตตาล็อก
  * `429 Too Many Requests` (`code: "queue_full"`): เมื่อคำขอในคิวเกินขีดจำกัด
* **[G2.1.2]** Error Responses ทั้งหมดต้องอยู่ใน OpenAI-Compatible Format:
  ```json
  {
    "error": {
      "message": "Human readable explanation",
      "type": "invalid_request_error",
      "code": "specific_error_code"
    }
  }
  ```

### 2.2 Session Epoch Invalidation & Replay Defense
* **[G2.2.1]** ทุกครั้งที่ Extension Reconnect หรือ Leader Disconnect หมายเลข `sessionEpoch` จะต้องถูกเพิ่มขึ้น (Bumping) ทันที
* **[G2.2.2]** Wire messages ใดๆ ที่ส่งมาพร้อมกับ `sessionEpoch` ที่เก่ากว่าสถานะปัจจุบันของ Durable Object จะต้องถูกปฏิเสธทันทีเพื่อป้องกัน Epoch Replay Attack (ผ่านการทดสอบ RED-4)

---

## 3. G3: State Isolation & Durable Object Limits (ขอบเขตการทำงานบน Edge)

### 3.1 Concurrency & Queue Backpressure
* **[G3.1.1]** รองรับคำขอประมวลผลพร้อมกันในคิวสูงสุดไม่เกิน **10 Requests** หากเกินให้ปฏิเสธด้วย HTTP `429 Too Many Requests` ทันที (RED-5)
* **[G3.1.2]** Request Timeout: หาก Extension ไม่ตอบสนองภายใน Timeout ที่กำหนด ระบบต้องตัดการรอและส่ง Error สู่ Client ทันที

### 3.2 Cloudflare DO Memory & Stream Hygiene
* **[G3.2.1]** ไม่สะสม Memory หรือแคชขยะไว้ใน Durable Object RAM
* **[G3.2.2]** เมื่อ Client ปิดการเชื่อมต่อหรือยกเลิก Stream (`AbortSignal`) ต้องสั่ง Disconnect Stream และเคลียร์ Active Streams ทันที

---

## 4. G4: Quality & Regression Gates (Blue Team & Red Team with TDD)

### 4.1 Test-Driven Development (TDD)
* **[G4.1.1]** สำหรับบั๊กหรือฟีเจอร์ใหม่ ให้เขียน Test Case ให้ทดสอบล้มเหลว (Red) ก่อนเสมอ แล้วจึงเขียนโค้ดเพื่อให้ผ่าน (Green)
* **[G4.1.2]** ห้าม bypass, skip หรือปิด test assertions ใดๆ เพื่อให้ CI หรือการทดสอบผ่าน

### 4.2 Blue Team Defensive Gate
* **[G4.2.1]** Secret leak scan ด้วย `gitleaks` ตลอดทั้ง commit history และ working tree
* **[G4.2.2]** Dependency vulnerability audit ด้วย `npm audit --audit-level=high`
* **[G4.2.3]** Secret hygiene assertion ใน worker และ extension source

### 4.3 Red Team Offensive Adversarial Gate
* **[G4.3.1]** ทุก Push และ PR ต้องผ่านชุดทดสอบ Adversarial Chaos ครบทุกกรณี:
  - `packages/core/aipass-bridge/test/red-team-chaos.test.mjs` (RED-1 ถึง RED-5b)
  - `packages/core/aipass-bridge/test/ssrf.test.mjs` (SSRF & Private IP blocking)
* **[G4.3.2]** เกณฑ์ผ่าน CI: 4 Jobs บน GitHub Actions (`smoke`, `blueteam`, `redteam`, `deploy`) ต้องเขียว 100%

---

## 5. G5: Hybrid & Fallback Governance

* **[G5.1]** ระบบ Web Bridge เชื่อมต่อกับ AiPASS Web interface เป็น Primary Channel
* **[G5.2]** หาก Web Bridge เกิด Disconnected หรือมีปัญหา ให้ระบบ Client/Hermes สลับใช้ Fallback Engine ที่ผ่านการทดสอบใน `packages/vscode-extension/scripts/test-agent-fallback.mjs` ตามลำดับที่ระบุในคอนฟิก
