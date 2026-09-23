# 🏗️ TICKET HIERARCHY GOVERNANCE
## Epic → Story/Feature → Task → Subtask — Decision Framework & Validation Rules

> **Effective:** 2026-09-23 | **Updated:** 2026-09-23 | **Owner:** Hermes Agent (Orchestrator)
> **Scope:** All work tracked in Jira Project **KAN** (HermoConsultant Multi-Agent Team)
> **Hierarchy:** `Initiative (optional)` → `Epic` → `Story / Feature` → `Task` → `Subtask`

---

## 📐 THE 5W1H FRAMEWORK — Before ANY Ticket Is Created

> Every ticket — from Epic to Subtask — MUST be documented with these six dimensions.
> A ticket missing any W/H is a governance violation and cannot leave the `Created` state.

### WHO — Ownership & Roles

```
who does it: me | somebody else | a specific role | the whole team
```

| ผู้รับผิดชอบ | ระบุใน Field | หมายเหตุ |
|------------|-------------|---------|
| **Me** (agent เดียวทำครบ) | `Assignee: agent-<self>` | Subtask / Task ระดับ atomic |
| **Somebody else** (assign ให้คนอื่น) | `Assignee: agent-<role>` พร้อม `label: agent-<role>` | Story/Subtask ที่ต้อง specialist |
| **A specific role** (ตามบทบาท ไม่ใช่คน) | `Role: developer_core | red_team | blue_team | lead_ba` | ถ้าทีมเล็กและ role = agent เดียว |
| **The whole team** (ทุกคนมีส่วนร่วม) | `Squad: <sprint-team>` พร้อม `label: team-all` | Epic Kickoff / Incident / Town Hall |

#### Hermes Agent Team — Role Registry

| Role | บทบาท | ผู้รับผิดชอบหลัก |
|------|--------|----------------|
| **me** (agent เดียว) | Atomic work — single session, single file | agy1-4 / codex1-3 / node6 |
| **lead_ba** | กำหนด acceptance criteria, review spec | Hermes (planning) / human PO |
| **developer_core** | เขียน code หลัก, TDD cycles | agy1-4 / codex1-3 |
| **red_team** | Adversarial testing, failure injection | agy / codex (red-team skill) |
| **blue_team** | Security scan, hygiene gate, secret detection | Hermes + gitleaks CI |
| **whole_team** | Cross-cutting kickoff, retrospective, incident | ทุงทีม |

#### WHO Governance Rules:
1. ทุก Subtask ต้องมี **Assignee ชัดเจน** — ห้าม "unassigned" ถ้า status เป็น Ready ขึ้นไป
2. ทุก Story ต้องมี **Reviewers** อย่างน้อย 1 คน (ไม่ใช่ assignee เอง)
3. ทุก Epic ต้องมี **Epic Owner** (ไม่ใช่ Hermes เสมอไป) — เป็นคนทำ decomposition
4. ถ้า `role = whole_team` → ต้องมี **Facilitator** กำกับ (ไม่ใช่ทุกคนพร้อมกัน)
5. **ห้าม unassigned ถ้าไม่มี label `help wanted`** — เพราะ orphan detection จะ flag

---

### WHAT — Repeatable Steps (The Execution Playbook)

```
what to do, i.e. the repeatable steps
```

#### Epic Playbook (เมื่อสร้าง Epic ใหม่)

```markdown
## What to do — Epic Decomposition
1. [ ] สร้าง Epic ใน Jira พร้อม 5W1H ครบ
2. [ ] แบ่งเป็น Stories ≥3 ตัว (P0→P3), แต่ละอันอยู่ใน 1 sprint
3. [ ] ตั้ง Sprint แต่ละ Story → กำหนง deadline
4. [ ] Link Stories เข้ากับ Epic (Epic Link field)
5. [ ] สร้าง Subtasks ภายใต้แต่ละ Story (≥2 ตัว)
6. [ ] Assign แต่ละ Subtask ให้ agent ที่เหมาะสม
7. [ ] ตั้ง Story Points (ถ้าใช้) หรือ T-shirt size (S/M/L/XL)
8. [ ] สร้าง Confluence page สำหรับ Epic context
9. [ ] ตั้ง Jira Automation: "7 วัน ไม่มี Story → alert Hermes"
10. [ ] Review กับ team (ถ้า whole_team) → บันทึกลง Epic comment
```

#### Story Playbook (TDD Cycle)

```markdown
## What to do — TDD RED→GREEN→REFACTOR
1. [ ] ตรวจสอบ Story มี Acceptance Criteria ครบ (Given/When/Then)
2. [ ] สร้าง Subtasks: RED test → GREEN impl → REFACTOR (สัญลักณ์)
3. [ ] ลงทะเบียน test file ก่อน — commit แรกต้อง RED
4. [ ] Implement ให้ test ผ่าน — commit ที่ 2 ต้อง GREEN
5. [ ] Refactor โดยไม่ทำลาย test — commit ที่ 3+
6. [ ] เปิด PR พร้อม link ไป Story
7. [ ] Request review จาก agent ที่ไม่ใช่ตัวเอง
8. [ ] Merge → Story เปลี่ยนสถานะเป็น Review → Done
```

#### Subtask Playbook (Atomic Execution)

```markdown
## What to do — Single Session Execution
1. [ ] อ่าน Parent Story → เข้าใจ acceptance criteria
2. [ ] ตรวจสอบ Subtask description ชัดเจน (≤100 คำ)
3. [ ] ทำงานจนจบ — commit message ต้อง reference Subtask ID
4. [ ] อัปเดต Subtask comment: สรุปผล, ไฟล์ที่เปลี่ยน, test result
5. [ ] เปลี่ยนสถานะ → Done → แจ้ง Hermes / อัปเดต Parent Story
```

#### WHAT Governance Rules:
1. Playbook ที่กล่าวข้างต้นต้อง **ทำตามทุกขั้น** — ห้าม skip step โดยไม่มี comment อธิบายเหตุผล
2. ถ้าเป็น `me` ทำครบ → ต้องยืนยันว่าจบครบทุก step ใน description
3. ถ้าเป็น `somebody else` → ต้อง mention agent นั้นใน comment ด้วย
4. ถ้าเป็น `whole_team` → ต้องมี facilitator กำกับ step ตามลำดับ

---

### WHEN — Agile Heartbeat (Timing & Cadence)

```
when to do it, i.e. when the practice fits in the agile heartbeat
```

| ช่งเวลา | สิ่งที่ทำ | Ticket Level ที่เกี่ยวข้อง |
|---------|----------|--------------------------|
| **Sprint Planning** (เริ่มสปรินต์) | เลือก Stories จาก backlog → assign sprint | Story → สร้าง Subtasks ถ้ายังไม่มี |
| **Daily Standup** (ทุกเช้า) | ตรวจสอบ In-Progress, Blocked, Stale | Subtask ที่ทำงานอยู่ |
| **Sprint Review** (สุดสปรินต์) | นำเสนอ Story ที่ Done → collect feedback | Story Done แล้ว |
| **Sprint Retrospective** (หลัง review) | ประเมิน process → ปรับ governance | Governance update → Research Story |
| **Backlog Refinement** (กลาง sprint) ประชาสัมพันธ์ Epic/Story ใหม่ที่พร้อม | Epic / Story decomposition |
| **On-Demand** (เฉพาะเจาะจง) | Hotfix, incident, blocking issue | Task / Subtask ข้าม Story ได้ |
| **Anytime** (Research ลอยๆ) | มีไเรื่องให้สำรวจแล้วไม่ใช่ sprint work | Research Story สร้าง backlog |

#### WHEN Governance Rules:
1. **Epic** → ต้องมีตั้งแต่ Sprint Planning ของ sprint แรกที่จะทำมัน
2. **Story** → ต้อง refine ให้เสร็จก่อน sprint เริ่ม 3 วัน
3. **Subtask** → สร้างได้ระหว่าง sprint ถ้า Story ต้องแบ่งเพิ่ม แต่ต้อง update Parent
4. **Research Story** → สร้างได้ทุกเมื่อ แต่ต้อง link กับ Epic ที่เกี่ยวข้อง (หรือ backlog)
5. **Hotfix Task** → ต้องมี post-mortem ภายใน 24 ชม. หลัง fix (สร้าง Incident Epic)
6. **ห้าม sprint ไหนไม่มี Story P0** — ทุก sprint ต้องมี deliverable ที่มนุษย์เห็นผล

---

### WHERE — Context & Scope

```
where to do it, i.e. the context for which the practice is intended
```

| Context | ระบุใน Field | ตัวอย่าง |
|---------|-------------|---------|
| **Codebase** (repo / subsystem) | `Component/s: <repo>` เช่น `cloudflare`, `chrome-extension`, `vscode-extension` | Epic ที่กระทบ 2 components ต้อง link กัน |
| **Environment** (staging, prod, local) | `Environment: <staging|production|local>` | ถ้าเป็น production fix ต้องระบุถึง blast radius |
| **Pipeline Stage** | `customfield: <build|deploy|monitor|test>` | เลือก stage ที่ ticket นี้อยู่ |
| **Squad/Team** | `Squad: <team-name>` | ถ้าเป็น whole_team ต้องระบุว่าทีมไหน |
| **Deployment Wave** | `fixVersion/s: <wave-1|wave-2|wave-3>` | Epic แบ่งได้หลาย wave |

#### WHERE Governance Rules:
1. ทุก ticket ต้องมี **Component** — Hermes จะ auto-fill จาก code path ถ้าเป็น Subtask
2. ถ้าเป็น `Environment: production` → ต้องมี **Rollback Plan** ใน description
3. ถ้าเป็น `Squad: whole_team` → ต้องระบุ **Channel** (เช่น Slack, Discord, standup)
4. ถ้า `fixVersion` หลาย wave → ต้องแยกเป็น Story แยก ไม่ใช่ 1 Story หลาย wave

---

### WHY — Gap Analysis & Evidence

```
why do it, i.e. the gap the practice fills and proof it will do it effectively
```

#### WHY Template (ทุก Epic/Story ต้องตอบ):

```markdown
## Why this ticket exists
### The Gap (ปัญหาที่ต้องแก้)
- ปัจจุบัน: <สถานะปัจจุบันที่ไม่พึงประสงค์>
- ที่มา: <Audit finding ID | User report | Red team discovery | Production incident>

### Expected Outcome (สิ่งที่จะเปลี่ยน)
- หลังแก้: <สถานะที่ต้องการ>

### Proof of Effectiveness (จะรู้ได้ยังไงว่าได้ผล)
- Metric: <SLI/SLO ที่วัดได้> เช่น error_rate < 0.1%, p95 latency < 200ms
- Test: <ชื่อ test ที่ต้องผ่าน> เช่น red-team-chaos.test.mss pass RED→GREEN
- Manual Verification: <steps สำหรัก review ด้วยมนุษย์>

### Evidence Sources
- Audit: HOROC-AUDIT-2026-<ID>
- Incident: INC-<YYYYMMDD>-<N>
- Red Team: RED-<Epic Key>-<Finding #>
- User Feedback: <slack thread / email / ticket>
```

#### WHY Governance Rules:
1. **ห้ามสร้าง ticket ที่ไม่มี "The Gap" ชัดเจน** — ถ้าเป็น "nice to have" ต้องระบุ business value
2. **ทุก Epic ต้องมี Proof of Effectiveness** — ไม่งั้นไม่รู้ว่าประสบความสำเร็จ
3. **ถ้าไม่มี Evidence Source** → ticket ถูก flag เป็น `speculative` และไม่ได้ priority สูง
4. **Research Story ไม่ต้องมี Proof** แค่ Method ชัดเจน เพราะ output เป็น knowledge

---

### HOW — Principles & Values

```
how it works, i.e. the underlying principle(s) and value(s)
```

#### Core Principles ของ Hermes Agent Team

| Principle | ความหมาย | บังคับใช้ผ่าน |
|-----------|----------|---------------|
| **TDD** (Test-Driven Development) | เขียน test ก่อน code — RED เป็นสถานะ ไม่ใช่ exception | Pre-commit hook, branch protection |
| **Zero-Token-Leak** | ไม่มี plaintext secret ใน code, config, หรือ ticket description | Gitleaks CI, Blue Team Subtask |
| **Orphan Prevention** | ไม่มี Subtask ลอยนอก, ไม่มี Epic ไร้ Story | Jira automation, Hermes audit loop |
| **Single-Agent Ownership** | แต่งละ unit = หนึ่ง agent ไม่ใช่ 2 agent ที่งานเดียวกัน | Assignee field, Hermes assignment logic |
| **INVEST in Stories** | Story ต้อง Independent, Negotiable, Valuable, Estimable, Small, Testable | Red Team decomposition review |
| **Governance as Code** | กฎทุกอย่างอยู่ใน repo ไม่ใช่ความจำของคน | AGENTS.md, this file, hooks |
| **Reversible Changes** | ทุกการเปลี่ยนแปลงต้อง rollback ได้ — commit ต้อง atomic | Blue Team merge gate |

#### HOW — Implementation Flow

```
Ticket Created
     │
     ├─ Hermes validates 5W1H completeness
     │   ├─ PASS → Status: Ready
     │   └─ FAIL → Comment: missing fields, stay Created
     │
     ├─ Agent picks up → Status: In Progress
     │   ├─ TDD RED: Test commit (CI RED)
     │   ├─ TDD GREEN: Impl commit (CI GREEN)
     │   ├─ Refactor: Cleanup commit
     │   └─ PR opened → Status: Review
     │
     ├─ Review Agent (not assignee)
     │   ├─ Approved → Blue Team scan
     │   │   ├─ Clean → Status: Done
     │   │   └─ Leak detected → Revert to TDD RED
     │   └─ Changes requested → Back to TDD GREEN
     │
     └─ Merge → Production → Monitoring
         ├─ Healthy → Epic progress updated
         └─ Alert → Rollback → Incident Epic (post-mortem)
```

#### HOW Governance Rules:
1. ทุก agent ต้อง **เข้าใจ principles เหล่านี้** ก่อรับ ticket — อ่าน GOVERNANCE_TICKET_HIERARCHY.md
2. ถ้า principle ขัดแย้งกับความเร่งด่วน → **Hotfix exception** แต่ต้องมี post-mortem 24 ชม.
3. Hermes เป็นคนตัดสินในกรณี **ไม่มีกฎหรือกฎขัดแย้ง** — decision บันทึกใน Epic comment

---

## 1. THE FOUR LEVELS — DEFINITIONS & TRIGGERS (with 5W1H Integrated)

### 1.1 EPIC 💎 (Portfolio-Level Container)

| Attribute | Specification |
|-----------|---------------|
| **What it is** | A large body of work spanning multiple sprints, multiple agents, multiple systems |
| **Timeframe** | 2+ sprints (typically 4–12 weeks) |
| **Value Track** | Strategic objective / Campaign-level outcome |
| **Agent Scope** | Coordinated work across 3+ specialist agents |

#### ✅ CREATE an Epic WHEN:

```
□ Work spans ≥3 sprints
□ Multiple specialist agents must coordinate (e.g., codex1 + agy2 + gemini MCP)
□ Cross-cutting concern touching ≥2 subsystems (e.g., infra + frontend + security)
□ Campaign-level initiative with independent business value
□ Audit finding remediation that batches multiple issues (e.g., KAN-38: HOROC Audit 25 discrepancies)
□ Architectural overhaul requiring phased delivery (e.g., KAN-86: Self-Improvement & Architecture)
```

#### ❌ DO NOT create an Epic WHEN:

```
□ Work finishes in a single sprint → use Story instead
□ Single agent can own the full delivery → use Story or Task
□ Pure research/spike with no deliverable → use "Research:" prefixed Story
□ Operational overhead (standups, tooling) → use Task under existing Sprint Story
```

**Example (from KAN board):**
- ✅ `KAN-38` — HOROC Audit Remediation (25 discrepancies, Sprint A→F, 6+ agents)
- ✅ `KAN-86` — Self-Improvement & Architecture Consolidation (Sprint G→J, multi-team)

#### Epic 5W1H Example

```markdown
## 5W1H — KAN-86: Self-Improvement & Architecture Consolidation

### WHO
- Epic Owner: Hermes (Orchestrator)
- Squad: whole_team (agy1-4, codex1-3, node6, gemini MCP)
- Facilitator: Hermes

### WHAT (Repeatable Steps)
1. [ ] Audit 146 skills for broken references (Subtask KAN-102)
2. [ ] Remove duplicate aliases (Subtask KAN-110)
3. [ ] Fix 6 skills with stale model refs (Subtask KAN-106)
4. [ ] Budget enforcement implementation (Subtask KAN-103)
5. [ ] Session handoff skill creation (Subtask KAN-104)

### WHEN
- Sprint G → J (P0 → P1 → P2 → P3)
- Sprint Planning: decompose Stories before sprint starts
- Daily Standup: check Blocked/Stale Subtasks

### WHERE
- Component: cloudflare, vscode-extension, chrome-extension, skills/
- Environment: staging first → production after review
- Sprint Team: whole_team (parallel agent execution)

### WHY
- Gap: 146 skills มี 29 broken refs, 5 description >60 chars, 6 stale model refs
- Expected Outcome: All skills pass governance audit, ready for AI-agent execution
- Proof: `npm run test` passes, gitleaks clean, Hermes skill audit shows 0 discrepancies
- Evidence: HOROC-AUDIT-2026-SKILLS, internal red-team audit 2026-09-21

### HOW
- Principles: TDD (RED→GREEN→REFACTOR), Orphan Prevention, INVEST in Stories
- Method: Hermes assigns Subtasks → agents execute → Hermes verifies → Blue Team gates
- Value: Reduce agent context drift, eliminate broken references, enforce governance-as-code
```

---

### 1.2 STORY / FEATURE 🔲 (Sprint-Level Deliverable)

| Attribute | Specification |
|-----------|---------------|
| **What it is** | A user-focused capability or sprint-sized initiative with clear acceptance criteria |
| **Timeframe** | 1 sprint (typically 1–2 weeks) |
| **Value Track** | Customer-facing value OR internal capability with measurable outcome |
| **Agent Scope** | Single agent owner, possibly with reviewer/sub-agent support |

#### ✅ CREATE a Story/Feature WHEN:

```
□ Deliverable fits within a single sprint
□ Has clear user story format: "As a [agent/user], I want [capability], so that [value]"
□ Can be tested with defined acceptance criteria (TDD: test exists before code)
□ ≥2 Subtasks needed to decompose the work
□ Priority-tagged (P0/P1/P2/P3) and Sprint-assigned (e.g., [Sprint G])
□ Feature flag or independent deployment possible
```

#### ❌ DO NOT create a Story WHEN:

```
□ Too large for one sprint → escalate to Epic
□ No clear "so that [value]" clause → rewrite as user story or demote to Task
□ Depends on unresolved unknowns → create "Research: <topic>" Story first
□ Pure technical chore with no user/agent value → use Task
```

**INVEST Criteria for Stories:**
- **I**ndependent — no hard blocker from other Stories
- **N**egotiable — acceptance criteria can be refined
- **V**aluable — delivers measurable capability
- **E**stimable — agent can size it within sprint
- **M**all — fits in one sprint
- **T**estable — TDD RED→GREEN cycle possible

**Example (from KAN board):**
- ✅ `KAN-87` — [Sprint G] P0: Immediate Fixes (skill audit, stale refs)
- ✅ `KAN-95` — [Sprint J] P0: ตั้ง planned workflows for CLI delegation

#### Story 5W1H Example

```markdown
## 5W1H — KAN-87: [Sprint G] P0: Immediate Fixes

### WHO
- Assignee: agy1 (developer_core)
- Reviewer: codex2
- Stakeholders: Hermes (Epic Owner)

### WHAT
- Fix 29 skills with broken file references
- Remove 8 duplicate aliases
- Fix 6 skills with stale model references
- Verify all changes pass `npm run test`

### WHEN
- Sprint: G (starts 2026-09-23)
- Planning: 2026-09-23 (decompose to Subtasks)
- Daily: check Subtask progress
- Review: 2026-09-29 (end of Sprint G)

### WHERE
- Component: skills/ (146 skill files in ~/.hermes/skills/)
- Environment: local → staging
- Pipeline: test → build → deploy

### WHY
- Gap: 29/146 skills มี broken references → Hermes skill_view() ผิดพลาด
- Expected: 100% skills resolve correctly
- Proof: `hermes skill audit` shows 0 broken refs, 0 duplicates
- Evidence: KAN-108, KAN-110, KAN-106 (Subtask details)

### HOW
- Principles: TDD (RED→GREEN→REFACTOR), Orphan Prevention
- Method: Hermes creates Subtasks → agy1 executes → codex2 reviews → merge
- Value: Agent reliability — skill references must work 100% of the time
```

---

### 1.3 TASK 📋 (Technical Action Item)

| Attribute | Specification |
|-----------|---------------|
| **What it is** | A specific technical or operational action that may not deliver user value directly |
| **Timeframe** | Hours to 2–3 days |
| **Value Track** | Supporting work that enables Story completion |
| **Agent Scope** | Single agent, single session |

#### ✅ CREATE a Task WHEN:

```
□ Technical prerequisite for a Story (e.g., "Provision CI runner", "Update wrangler.toml")
□ Non-coding work (documentation, config changes, env setup)
□ Standalone operational item that doesn't fit a user story
□ Bug fix too small for a Story (use Subtask of a Bug Epic instead)
□ Depends on no other tickets (truly atomic)
```

#### ❌ DO NOT create a Task WHEN:

```
□ Has user-facing value → use Story
□ Part of a larger feature → nest as Subtask under Story
□ Requires multiple agents → escalate to Story with Subtasks
```

**Example (from KAN board):**
- ✅ `KAN-69` — Fix render.yaml Dockerfile path mismatch
- ✅ `KAN-71` — Design auto-generate Rust routing table

#### Task 5W1H Example

```markdown
## 5W1H — KAN-69: Fix render.yaml Dockerfile path mismatch

### WHO
- Assignee: node6 (quick on-machine fix)
- Reviewer: Hermes

### WHAT
- Edit `render.yaml` line 12: change `dockerfile: Dockerfile.dev` → `dockerfile: ./Dockerfile.prod`
- Verify build: `render build` passes

### WHEN
- Sprint: E (on-demand)
- Created: 2026-09-21 (incident-driven)
- Done: 2026-09-21 (same-day fix)

### WHERE
- Component: cloudflare, render.yaml
- Environment: production (immediate deploy after fix)
- Pipeline: build → deploy

### WHY
- Gap: Render deploy failed — path mismatch caused build error
- Expected: Deploy succeeds, Cloudflare Worker serves traffic
- Proof: `render status` shows healthy, /status endpoint returns 200
- Evidence: INC-20260921-001 (incident ticket)

### HOW
- Principles: Single-Agent Ownership, Reversible Changes
- Method: node6 edits config → Hermes reviews → merge → monitor
- Value: Uptime — production worker must stay healthy
```

---

### 1.4 SUBTASK ↳ (Atomic Execution Unit)

| Attribute | Specification |
|-----------|---------------|
| **What it is** | The smallest unit of work — single agent, single session, single outcome |
| **Timeframe** | 1–4 hours |
| **Value Track** | Completion contributes to parent Story/Task |
| **Agent Scope** | One agent, one spec, one deliverable |

#### ✅ CREATE a Subtask WHEN:

```
□ Parent Story/Task needs decomposition for parallel agent execution
□ Different agent specializations are needed (e.g., TDD test by agy1, implementation by codex2)
□ Work is atomic: one file, one test, one config change, one review
□ Clear "definition of done" in ≤100 words
```

#### ❌ DO NOT create a Subtask WHEN:

```
□ No parent Story/Task exists → orphan Subtask is a governance violation
□ Cannot be completed in a single agent session → split further
□ Touches >3 files or >2 subsystems → promote to Task
```

**Example (from KAN board):**
- ✅ `KAN-102` — I1: Skill audit — review 146 skills
- ✅ `KAN-103` — I2: Budget enforcement
- ✅ `KAN-108` — FIX: 29 skills with broken file references

#### Subtask 5W1H Example

```markdown
## 5W1H — KAN-108: FIX: 29 skills with broken file references

### WHO
- Assignee: agy3 (developer_core, skills specialist)
- Reviewer: Hermes

### WHAT
- Loop through 29 skills flagged by audit
- For each: check file_path exists, if broken → fix or remove_file
- Run `hermes skill audit` after fix

### WHEN
- Sprint: G
- Start: 2026-09-23 (after Sprint Planning)
- Done: 2026-09-24 (same-day or next-day)

### WHERE
- Component: skills/ (~/.hermes/skills/)
- Environment: local (skills are local config)
- Pipeline: test (skill audit passes)

### WHY
- Gap: 29/146 skills มี broken file references → agent crashes when loading
- Expected: 0 broken references
- Proof: `hermes skill audit` shows 0 broken refs
- Evidence: HOROC-AUDIT-2026-SKILLS, KAN-86 Epic

### HOW
- Principles: TDD (write test first → RED → fix → GREEN), Single-Agent Ownership
- Method: agy3 loops through list → fixes references → Hermes verifies
- Value: Agent reliability — broken references = runtime failures
```

---

## 2. DEFECT / ISSUE — SPECIAL HANDLING

### Defect → Level Decision Tree

```
Defect เข้ามา
│
├─ Production Down (ระบบลม)?
│   └─ YES → ⚡ HOTFIX TASK (ผ่านไปได้)
│            └── ภายหลัง: สร้าง Incident Epic ย้อนหลัง
│
├─ มาจาก Audit Finding (e.g., HOROC Audit)?
│   └─ ถ้าเป็นกลุ่ม → EPIC (KAN-38) → Story → Subtask=Defect fix
│   └─ ถ้าเป็นรายการเดี่ยว → Subtask ภายใต้ Story ที่อยู่แล้ว
│
├─ มาจาก Red Team Test (adversarial found)?
│   └─ เป็น Subtask ของ Red Team Story นั้น
│
├─ มาจาก CI/CD (flaky test, build fail)?
│   └─ ถ้าแก้เล็ก (<4h) → SUBTASK
│   └─ ถ้าแก้ใหญ่ (infra change) → TASK → มี Subtasks
│
└─ มาจาก User Report (bug report)?
    └─ Severity Critical/High → STORY (ต้อง TDD ทันที)
    └─ Severity Low/Medium → Subtask ภายใต้ Maintenance Story
```

### Defect Level Summary

| ที่มา / ประเภท | ใส่ระดับ | เหตุผล |
|----------------|---------|--------|
| **Production Hotfix** | Task 📋 (ผ่านไปได้) | ต้องแก้เร็ว ไม่ต้อง Epic งานชั่วข้ามคืน |
| **Audit Finding (หลายรายการ)** | Epic 💎 | ต้องจัดการเป็น campaign |
| **Audit Finding (รายการเดียว)** | Subtask ↳ | จัดการจบภายใต้ Story ของ Sprint นั้น |
| **Red Team / Adversarial** | Subtask ↳ | เป็นทดสอบใต้ Story ทีมแดง |
| **Flaky Test / Build Fail** | Subtask หรือ Task | ขึ้นกับขนาด — เล็กกว่า 4 ชม. เป็น Subtask |
| **Bug Report (Critical)** | Story 🔲 | ต้อง TDD RED→GREEN ใหม่ทั้งหมด |
| **Bug Report (Low)** | Subtask ↳ | เอาไว้ใน Maintenance Story รายสัปดาห์ |
| **Regression from PR** | Subtask (ใต้ Story ที่ merge) | เอากลับไปแก้ใน Story เดิม |

### Defect Template (พร้อม 5W1H)

```markdown
## Defect Report — KAN-<ID>

### WHO
- Assignee: agent-<role> (ผู้แก้)
- Reporter: <who found it>
- Reviewer: agent-<role> (ผู้ review)

### WHAT — Repeatable Steps
1. Reproduce: <steps to trigger defect>
2. Root cause: <what's broken>
3. Fix: <what to change>
4. Test: <how to verify fix>

### WHEN — Agile Heartbeat
- Discovered: <date/time>
- Sprint: <current sprint>
- Target fix: <deadline based on severity>
  - Critical: 4 hours
  - High: 24 hours
  - Medium: This sprint
  - Low: Next sprint

### WHERE — Context
- Component: <affected subsystem>
- Environment: <production | staging | local>
- Pipeline Stage: <build | deploy | monitor | test>

### WHY — Gap & Evidence
- Expected: <what should happen>
- Actual: <what happened instead>
- Severity: <Critical | High | Medium | Low>
- Impact: <who/what is affected>
- Evidence: <logs, screenshots, error messages>

### HOW — Fix Strategy
- Approach: <hotfix | TDD cycle | config change | rollback>
- Rollback plan: <how to undo if fix fails>
- Prevention: <how to prevent recurrence — new test? governance rule?>
```

### Defect Governance Rules

1. **ทุก Defect ต้องระบุ `Source`** — Audit, Red Team, User Report, CI/CD, Production Incident
2. **ทุก Defect ต้องมี `Root Cause`** — ถ้าไม่รู้ให้สร้าง Research Story ก่อนแก้
3. **Severity กำหนง SLA** — Critical 4 ชม., High 24 ชม., Medium this sprint, Low next sprint
4. **Hotfix ข้าม Story ได้** แต่ต้องมี Incident Epic หลังแก้เสร็จ
5. **Recurring Defect (3+ ครั้ง)** → เลื่อนเป็น Epic (Recurrent Bug Pattern)

---

## 3. DECISION TREE — "WHAT SHOULD I CREATE?"

```
START: New work request arrives
│
├─ Is it a defect/issue?
│   └─ YES → Defect Decision Tree (Section 2)
│   └─ NO → Continue ↓
│
├─ Does it span ≥3 sprints OR involve ≥3 agents?
│   ├─ YES → 🎯 EPIC 💎
│   │        └─ Break into Stories (P0→P3), assign to Sprint
│   └─ NO → Continue ↓
│
├─ Does it deliver user/agent value AND fit in 1 sprint?
│   ├─ YES → 📦 STORY/FEATURE 🔲
│   │         └─ Break into Subtasks (TDD: RED test + GREEN impl + REFACTOR)
│   └─ NO → Continue ↓
│
├─ Is it a technical prerequisite or operational action?
│   ├─ YES → 🔧 TASK 📋
│   │         └─ May have Subtasks if multi-step
│   └─ NO → Continue ↓
│
├─ Is there unresolved unknown / research gap?
│   ├─ YES → 🔬 RESEARCH STORY (Spike: <hypothesis>)
│   │         └─ Outcome: knowledge ticket OR promotion to Story
│   └─ NO → Continue ↓
│
└─ Is it a quick fix (<4 hours, single agent, single file)?
    └─ YES → ⚡ SUBTASK ↳ (attach to parent Story)
```

---

## 4. SPECIALIST TEAM MAPPING (Hermes Agent Coordination)

Per the Atlassian specialist agent model and Hermes multi-agent orchestration:

### Agent Roles & Ticket Ownership Matrix

| Agent / Role | Best For | Ticket Level | Label |
|-------------|----------|-------------|-------|
| **Hermes** (Orchestrator) | Planning, delegation, cross-agent coordination | Epic / Story creation | `agent-hermes` |
| **agy1-4** (AGY CLI agents) | Implementation, TDD cycles, parallel execution | Story / Subtask | `agent-agyN` |
| **codex1-3** (Codex CLI agents) | Complex refactors, multi-file changes, architecture | Story / Task | `agent-codexN` |
| **node6** (Local LLM) | Quick tasks, on-machine ops, OVMS inference | Task / Subtask | `agent-node6` |
| **gemini MCP** | Architecture review, research, SDLC planning | Story (Review/Research) | `agent-gemini` |
| **Red Team** | Adversarial testing, failure injection | Subtask (test creation) | `agent-redteam` |
| **Blue Team** | Security scan, hygiene validation | Subtask (scan/gate) | `agent-blueteam` |

### Coordination Rules (from Atlassian Multi-Agent Pattern):
1. **Anchor to Jira:** Every unit of work = one ticket. Issue links = dependency graph.
2. **Daemon watches:** Hermes polls for `Ready` tickets with all blockers `Done` → assigns to agent.
3. **Persona binding:** Each agent gets ticket description + acceptance criteria ONLY (no context drift).
4. **Lock on start:** Ticket moves `Ready` → `In Progress` atomically (prevents split-brain).
5. **Hand-off cleanly:** PR opens, reviewer assigned, ticket transitions to `Review` → human/agent approval.

---

## 5. 🔴 RED TEAM — ADVERSARIAL VALIDATION (Offensive Gates)

> **Goal:** Find failure modes BEFORE they manifest in production.

### 5.1 EPIC-Level Attacks

| Threat | Detection | Mitigation |
|--------|-----------|------------|
| **Epic Scope Creep** | Epic has >10 Stories OR Stories span >3 sprints each | Split Epic into 2; assign separate owners |
| **Orphan Epic** | Epic exists with 0 Stories for >1 sprint | Auto-close or convert to Initiative |
| **Epic Collision** | Two Epics modify the same subsystem without explicit dependency link | Force issue link: "relates to" or "blocks" |
| **Priority Inversion** | P3 Epic with P0 Stories inside | Re-prioritize or restructure |

### 5.2 STORY-Level Attacks

| Threat | Detection | Mitigation |
|--------|-----------|------------|
| **Story Too Large** | >5 Subtasks OR estimated >1 sprint | Split Story using SPIDR method (Spikes, Paths, Interfaces, Data, Reports) |
| **INVEST Violation** | Story is not Independent, not Testable, or not Small | Re-write or decompose |
| **Split-Brain Assignment** | Story has no `agent-<role>` label | Reject creation — label is mandatory |
| **TDD Bypass** | Story enters "In Progress" without RED test commit | Enforce via branch protection + pre-commit hook |
| **Missing Acceptance Criteria** | Story description has no "Given/When/Then" or checklist | Block transition from `Ready` → `In Progress` |

### 5.3 TASK / SUBTASK-Level Attacks

| Threat | Detection | Mitigation |
|--------|-----------|------------|
| **Orphan Subtask** | Subtask with no parent Story/Task | Governance violation — auto-quarantine |
| **Queue Overflow** | Single Story has >8 Subtasks | Split Story into 2 Stories under same Epic |
| **Agent Impersonation** | Subtask assignee doesn't match label (e.g., `agent-codex1` but assignee is agy2) | Require assignee ∈ label set |
| **Stale In-Progress** | Subtask in `In Progress` for >24h with no commit | Alert Hermes for health-check |

### 5.4 Red Team Decision Gate

```
Before ANY Epic/Story is created:
├── Could this be split further? (SPIDR test)
├── Does it have a clear adversary/failure mode?
├── Is the blast radius contained to 1 sprint?
└── Is the rollback plan documented in the description?
```

---

## 6. 🔵 BLUE TEAM — DEFENSIVE VALIDATION (Hygiene & Security Gates)

> **Goal:** Enforce zero-trace governance, prevent secret exposure, maintain audit trail.

### 6.1 EPIC-Level Guards

| Rule | Enforcement |
|------|-------------|
| **Zero-Token-Leak (GUARDRAILS G1)** | Epic description MUST NOT contain API keys, tokens, passwords. Reference Doppler secrets only. |
| **Branch Strategy Declared** | Every Epic must specify: trunk-based vs feature-branch, merge strategy |
| **Audit Trail Required** | Epic must link to originating Jira audit finding, Confluence doc, or RFC |

### 6.2 STORY-Level Guards

| Rule | Enforcement |
|------|-------------|
| **TDD Gate** | Story cannot leave `TDD RED` without a failing test committed |
| **Blue Team Review** | Story touching production infra requires `agent-blueteam` Subtask for security scan |
| **Dependency Declaration** | All upstream services (Cloudflare, OVMS, Gemini API) must be listed in description |
| **Secret Hygiene** | No `process.env` literals in commit — use `DOPPLER_PROJECT.secret_name` reference |

### 6.3 TASK / SUBTASK-Level Guards

| Rule | Enforcement |
|------|-------------|
| **Pre-Commit Hooks** | `gitleaks` scan runs on every commit — reject if secret pattern detected |
| **Protected Files** | Subtask touching `.env`, `wrangler.toml`, `manifest.json` requires Blue Team review |
| **Label Hygiene** | Every Subtask must have: `agent-<role>` + `sprint-<letter>` + `priority-P<N>` labels |
| **Merge Gate** | Subtask cannot merge unless parent Story status is `TDD GREEN` or `Review` |

### 6.4 Blue Team Decision Gate

```
Before ANY ticket is created:
├── Does description contain any secret pattern? (regex: /[A-Za-z0-9+/]{40,}/)
├── Is the assignee's agent role appropriate for the scope?
├── Are all labels applied? (agent, sprint, priority, team)
├── Is there a corresponding test plan for implementation tickets?
└── Is the rollback/reversal path documented?
```

---

## 7. 🔬 RESEARCH TEAM — EXPLORATION & KNOWLEDGE GAPS

> **Goal:** Convert unknowns into actionable knowledge; prevent "vibes-based" architecture.

### 7.1 When to Create a Research Story

| Trigger | Research Story Title Pattern |
|---------|------------------------------|
| New technology evaluation | `Research: <tech> for <use-case> — feasibility & tradeoffs` |
| Architecture decision needed | `Research: <pattern A> vs <pattern B> — selection & rationale` |
| Performance baseline missing | `Research: <system> load test — establish SLI/SLO` |
| Security audit gap | `Research: <component> threat model — attack surface analysis` |
| Benchmark/comparison | `Research: <model A> vs <model B> — <metric> comparison` |

### 7.2 Research Story Structure

```
Research: <Hypothesis or Question>

## Context
- What we know:
- What we don't know:
- Why it matters now:

## Method
- [ ] Literature review (arXiv, blog posts, docs)
- [ ] Spike implementation (throwaway prototype)
- [ ] A/B test design
- [ ] Expert consultation (gemini MCP, architect agent)

## Acceptance Criteria
- [ ] Decision matrix with ≥3 options evaluated
- [ ] Recommendation with pros/cons documented
- [ ] Linked follow-up Story/Epic created if research passes gate

## Outcome
- ✅ PROMOTE → Create Epic/Story from findings
- ❌ KEEP → Park in "Research Backlog" for future sprint
- 🗑️ CLOSE → Finding: not viable, document rationale
```

### 7.3 Research → Implementation Hand-off

```
Research Story DONE
       │
       ├─ Findings positive?
       │   ├─ YES → Create Epic/Story with research link as parent
       │   └─ NO → Close with "rationale" comment, link to killed Epic (if any)
       │
       └─ Unresolved unknowns remain?
           ├─ YES → Create follow-up Research Story (deeper dive)
           └─ NO → Proceed to TDD RED
```

---

## 8. COMPLETE TICKET LIFECYCLE STATE MACHINE

```
  ┌─────────────────────────────────────────────────────────────────┐
  │                                                                 │
  │   [Created] → Ready → TDD RED → TDD GREEN → Review → Done      │
  │                 │         │          │         │        │       │
  │                 │         │          │         │        │       │
  │           ┌─────┘         │          │         │        │       │
  │           │               │          │         │        │       │
  │        Blocked      Test fails   PR open   Merged    Archived   │
  │           │           (loop)        │         │                 │
  │           │               │          │         │                 │
  │           └───────────────┴──────────┴─────────┘                 │
  │                                                                 │
  └─────────────────────────────────────────────────────────────────┘
```

### State Definitions:

| State | Meaning | Exit Criteria |
|-------|---------|---------------|
| **Created** | Ticket exists, not yet refined | 5W1H complete + Acceptance criteria + Subtasks defined |
| **Ready** | Refined, blockers resolved, agent-assigned | Agent picks up → moves to TDD RED |
| **TDD RED** | Failing test written, not yet passing | Test committed, CI shows RED |
| **TDD GREEN** | Test passes, implementation complete | CI shows GREEN, PR opened |
| **Review** | Code review in progress (agent or human) | Approved + Blue Team scan clean |
| **Done** | Merged, deployed, release notes updated | Production healthy, monitoring green |
| **Blocked** | External dependency not yet satisfied | Dependency resolved → back to Ready |

---

## 9. JIRA AUTOMATION RULES (Recommended)

| Trigger | Condition | Action |
|---------|-----------|--------|
| Epic created | No Stories linked after 7 days | Alert Hermes: "Orphan Epic detected" |
| Story moved to `In Progress` | No `agent-<role>` label | Block transition: "Label required" |
| Subtask created | No parent Story/Task | Auto-reject: "Orphan Subtask" |
| PR opened | Linked ticket in `TDD RED` | Move ticket to `Review` |
| CI fails | Ticket in `TDD GREEN` | Move back to `TDD RED`, alert assignee |
| Ticket stale >48h | Status unchanged | Ping agent, escalate to Hermes |
| Blue Team Subtask | Missing `agent-blueteam` label | Block merge until resolved |

---

## 10. QUICK REFERENCE — "CHEAT SHEET"

```
┌─────────────┬────────────────┬─────────────┬──────────────┬─────────────┐
│ Level       │ Timeframe      │ Owner       │ Has Children │ Label Req.  │
├─────────────┼────────────────┼─────────────┼──────────────┼─────────────┤
│ Epic 💎     │ 2-12 weeks     │ Hermes      │ Stories ≥3   │ campaign-*  │
│ Story 🔲    │ 1 sprint       │ Agent       │ Subtasks ≥2  │ sprint-*    │
│ Task 📋     │ 1-3 days       │ Agent       │ Subtasks 0+  │ type-*      │
│ Subtask ↳   │ 1-4 hours      │ Agent       │ None         │ agent-*     │
└─────────────┴────────────────┴─────────────┴──────────────┴─────────────┘
```

---

## 11. EXCEPTIONS & ESCALATION

| Scenario | Handling |
|----------|----------|
| Hotfix needed (production down) | Create Task directly under Incident Epic, skip Story layer |
| Agent disagreement on decomposition | Hermes arbitrates; decision logged in Epic comment |
| Research Story exceeds 1 sprint | Promote to Epic with phased Research Stories |
| External dependency (vendor, API) | Create `Blocked` Task, link to Epic, set reminder |
| More than 10 Subtasks under one Story | Mandatory split — escalate to Hermes for restructuring |

---

## 12. COMPLIANCE & AUDIT

Every Epic/Story creation must satisfy:

```
□ 5W1H complete (Who, What, When, Where, Why, How)
□ Level-appropriate timeframe
□ At least 1 child (Epic→Stories, Story→Subtasks)
□ Acceptance criteria present
□ Agent role label attached
□ Sprint tag assigned (Stories and below)
□ TDD gate acknowledged (implementation tickets)
□ No plaintext secrets in description
□ Rollback plan documented (Epic-level)
□ Research gap identified OR explicitly stated as "none"
```

---

*This document is the single source of truth for ticket hierarchy governance. Propose changes via Research Story → Hermes review → Blue Team validation → merge into this file.*
