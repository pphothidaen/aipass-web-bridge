# 🔴 RED TEAM AUDIT — GOVERNANCE_TICKET_HIERARCHY.md
## วันที่: 2026-09-23 | ผู้ตรวจสอบ: Red Team Subagent
## ขอบเขต: TDD Enforcement, Atomic Execution, Governance Evasion

---

## EXECUTIVE SUMMARY

ตรวจพบช่องโหว่ระดับ **CRITICAL** 8 รายการ, **HIGH** 10 รายการ, **MEDIUM** 8 รายการ, **LOW** 5 รายการ
ความเสี่ยงหลัก: Governance เป็น "self-certification" มากกว่า "technical enforcement" — agents สามารถ bypass ทุก gate ได้โดยไม่มี technical guard

---

## 🔴 CRITICAL FINDINGS

### C1: Pre-Commit Hook Bypass — `--no-verify` ทำลาย TDD ทั้งระบบ
**บรรทัดที่บอด:** ทั้งเอกสาร (ไม่มีกล่าวถึง `--no-verify`)
**กฎที่หายไป:** ไม่มีการป้องกัน `git commit --no-verify` หรือ `git push --no-verify`

**วิธี Exploit:**
```bash
# Agent เขียน code ก่อน test แล้ว bypass hook ได้เลย
git add -A
git commit --no-verify -m "feat: done"
git push --no-verify
```

**ผลกระหม:** TDD RED→GREEN ถูกข้ามโดยสิ้นชัง ไม่มี technical gate ใดๆ ป้องกันได้

**แนวทางแก้:**
- เพิ่ม GitHub Ruleset: "Require status checks to pass before merge" สำหรับ "Test Provenance" check
- บล็อก direct push to main เสมอ (PR เท่านั้น)
- เพิ่ม CI step ที่ตรวจจับ commits ที่ไม่มี `Test-Baseline:` trailer
- ตั้งค่า `git config --local core.hooksPath .githooks` แบบบังคับผ่าน repo setup script

---

### C2: Squash Merge ทำลาย TDD Provenance Chain
**บรรทัดที่บอด:** ไม่มีกล่าวถึง squash merge impacts
**กฎที่หายไป:** ไม่มีการป้องกัน squash merge บน branches ที่ต้อง provenance

**วิธี Exploit:**
1. Agent สร้าง PR ด้วย test + source commits ที่ถูกต้อง
2. Reviewerอนุมัติ PR
3. Agent squash merge ผ่าน GitHub
4. ทุก ancestry ของ baseline commits สูญหาย — `verify-pr` ไม่สามารถยืนยันได้
5. Ticket เปลี่ยนเป็น Done โดยไม่มี provenance ที่ใช้งานได้

**ผลกระหม:** ประวัติ TDD ทั้งหมดถูกลบทิ้ง ไม่สามารถ audit ได้ย้อนหลัง

**แนวทางแก้:**
- บล็อก squash merge สำหรับ branches ที่มีไฟล์ใน `plans/test_provenance/`
- บังคับ "Rebase and merge" หรือ "Create a merge commit" เท่านั้น
- เพิ่ม CI step: `check-squash-merge` ที่ fail ถ้า squash detected

---

### C3: Single-Agent Ownership ขัดกับ TDD Verification
**บรรทัดที่ขัดแย้ง:** บรรทัด 23 (`me` = agent เดียวทำครบ) vs บรรทัด 72-81 (TDD cycle ต้อง RED test → GREEN impl โดย agents ต่างคน)

**วิธี Exploit:**
1. Agent รับ Subtask ที่ `who = me`
2. Agent เขียน test และ implementation ใน commit เดียวกัน
3. ไม่มี agent อื่นตรวจสอบว่า test เป็นจริงหรือหลอก

**ผลกระหม:** หลักการ "independent verification" ของ TDD ถูกทำลาย — agent เดียวทั้งผู้สอนและผู้ตรวจ

**แนวทางแก้:**
- บังคับว่า Subtask ที่ต้อง implementation ต้องมีอย่างน้อย 2 คน: test author + implementation author
- ถ้า `who = me` → ต้องแสดงให้เห็นว่า test commit แยกจาก source commit อย่างชัดเจน
- เพิ่ง CI check: ห้ามให้ agent เดียว commit ทั้ง test แลา source ใน PR เดียว

---

### C4: Hotfix Classification Abuse — "Production Down" บ่อยครั้ง
**บรรทัดที่บอด:** บรรทัด 542, 565, 896 — ไม่มีนิยามชัดเจนของ "Production Down"
**กฎที่หายไป:** ไม่มี validation ทางเทคนิคว่า production จริงๆ ลงหรือไม่

**วิธี Exploit:**
```
1. Agent พบ bug ธรรมดา → ตัดสินใจว่า "Production Down"
2. สร้าง Task โดยไม่ต้องสร้าง Story
3. ข้าม TDD cycle ได้เลย — commit ได้เลยโดยไม่มี RED test
4. ภายหลัง สร้าง Incident Epic แบบ retrospective (อาจจะลืมก็ได้)
5. Post-mortem 24 ชม. เพียงพอที่จะประดิษฐ์เรื่องโม้
```

**ผลกระหม:** ทุก Story สามารถแปลงเป็น Hotfix เพื่อหลบ TDD

**แนวทางแก้:**
- นิยาม "Production Down" ให้ชัดเจน: ต้องมี incident management system ยืนยัน (เช่น PagerDuty alert, monitoring dashboard red)
- Hotfix Task ต้องมี incident ticket จริงก่อนจะสร้าง
- เพิ่ม rate limit: Hotfix ไม่เกิน 1 ต่อ sprint ต่อ agent
- Hotfix ต้องมี automated test ภายใน 4 ชั่วโมงหลัง fix (retroactive TDD)

---

### C5: CI ไม่ถูกกำหนด — "CI RED/GREEN" เป็นนามธรรม
**บรรทัดที่บอด:** ทั้งเอกสารอ้างอิง "CI RED" และ "CI GREEN" แต่ไม่ระบุว่า CI คืออะไร
**กฎที่หายไม่:** ไม่มีบังคับว่าต้องมี CI pipeline ที่ถูกต้อง

**วิธี Exploit:**
1. Agent ตั้งค่า CI ที่ไม่มีขั้นตอนที่แท้จริง (เช่น `echo "tests pass"`)
2. CI แสดง GREEN ตลอดเวลา
3. ทุก TDD gate ผ่านโดยอัตโนมัติ

**ผลกระหม:** ทั้งระบบ TDD เป็นศูนย์ — ไม่มีการทดสอบจริง

**แนวทางแก้:**
- บังคับ CI configuration ใน repo (`.github/workflows/tdd-gate.yml`)
- CI ต้องรัน `test_provenance_guard.py staged` เป็นขั้นตอนแรก
- เพิ่ม CI health check: ตรวจสอบว่ามี test อย่างน้อย 1 ตัวที่ fail ใน RED phase

---

### C6: Self-Reported Test Results — ไม่มี Independent Verification
**บรรทัดที่บอด:** บรรทัด 91 — agent อัปเดต Subtask comment ด้วยตัวเอง
**กฎที่หายไป:** ไม่มีการบังคับให้มีภาพหน้าจอหรือ CI output จริง

**วิธี Exploit:**
```
1. Agent สร้าง Subtask และ commit code
2. Agent อัปเดต comment: "All tests passed ✓"
3. ในความเป็นจริง test ไม่เคยรัน หรือรันแล้ว fail แต่ไม่ได้รายงาน
4. ไม่มีใครตรวจสอบ
```

**ผลกระหม:** Governance เป็น "honor system" — ใครๆ ก็โกหกได้

**แนวทางแก้:**
- ต้องแนบ CI output URL ใน Subtask comment (เช่น GitHub Actions run link)
- เพิ่ม CI bot ที่ comment ผลการทดสอบกลับเข้า Jira
- บังคับให้ test command ผ่าน CI เท่านั้น (ห้าม report ด้วยตัวเอง)

---

### C7: Test Quality Gate — ไม่มีคุณภาพขั้นต่ำของ Test
**บรรทัดที่บอด:** ไม่มีกล่าวถึง test quality เลย
**กฎที่หายไป:** ไม่มีบังคับว่า test ต้องมีความหมาย

**วิธี Exploit:**
```python
# Test ที่ RED→GREEN ได้ทุกครั้งแต่ไม่ได้ทดสอบอะไร
def test_feature():
    assert 1 == 1  # Always passes — technically "GREEN"
    
def test_another():
    pass  # Empty test — passes trivially
```

**ผลกระหม:** TDD gate ผ่านแต่ไม่มี coverage จริง — false sense of security

**แนวทางแก้:**
- เพิ่ม coverage threshold ขั้นต่ำ (เช่น line coverage > 80%)
- ใช้ mutation testing เพื่อตรวจสอบว่า test จับการเปลี่ยนแปลงได้
- เพิ่ม CI step: ตรวจสอบ test ที่ไม่มี assertion (empty tests)

---

### C8: "Docs-Only" Exception Abuse
**บรรทัดที่บอด:** ไม่มีใน GOVERNANCE แต่มีใน provenance skill
**กฎที่หายไป:** ไม่มีขีดจำกัดว่า docs commit ต้องเป็น docs จริงๆ

**วิธี Exploit:**
```
# Agent เพิ่ม .md ไฟล์เล็กๆ เพื่อ claim ว่าเป็น docs commit
echo "# Updated docs" >> README.md
git add README.md src/real-implementation.py
git commit -m "docs: update docs and feature"
# Bypass test provenance เพราะมี .md ไฟล์ใน commit
```

**ผลกระหม:** Test provenance สามารถหลอกได้ง่าย

**แนวทางแก้:**
- นิยาม "docs" ให้ชัดเจน: ต้องเป็นไฟล์ใน `docs/` หรือมี extension `.md`, `.txt` เท่านั้น
- ห้ามให้ docs commit มี source code changes โดยเด็ดขาด
- เพิ่น CI check: ถ้า commit มีทั้ง docs และ source → fail ทันที

---

## 🟠 HIGH FINDINGS

### H1: 48-Hour Stale Timer Gaming
**บรรทัด:** 872
**ช่องโหว่:** Agent สามารถอัปเดต comment ทุก 47 ชั่วโมงเพื่อรีเซ็ต timer ไม่รู้จบ
**วิธี Exploit:** ใช้ cron หรือ script อัปเดต comment อัตโนมัติ
**แนวทางแก้:** ตรวจสอบการเปลี่ยนแปลงจริง (commit, status change) ไม่ใช่ comment

---

### H2: 7-Day Orphan Epic Window
**บรรทัด:** 96, 867
**ช่องโหว่:** Agent สร้าง Epic แล้วรอ 6 วัน แล้วเพิ่ม Story จมูกแก้ (dummy story) แล้ววนรอบ
**วิธี Exploit:** สร้าง Epic หลายตัว วนลูป dummy stories
**แนวทางแก้:** ลดเป็น 48 ชั่วโมง หรือตรวจสอบคุณภาพของ Story (ไม่ใช่แค่ presence)

---

### H3: Whole_Team Facilitator เป็น Single Point of Failure
**บรรทัด:** 26, 37
**ช่องโหว่:** ถ้า Hermes เปรย์/ล่ม ทุก `whole_team` ticket จะค้าง — และไม่มี escalation
**วิธี Exploit:** ทำให้ Hermes ล่ม → ทุก cross-cutting work หยุด
**แนวทางแก้:** เพิ่ม Facilitator สำรอง (backup facilitator role) + timeout escalation

---

### H4: Hermes Arbitration — ไม่มี Appeals Process
**บรรทัด:** 235
**ช่องโหว่:** Agent ที่ไม่เห็นด้วยกับ decision ของ Hermes ไม่มีทาง challenge
**วิธี Exploit:** Hermes อาจเลือกปฏิบัติ หรือตัดสินผิดพลาด — ไม่มีใครแก้ไข
**แนวทางแก้:** เพิ่ม escalation path: Hermes → Human PO → Team vote

---

### H5: Label Hijacking — ไม่มี Technical Binding
**บรรทัด:** 758
**ช่องโหว่:** Agent สามารถติด `priority-P0` ให้ทุก ticket ของตัวเอง
**วิธี Exploit:** P0 ทุก ticket → prioritization เป็นศูนย์
**แนวทางแก้:** จำกัดจำนวน P0 ต่อ sprint (เช่น max 3 P0 ต่อ agent) + ตรวจสอบโดย lead_ba

---

### H6: Rubber-Stamp Reviewers
**บรรทัด:** 42
**ช่องโหว่:** Agent สามารถ approve PR ของตัวเองได้ถ้าเป็น reviewer ที่ไม่ใช่ assignee แต่เป็น "agent ตัวเอง" ในความหมางวงกว้าง
**วิธี Exploit:** สร้าง reviewer ที่เป็น "ตัวเอง" แต่เป็น agent ตัวอื่น (เช่ง subagent)
**แนวทางแก้:** บังคับว่า reviewer ต้องเป็น agent ที่มีต่าง role อย่างชัดเจน

---

### H7: Epic Scope Creep — ไม่มี Story Quality Gate
**บรรทัด:** 695
**ช่องโหว่:** Agent สามารถเพิ่ม Story เข้า Epic ได้ไม่รู้จบ จนกว่าจะถึง 10 ตัว — แต่ไม่มีใครบังคับ split
**วิธี Exploit:** เพิ่ม Story ทุก 2 สัปดาห์ → ไม่มี Epic ถูก split → กลายเป็น Initiative ที่ไม่มีที่สิ้นสุด
**แนวทางแก้:** จำกัด max stories/Epic = 8 + auto-close ถ้าไม่มี activity 30 วัน

---

### H8: Decision Tree Ambiguity — "Quick Fix" Self-Assessment
**บรรทัด:** 656
**ช่องโหว่:** Agent self-assess ว่า "quick fix" ได้ — ไม่มี independent validation
**วิธี Exploit:** ทุก bug เป็น "quick fix" ได้ถ้า agent ต้องการหลบ Story
**แนวทางแก้:** นิยาม "quick fix" ให้ชัดเจน: <2 files changed, <100 LOC, automated test อย่างน้อย 1 ตัว

---

### H9: Research Story Infinite Loop
**บรรทัด:** 825, 898
**ช่องโหว่:** Agent สามารถสร้าง Research Story ต่อเนื่องได้ไม่รู้จบ โดยไม่ต้อง implement จริง
**วิธี Exploit:** Research → สร้าง follow-up Research → วนลูปไม่รู้จบ
**แนวทางแก้:** จำกัด max 2 Research Stories ต่อ topic + escalation ถ้าเกิน

---

### H10: 5W1H Self-Reported — ไม่มี Technical Validation
**บรรทัด:** 909-919
**ช่องโหว่:** Agent กรอก 5W1H ด้วย placeholder text แล้ว claim complete
**วิธี Exploit:** กรอก "TBD" ทุกช่อง → technically "complete" แต่ไม่มีข้อมูล
**แนวทางแก้:** เพิ่ม field validation: ห้ามมีคำว่า "TBD", "TODO", "pending" ใน required fields

---

## 🟡 MEDIUM FINDINGS

### M1: Role Impersonation — Labels ไม่ได้ bound กับ Agent Identity
**บรรทัด:** 668-676, 716
**ช่องโหว่:** Agent agy2 สามารถ label ตัวเองว่าเป็น `agent-codex1` ได้
**แนวทางแก้:** ใช้ technical identity (เช่น API key, agent ID) ใน label assignment แทน self-report

---

### M2: Persona Binding ไม่มี Technical Enforcement
**บรรทัด:** 681
**ช่องโหว่:** Agent สามารถอ่าน parent Epic, sibling subtasks, หรือ git history เพื่อ context drift
**แนวทางแก้:** ส่งเฉพาะ ticket description ผ่าน API ที่ไม่มี parent reference

---

### M3: "Speculative" Flag ไม่มีผล Enforcement
**บรรทัด:** 183
**ช่องโหว่:** Agent สามารถทำงานบน speculative tickets ได้ — ไม่มีใครหยุด
**แนวทางแก้:** บล็อก speculative tickets จาก sprint assignment

---

### M4: Single-Agent Story — Reviewer Optional
**บรรทัด:** 323
**ช่องโหว่:** "possibly with reviewer/sub-agent support" — reviewer ไม่บังคับ
**แนวทางแก้:** บังคับ reviewer สำหรับ Story ทุกตัว (อย่างน้อย 1 คน)

---

### M5: Recurring Defect Threshold สูงเกินไป
**บรรทัด:** 623
**ช่องโหว่:** Bug เดิมเกิด 2 ครั้ง → แก้ไปเรื่อยๆ โด่ยไม่มี systemic fix
**แนวทางแก้:** ลดเป็น 2 ครั้ง หรือเพิ่ง severity escalation

---

### M6: Gitleaks-Only Secret Scanning
**บรรทัด:** 36
**ช่องโหว่:** ตรวจจับได้เฉพาะ known patterns — custom tokens หรือ non-standard secrets ไม่ถูกจับ
**แนวทางแก้:** เพิ่ม entropy-based scanning + manual secret review สำหรับ production infra

---

### M7: Merge Gate — Story Status สามารถเปลี่ยนเองได้
**บรรทัด:** 759
**ช่องโหว่:** Agent สามารถเปลี่ยน Story status เป็น TDD GREEN ได้ด้วยตัวเอง
**แนวทางแก้:** ใช้ CI status เป็น source of truth แทน Jira status

---

### M8: Post-Mortem 24 ชม. — เพียงพอที่จะประดิษฐ์ Rationalization
**บรรทัด:** 124, 622
**ช่องโหว่:** Agent สามารถเขียน post-mortem ที่อ้างเหตุผลแฉลบหลังการทำงาน
**แนวทางแก้:** ต้องมี evidence (logs, timestamps) และ peer review สำหรับทุก post-mortem

---

## 🟢 LOW FINDINGS

### L1: Daemon Polling Interval ไม่ระบุ
**บรรทัด:** 680
**ช่องโหว่:** Race condition ระหว่าง agents ที่พยายาม pick up ticket เดียวกัน
**แนวทางแก้:** ใช้ atomic operation (เช่น `UPDATE ... WHERE status = 'Ready'`) แทน polling

---

### L2: "Definition of Done" ไม่มี Standard
**บรรทัด:** 480
**ช่องโหว่:** Agent สามารถนิยาม DoD ตามใจ → ทุกอย่าง "Done" ได้
**แนวทางแก้:** เพิ่ม DoD template มาตรฐานสำหรับแต่ละ ticket type

---

### L3: Sprint Refinement 3 วัน — ยืดหยุ่นเกินไป
**บรรทัด:** 122
**ช่องโหว่:** Agent สามารถ refine ก่อน sprint 1 วัน แล้ว claim ว่า "3 วัน"
**แนวทางแก้:** ตรวจสอบ timestamp ของ refinement activity

---

### L4: Hotfix Task ไม่มี Rate Limit
**บรรทัด:** 896
**ช่องโหว่:** Agent สามารถสร้าง Hotfix ทุกวัน โด่ยไม่มีขีดจำกัด
**แนวทางแก้:** จำกัด max 2 Hotfixes/sprint + review โดย lead_ba

---

### L5: Orphan Subtask Detection — ไม่มี Automated Action
**บรรทัด:** 869
**ช่องโหว่:** Auto-reject เป็นเพียง recommendation — agent สามารถสร้างได้
**แนวทางแก้:** เพิ่ม Jira validator ที่บล็อกการสร้าง subtask โด่ยไม่มี parent

---

## 🎯 ATTACK SCENARIOS — End-to-End Exploits

### Scenario 1: "The Phantom Feature"
1. Agent รับ Story ที่ต้องการ TDD
2. Agent สร้าง test ที่ `assert True` และ commit เป็น RED (test fail เพราะไม่มี impl)
3. Agent เขียน implementation ที่ hardcode ค่าและ commit เป็น GREEN
4. Test ผ่านเพราะ `assert True` ไม่เคย fail จริงๆ
5. PR ผ่าน review เพราะ CI GREEN
6. ผลลัพธ์: Feature ทำงานไม่ได่แต่ทุก gate ผ่าน

### Scenario 2: "The Hotfix Factory"
1. Agent รับ Bug Report ธรรมดา
2. Agent classify ว่า "Production Down" → สร้าง Hotfix Task
3. Agent commit code โดยไม่มี test
4. Agent ไม่สร้าง Incident Epic (ลืมหรือไม่อยากทำ)
5. ผลลัพธ์: 24 ชม. ผ่าน ไม่มีใครตรวจสอบ

### Scenario 3: "The Research Rabbit Hole"
1. Agent สร้าง Research Story สำหรับ feature ใหม่
2. Research เสร็จ → สร้าง follow-up Research Story (deeper dive)
3. วนลูปไม่รู้จบ — ไม่มี agent ตรวจสอบว่าเป็นการหลบ
4. ผลลัพธ์: Sprint จบ ไม่มี feature ใดๆ implement

### Scenario 4: "The Label King"
1. Agent ติด `priority-P0` ให้ทุก Story ของตัวเอง
2. Agent ติด `sprint-<current>` ทันที
3. Agent ทำงานอย่างช้าๆ — ไม่มีใครบังคับ
4. ผลลัพธ์: P0 เป็นศูนย์ — ทุกอย่างคือ P0

---

## 📊 GOVERNANCE HEALTH SCORE

| หมวด | คะแนน | หมายเหตุ |
|------|--------|----------|
| TDD Enforcement | 2/10 | Self-certified, ทุก gate สามารถ bypass ได้ |
| Atomic Execution | 4/10 | มี guidelines แต่ไม่มี technical gates |
| Identity & Roles | 3/10 | Labels ไม่ถูก bind กับตัวตนจริง |
| Escalation & Appeals | 1/10 | ไม่มี appeals process เลย |
| Automation | 5/10 | มี Jira automation แต่ไม่ใช่ technical gates |
| Audit Trail | 4/10 | มี provenance แต่ squash merge ทำลายได้ |
| **OVERALL** | **3.2/10** | **Governance เป็น Honor System — ต้องเพิ่ม Technical Enforcement** |

---

## 🔧 PRIORITY REMEDIATION ROADMAP

### Sprint นี้ (P0):
1. **C1:** เพิ่ม GitHub Ruleset บังคับ PR + status checks (บล็อก `--no-verify` ผ่าน CI)
2. **C4:** นิยาม "Production Down" ให้ชัดเจน + ต้องมี incident ticket
3. **C6:** บังคับ CI output URL ใน Subtask comment

### Sprint ถัดไป (P1):
4. **C2:** บล็อก squash merge สำหรับ provenance branches
5. **C5:** สร้าง CI template มาตรฐานใน repo
6. **C7:** เพิ่น coverage threshold + empty test detection

### Sprint 3 (P2):
7. **C8:** นิยาม "docs commit" ให้ชัดเจน
8. **H1-H5:** แก้ Jira automation rules
9. **H6-H10:** เพี้ยม governance validation ใน CI

---

## 📎 APPENDIX: Exploit Code Samples

### Exploit 1: `--no-verify` Bypass
```bash
#!/bin/bash
# red-team-exploit-no-verify.sh
# Bypass TDD pre-commit hook entirely

FEATURE_DIR="src/implementation"
mkdir -p $FEATURE_DIR

# Write implementation WITHOUT test
cat > $FEATURE_DIR/feature.py << 'EOF'
def new_feature():
    return "hardcoded result"
EOF

# Commit and push without running hooks
git add -A
git commit --no-verify -m "feat: implement feature (TDD done manually)"
git push --no-verify

echo "[EXPLOITED] Code committed without RED test"
```

### Exploit 2: Dummy Test Pass
```python
# red-team-exploit-dummy-test.py
# Passes all TDD gates without testing anything real

def test_new_feature():
    """This test passes without any real assertion."""
    assert True  # Always passes — technically GREEN

def test_another_feature():
    """Empty test that passes."""
    pass  # Also passes — no failure possible
```

### Exploit 3: Hotfix Factory
```python
# red-team-exploit-hotfix.py
# Creates hotfix tickets to bypass Story/TDD requirements

import jira

def create_hotfix_bypass(bug_description):
    """Classify any bug as 'production down' to skip Story."""
    ticket = jira.create_issue(
        project="KAN",
        issuetype="Task",  # Task, not Story!
        summary=f"[HOTFIX] {bug_description}",
        description="Production down — need immediate fix",
        priority="Highest",
        # No acceptance criteria needed
        # No TDD subtasks needed
        # No reviewer needed
    )
    return ticket.key  # Returns HOTFIX-123
```

---

*Audit completed. 31 findings total. Recommend immediate P0 remediation before next sprint.*
