---
title: Blue Team, Red Team with TDD & Pre-flight Work Audit Governance
trigger: always_on
---

# Mandatory Rule: Blue Team, Red Team with TDD & Pre-Flight Work Audit

กฎระเบียบและแนวทางปฏิบัติภาคบังคับในการพัฒนาและบำรุงรักษาระบบ `aipass-web-bridge`:

---

## 1. การตรวจสอบงานที่ดำเนินการไปแล้วก่อนเริ่มงานใหม่ (Pre-Flight Work Audit)

ก่อนที่จะเริ่มรับงานใหม่, เขียนโค้ดใหม่, หรือเปลี่ยนขอบเขตของงาน Agent ต้องดำเนินการตรวจสอบสถานะงานเดิม (Past Work Audit) ให้ครบถ้วนเสมอ:

1. **Audit Checkpoint & Docs**:
   - อ่านและตรวจสอบสถานะล่าสุดใน `plan.md` และ `HANDOFF.md`
   - ตรวจสอบว่างานในรอบก่อนหน้าเสร็จสิ้นจริง มีหลักฐานยืนยัน (Test passes, Git commit, CI run)
   - หากมีงานค้างหรือ Regression ต้องเคลียร์หรือระบุให้ชัดเจนก่อนเปิดงานใหม่
2. **Health & CI/CD Status**:
   - ตรวจสอบสถานะการทำงานของ Production Endpoint (`/status`)
   - ตรวจสอบผลลัพธ์ของ GitHub Actions ครั้งล่าสุด (ต้องผ่านทุก Job: `smoke`, `blueteam`, `redteam`, `deploy`)
3. **Submodule & Workspace Hygiene**:
   - ตรวจสอบสถานะ Git working tree (`git status`) และสถานะ Git submodule (`packages/core`) ว่า Clean และตรงกับ Head ที่ต้องการ

---

## 2. หลักการพัฒนาแบบ TDD (Test-Driven Development)

ทุก Feature ใหม่, การ Refactor, หรือการแก้ไขบั๊ก ต้องดำเนินการตามวัฏจักร TDD อย่างเคร่งครัด:

1. **Red (Write Test First)**:
   - สำหรับ Bug Fix: ต้องสร้าง Reproduction Test Case ที่จำลองบั๊กและทดสอบล้มเหลว (Red) ก่อนเสมอ
   - สำหรับ Feature/Contract: ต้องเขียน Unit Test หรือ Adversarial Test ที่ระบุ Behavior ตาม `docs/API-SPEC.md` ก่อนลงมือแก้โค้ดระบบ
2. **Green (Minimal & Correct Fix)**:
   - พัฒนาโค้ดให้เรียบง่ายและถูกต้องที่สุดเพื่อให้ Test ผ่าน (Green)
   - ห้ามแก้ไขหรือลดทอน Assertions ของชุดทดสอบเพื่อเลี่ยงให้ Test ผ่านเด็ดขาด
3. **Refactor & Gate**:
   - ปรับปรุงคุณภาพโค้ดให้สะอาด ปราศจาก Technical Debt (`TODO`, `FIXME`, `HACK`)
   - รัน `npm test` ต้องผ่าน 100% (ห้ามมี fail, cancelled หรือ skipped โดยไม่จำเป็น)

---

## 3. เสาหลัก Blue Team (Defensive Security & Hygiene)

Blue Team ทำหน้าที่เป็นเกราะป้องกันเชิงรับ เพื่อความปลอดภัยสูงสุดของระบบ:

1. **Zero-Token-Leak (กฎเหล็ก G1)**:
   - ห้ามมี Literal Token หรือ Secret ใดๆ ฮาร์ดโค้ดใน Source Code, Extension Source, Wrangler Config, หรือ Docs
   - ซอร์สโค้ดใน Extension ต้องใช้ `__BRIDGE_AUTH_TOKEN__` placeholder เท่านั้น และแทนที่ค่าใน Build-time (`scripts/build-extension.py`)
   - ตรวจสอบด้วย Gitleaks Scanner ทั้งใน Working Tree และ Commit History
2. **Artifact & Git Hygiene**:
   - ไฟล์ผลลัพธ์จากการ Build ที่มีการฉีด Secret จริง เช่น `release/*-built*/` และ `release/*-built*.zip` ต้องถูกระบุใน `.gitignore` เสมอ ห้าม commit หรือ stage เข้า git เด็ดขาด
3. **Dependency & Configuration Hygiene**:
   - ตรวจสอบช่องโหว่ของ Dependencies ด้วย `npm audit --audit-level=high`
   - ลำดับความสำคัญของ Config Loader: **Doppler → Cloudflare Worker Environment Variables → .env → Defaults**
   - หากไม่มี Secret ที่จำเป็น ต้องตอบ Error `503 secrets_unconfigured` ทันทีแบบ Fail-fast

---

## 4. เสาหลัก Red Team (Offensive Security & Adversarial Chaos)

Red Team ทำหน้าที่ทดสอบการบุกรุกและสภาวะวิกฤต (Adversarial Testing) ก่อน Deploy เสมอ:

1. **Adversarial Chaos Suites (`packages/core/aipass-bridge/test/red-team-chaos.test.mjs`)**:
   - **RED-1 (Split-brain Prevention)**: การเชื่อมต่อใหม่ต้อง Invalidate Session Epoch เก่าทันที
   - **RED-2 (Upstream 403 / Error Injection)**: จำลองข้อผิดพลาดจาก Cloudflare/AI Engine ระบบต้องรอด ไม่ล่ม คิวต้องคลายตัว
   - **RED-3 (Leader Disconnect / Failover)**: ขาดการเชื่อมต่อระหว่างประมวลผล ต้องไม่เกิด Crash และรองรับตัวใหม่ขึ้นแทน
   - **RED-4 (Epoch Replay Attack Prevention)**: Wire messages ต้องตรวจสอบ `sessionEpoch` อย่างเข้มงวด ปฏิเสธ Request จาก Stale Session
   - **RED-5 (Queue Backpressure & Overflow)**: เมื่อคำขอเกินขีดจำกัด (เช่น เกิน 10 requests) ต้องตอบ `429 queue_full` ทันที
2. **SSRF & Network Boundary Defense (`packages/core/aipass-bridge/test/ssrf.test.mjs`)**:
   - ปฏิเสธ Private IP Ranges, Loopback, Link-Local ทุกรูปแบบ
   - ป้องกัน Redirect Loop และ Redirect สู่ Non-HTTP schemes
3. **Gate Enforcement**:
   - ทุกครั้งที่ Push โค้ดหรือเปิด PR ทั้งชุดทดสอบ Blue Team และ Red Team ต้องผ่าน 100% บน GitHub Actions ก่อนเข้าสู่ Deploy Job
