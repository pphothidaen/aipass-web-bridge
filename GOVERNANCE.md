# 🛡️ Governance, DoD & Jira Tracking Rules

> **Definition of Done (DoD) และข้อบังคับการติดตามงานผ่าน Jira**
> **Baseline:** v0.7.0 | **สถานะ:** Active & Enforced
> เอกสารนี้เป็นส่วนเสริมของ `GUARDRAILS.md` และ `AGENTS.md` สำหรับบังคับใช้กฎ DoD, Jira tracking และ `agent-*` labeling

---

## 1. Pre-Implementation Mandate (ก่อนเริ่ม Implement)

- **ทุกงานต้องมี Jira Ticket และ Todo checklist ก่อนเริ่ม implement**: ห้ามเริ่มเขียนโค้ดก่อนสร้างหรืออ้างอิง Jira issue ที่ระบบ tracking ความคืบหน้า
- ทุก Task ต้องมี Monitoring & Tracking บน Jira ตลอดระยะเวลาดำเนินงาน
- สถานะ Jira issue ต้องสะท้อนความเป็นจริงของความคืบหน้า (In Progress → Review → Done)
- ใช้ `todo_list` หรือ MCP tools เพื่อจัดการ sub-task ที่ต้องทำในแต่ละ ticket

---

## 2. Mandatory Agent Labeling (`agent-*`)

ทุก Jira ticket/subtask ต้องติดป้ายกำกับ `agent-*` อย่างน้อย 1 ตัวเพื่อระบุบทบาทของผู้รับผิดชอบ:

| Label | บทบาท | คำอธิบาย |
|-------|--------|----------|
| `agent-orchestrator` | วางแผน & ควบคุม | สถาปัตยกรรมภาพรวม, จัดสรรงาน, delegation |
| `agent-developer-core` | พัฒนาแกนกลาง | โค้ดแกนประมวลผล, Durable Object, API endpoints |
| `agent-developer-api` | พัฒนา API | OpenAI-compatible envelopes, endpoints, routing |
| `agent-qa-tester` | ทดสอบ & ตรวจสอบ | ชุดทดสอบ TDD (Red/Green), ตรวจสอบความถูกต้อง |
| `agent-code-reviewer` | ตรวจสอบโค้ด | ความปลอดภัย, คุณภาพโค้ด, compliance |
| `agent-devops` | DevOps & Infra | CI/CD pipelines, Cloudflare deployment, monitoring |
| `agent-ba` | Business Analyst | วิเคราะห์ความต้องการ, acceptance criteria, docs |

### กฎการใช้ Label
- **ห้าม Transition เป็น Done หากไม่มี `agent-*` label บน ticket**
- **ห้าม Transition เป็น Done หากขาด Cross-Agent Sign-off comment** บน Jira issue
- Ticket ที่มีหลาย subtask ต้องมี label ที่แตกต่างกับตามผู้รับผิดชอบ
- ใช้ `mcp__atlassian__editJiraIssue` หรือ MCP tools เพื่อเพ่ิม/แก้ไข labels

---

## 3. Definition of Done (DoD)

ทุกงานต้องผ่านเกณฑ์ทั้งหมดก่อนปิด:

### Phase 1: Planning
- [ ] สร้างหรืออ้างอิง Jira issue แล้ว
- [ ] ติด `agent-*` label บน Jira issue แล้ว
- [ ] ระบุ Todo checklist บน Jira issue แล้ว
- [ ] มี Acceptance Criteria ชัดเจนใน issue description

### Phase 2: Implementation
- [ ] ผ่าน TDD Red-Green-Refactor
- [ ] `npm test` ผ่าน 100% (ไม่มี regression)
- [ ] ผ่าน Blue Team Hygiene (gitleaks scan, npm audit)
- [ ] ผ่าน Red Team Adversarial Gate (`red-team-chaos.test.mjs`, `ssrf.test.mjs`)
- [ ] ไม่มี hardcoded secrets หรือ tokens ในโค้ด

### Phase 3: Verification & Review
- [ ] มี Cross-Agent Sign-off comment บน Jira issue
- [ ] ผ่าน CI/CD pipeline 4 gates (`smoke`, `blueteam`, `redteam`, `deploy`)
- [ ] อัปเดต documentation ที่เกี่ยวข้อง (README, CHANGELOG, plan.md)

### Phase 4: Release
- [ ] **Git Commit & Push**: ทำการ commit การเปลี่ยนแปลงทั้งหมดขึ้น Git repository
- [ ] ให้ GitHub Actions CI/CD รัน automation pipeline ตรวจสอบ
- [ ] สร้าง artifact release อัตโนมัติ (ถ้ามี)
- [ ] อัปเดตสถานะ Jira issue เป็น Done (หากผ่านทุกเกณฑ์)

---

## 4. Jira MCP Integration

ใช้ MCP tools สำหรับจัดการ Jira:
- `mcp__atlassian__createJiraIssue` — สร้าง issue ใหม่พร้อม `agent-*` labels
- `mcp__atlassian__editJiraIssue` — แก้ไข issue (เพิ่ม labels, เปลี่ยนสถานะ)
- `mcp__atlassian__getJiraIssue` — อ่านรายละเอียด issue
- `mcp__atlassian__search` — ค้นหา issue ด้วย JQL

**Jira Project Key เริ่มต้น:** `HERMES`

---

## 5. Git Hooks Enforcement

### Pre-commit Hook
- ตรวจสอบ commit message ให้มี Jira issue key (เช่น `HERMES-123: ...`)
- สแกนห้าม commit hardcoded secret (gitleaks)
- ตรวจสอบรูปแบบ commit message

### Pre-push Hook
- รัน `npm test` อัตโนมัตี
- สกัดการ push หากเทสต์ไม่ผ่าน
- ตรวจสอบว่า git status clean

---

## 6. CI/CD Pipeline Integration

เมื่อ Push ขึ้น branch หลัก:
1. GitHub Actions รัน automation pipeline
2. ตรวจสอบผ่าน 4 gates: `smoke`, `blueteam`, `redteam`, `deploy`
3. สร้าง artifact release อัตโนมัติ
4. Deploy ขึ้น production (Cloudflare Workers)

**DoD ขั้นสุดท้าย:** งานทำเสร็จสมบูรณ์ก็ต่อเมื่อ commit & push ผ่าน CI/CD และ production ทำงานปกติ
