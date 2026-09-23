# 📊 JIRA SPECIALIST AUDIT — GOVERNANCE_TICKET_HIERARCHY.md

**Audited File:** `/Users/kimlenglim/Project/aipass-web-bridge/GOVERNANCE_TICKET_HIERARCHY.md`  
**Jira Project:** KAN (Hermes Agent Team), Jira Cloud  
**Audit Date:** 2026-09-23  
**Auditor:** Hermes Jira Specialist Subagent

---

## 1. EXECUTIVE SUMMARY

The GOVERNANCE_TICKET_HIERARCHY.md is a **well-structured, comprehensive governance document** with strong alignment to Agile/Scrum best practices, particularly for multi-agent AI orchestration. However, several elements **conflict with hard Jira Cloud platform limits**, and some governance rules are **unenforceable through Jira's native capabilities**. This audit identifies gaps and provides actionable remediation paths.

**Overall Score: 7.5/10** — Strong conceptual design, moderate Jira compatibility risk, high enforcement overhead.

---

## 2. HIERARCHY ANALYSIS vs JIRA CLOUD LIMITS

### 2.1 Documented Hierarchy vs Jira Cloud Constraints

| Document Level | Jira Compatible? | Issue |
|---|---|---|
| **Initiative** (optional) | ⚠️ Conditional | Only available in **Jira Premium/Enterprise** (Advanced Roadmaps). Not available in Standard plan without Portfolio for Jira. |
| **Epic** | ✅ Yes | Standard issue type. Well-defined trigger conditions. |
| **Story / Feature** | ⚠️ Naming | "Feature" is NOT a standard Jira issue type — must be configured as custom issue type or use parent Epic link. |
| **Task** | ✅ Yes | Standard issue type. |
| **Subtask** | ✅ Yes | Standard issue type. |

### 2.2 🔴 CRITICAL: "Feature" as a Parallel Level to Story

The document defines `Story / Feature` as equivalent Level 2 types. In Jira:
- **Standard hierarchy** is: Epic → Story/Task → Subtask (3 levels below Epic)
- **Custom hierarchy** (Premium+) allows adding levels but each issue type maps to exactly ONE level
- **"Feature" is not a built-in Jira issue type** — it must be created as a custom issue type
- If both Story and Feature coexist at the same hierarchy level, this requires Premium tier AND explicit configuration

**Recommendation:** Either (a) merge Feature into Story scope with a `feature-*` label, or (b) confirm Jira Premium is active and "Feature" is registered as a custom issue type at Level 2.

### 2.3 🔴 CRITICAL: Custom Status Workflow (`TDD RED`, `TDD GREEN`)

The document mandates 6 custom statuses:
- `Created`, `Ready`, `TDD RED`, `TDD GREEN`, `Review`, `Done`, `Blocked`

**Jira Cloud limitation:**
- Maximum **10 statuses** per workflow (document uses 7, within limit)
- However, statuses like `TDD RED` and `TDD GREEN` are non-standard and require **custom workflow**
- Automation rules cannot natively "block transition" without add-ons or scriptrunner

**Gap:** Rule `PR opened → Move ticket to Review` conflicts with `TDD RED → TDD GREEN → Review` sequence. If PR opens during TDD RED, ticket would jump to Review without GREEN gate.

**Recommendation:** Add condition: `PR opened AND status = TDD GREEN → Move to Review`.

### 2.4 ⚠️ Queue Overflow Rule (>8 Subtasks → Split Story)

Jira has no hard limit on subtasks per parent. However:
- Performance degrades beyond ~50 subtasks (UI rendering, JQL queries)
- Board cards become unreadable with >10 subtasks
- The document's "8 Subtasks max" is a **good governance practice** but cannot be enforced natively

**Recommendation:** Keep as governance rule. Add Jira automation: "Story has >5 Subtasks created → Warning comment" (soft gate).

---

## 3. JIRA FIELD & CUSTOM FIELD ANALYSIS

### 3.1 Documented Custom Fields Required

| Field Name | Jira Cloud Limit Impact | Status |
|---|---|---|
| `Component/s` | Native field, no cost | ✅ OK |
| `Environment` | Native in JSM; custom in JSW | ⚠️ Must create as custom field if using Jira Software |
| `fixVersion/s` | Native field (versions), no cost | ✅ OK |
| `Squad` | Custom field — **consumes 1 of 700/space** | ⚠️ Acceptable if few fields |
| `Role` | Custom field — **consumes 1 of 700/space** | ⚠️ Acceptable |
| `Pipeline Stage` | Custom field — **consumes 1 of 700/space** | ⚠️ Acceptable |
| `Deployment Wave` | Custom field — **consumes 1 of 700/space** | ⚠️ Acceptable |
| `Sprint` | Native field, no cost | ✅ OK |

### 3.2 Field Consolidation Recommendation

The document uses **4+ custom fields** (Squad, Role, Pipeline Stage, Deployment Wave). With Jira's **700 fields per space limit** (enforced March 2026), this is sustainable for a small team but problematic at scale.

**Better approach:** Consolidate into a single **"Governance Context"** cascading select field or use **labels** for free-form tagging:
- Labels are unlimited and don't count toward field limits
- Replace `Squad: <name>` → `squad-<name>` label
- Replace `Pipeline Stage: <stage>` → `pipeline-<stage>` label
- Replace `Deployment Wave: <wave>` → `wave-<wave>` label

**Estimated field savings: 3 custom fields → 0** (use labels instead)

---

## 4. AUTOMATION RULES ANALYSIS

### 4.1 Recommended Rules vs Jira Cloud Limits

The document proposes 7 automation rules (Section 9):

| Rule | Jira Native? | Limit Risk |
|---|---|---|
| Epic → no Stories after 7 days → alert | ✅ Yes (scheduled trigger) | Low |
| Story moved to In Progress → no label → block | ⚠️ Partial (cannot block transitions natively) | Medium |
| Subtask → no parent → auto-reject | ❌ No (requires validator or Scriptrunner) | High |
| PR opened → TDD RED ticket → Review | ✅ Yes (trigger: Development) | Medium |
| CI fails → TDD GREEN → TDD RED | ✅ Yes (webhook trigger) | Medium |
| Ticket stale >48h → ping agent | ✅ Yes (scheduled JQL) | Low |
| Blue Team Subtask → missing label → block merge | ❌ No (requires branch protection, not automation) | High |

### 4.2 🔴 CRITICAL: Automation Execution Limits

**Jira Cloud Standard Plan: 1,700 rule executions/month per project**  
**Jira Cloud Free Plan: 500 rule executions/month per project**

Each rule can fire multiple times per issue. With 7+ rules and frequent triggers (PR events, CI events, status changes), **the Standard plan could hit limits** during busy sprints.

**Mitigation:**
- Use **single-project rules** (unlimited on Premium, cheaper billing)
- Consolidate multiple triggers into single rules with branching logic
- Replace "stale >48h" polling with **weekly** checks instead of daily
- Use **Jira's built-in board SLAs** instead of custom automation for stale detection

### 4.3 🔴 CRITICAL: "Block Transition" Not Natively Supported

Rules like:
- "Story moved to In Progress + no label → Block transition"
- "Subtask created + no parent → Auto-reject"

**Cannot be enforced** by Jira Automation alone. Requires:
- **Jira Misc Workflow Extensions (JMWE)** add-on
- **ScriptRunner for Jira** (paid app)
- Custom workflow validator via **Jira Connect** app

**Alternative:** Use **issue type screen schemes** to make fields mandatory, or enforce via pre-commit hooks in the repository.

---

## 5. DEFECT HANDLING — JIRA COMPATIBILITY

### 5.1 Defect Decision Tree — Well Designed ✅

The decision tree correctly maps:
- Production Hotfix → Task (bypass Story)
- Audit Finding batch → Epic
- Single Audit Finding → Subtask
- Bug Report Critical → Story (TDD required)
- Bug Report Low → Maintenance Story Subtask

**Jira compatibility:** ✅ All defect paths use standard issue types.

### 5.2 ⚠️ Bug/Defect Issue Type Missing from Hierarchy

The document mentions "Bug fix too small for a Story" and "Bug Report" but **does not define a standard "Bug" issue type** in the hierarchy table (Section 10 cheat sheet).

**Recommendation:** Add "Bug" as Level 2 (same as Story) or clarify that bugs use Story issue type with `type-bug` label.

---

## 6. SPECIALIST TEAM MAPPING — JIRA COMPATIBILITY

### 6.1 Agent Assignee Model

The document maps agents (agy1-4, codex1-3, node6, gemini MCP) to tickets via `Assignee` field.

**Jira Cloud limitation:** Assignee must be a **Jira user/license**. AI agents are not Jira users.

**Options:**
1. **Service account per agent** (consumes license seat — expensive)
2. **Single "Bot" service account** with labels indicating actual agent (recommended)
3. **Unassigned + label** (e.g., `agent-agy1` label, no Jira user)

**Recommendation:** Use **option 3** — Assignee = Hermes orchestrator account (1 license), labels = actual agent. This avoids license bloat and works within Jira's free tier.

### 6.2 Red/Blue Team Subtasks

The document correctly models Red Team (attack) and Blue Team (defense) as **Subtask issue types** with specialized labels (`agent-redteam`, `agent-blueteam`).

**Jira compatibility:** ✅ Fully compatible. Subtasks are the right pattern for internal verification steps.

---

## 7. RED TEAM & BLUE TEAM GATES — ENFORCEABILITY

### 7.1 Red Team Attack Matrix

Most Red Team checks are **process-based**, not automatable:
- "Epic Scope Creep: >10 Stories OR >3 sprints each" — requires manual audit
- "INVEST Violation" — subjective, not machine-checkable
- "Agent Impersonation: assignee ≠ label" — partially automatable

### 7.2 Blue Team Guards — Enforcement Gaps

| Rule | Enforceable? | Mechanism |
|---|---|---|
| Zero-Token-Leak in description | ⚠️ Partial | Gitleaks in CI, not Jira |
| Branch Strategy Declared | ❌ No | Documentation only |
| TDD Gate (no RED → no In Progress) | ❌ No | Cannot validate test state from Jira |
| Pre-Commit Hooks (gitleaks) | ✅ Yes | GitHub/GitLab CI (external to Jira) |
| Protected Files require Blue Team review | ✅ Yes | Branch protection rules (GitHub) |

**Key insight:** Most Blue Team guards are enforced in **CI/CD pipeline**, not Jira. This is correct architecture but the document should clarify that Jira is the **tracking layer**, not the **enforcement layer**.

---

## 8. TDD LIFECYCLE STATE MACHINE — JIRA WORKFLOW GAPS

### 8.1 Custom Statuses Required

Document defines: `Created → Ready → TDD RED → TDD GREEN → Review → Done (+ Blocked)`

**Issues:**
- Jira workflows require explicit transitions between all statuses
- `TDD RED` and `TDD GREEN` are domain-specific and may confuse non-technical stakeholders
- No "rollback" transition from `Review` → `TDD RED` (when review fails)

### 8.2 Missing Transition: Review → TDD GREEN (Re-work Loop)

The flow shows `Review → Merged` but real PRs often need re-work. Document should add:
- `Review → TDD GREEN` (changes requested, back to implementation)
- `Review → Done` (approved, merged, deployed)

### 8.3 Blocked State

Document lists `Blocked` as a state but doesn't define exit criteria clearly. Jira automation should auto-unblock when linked dependencies are resolved.

---

## 9. COMPLIANCE CHECKLIST — JIRA FIELD MAPPING

The Section 12 compliance checklist is excellent but requires field implementation:

| Compliance Check | Implementation |
|---|---|
| 5W1H complete | Manual (or custom field validation) |
| Level-appropriate timeframe | Manual |
| ≥1 child ticket | Automation: Epic with 0 Stories >7 days |
| Acceptance criteria present | Custom field "Acceptance Criteria" (textarea) |
| Agent role label | Native labels (free, unlimited) |
| Sprint tag | Native Sprint field |
| TDD gate acknowledged | Custom checkbox or label `tdd-acknowledged` |
| No plaintext secrets | External (CI gitleaks) |
| Rollback plan documented | Custom field "Rollback Plan" (required on Epics) |
| Research gap identified | Custom field or label |

---

## 10. JIRA CLOUD PLAN RECOMMENDATIONS

### For KAN Project (Multi-Agent Team), Recommended Tier:

| Plan | Suitability |
|---|---|
| **Free** | ❌ Insufficient (500 automations/month, no custom hierarchy) |
| **Standard** | ⚠️ Minimum viable (1,700 automations, limited hierarchy) |
| **Premium** | ✅ **Recommended** (unlimited project automations, custom hierarchy, Advanced Roadmaps) |
| **Enterprise** | Overkill unless compliance/audit requirements demand it |

### Cost-Benefit:
- **Premium** (~$12/user/month) enables:
  - Unlimited single-project automation rules
  - Custom hierarchy levels (Initiative tier)
  - Advanced Roadmaps for Epic planning
  - Audit logs for compliance

---

## 11. ACTIONABLE REMEDIATION ROADMAP

### 🔴 Critical (Must Fix Before Go-Live)

1. **Consolidate custom fields into labels**
   - Replace Squad, Pipeline Stage, Deployment Wave with labels
   - Saves 3 custom fields, reduces Jira admin overhead

2. **Resolve "Feature" issue type ambiguity**
   - Confirm Jira Premium + custom hierarchy configured, OR
   - Demote Feature to label (`feature-*`)

3. **Add "Bug" issue type to hierarchy**
   - Define Bug at Level 2 (Story equivalent) OR
   - Clarify bugs use Story type with `type-bug` label

4. **Fix TDD state machine transitions**
   - Add `Review → TDD GREEN` (re-work loop)
   - Add `Review → Done` (approval path)

### 🟡 Recommended (Should Fix)

5. **Automation limit mitigation**
   - Consolidate 7 rules into 3-4 rules with smart JQL
   - Reduce stale-check frequency from 48h to weekly
   - Use single-project rules only

6. **Agent license strategy**
   - Use 1 Jira user (Hermes bot account) for all agents
   - Distinguish agents via labels, not assignee

7. **Clarify enforcement layers**
   - Mark which rules are Jira-enforced vs CI-enforced
   - Move Blue Team gates to GitHub branch protection where possible

### 🟢 Nice-to-Have

8. **Add SLA automation**
   - Use Jira's built-in SLA timers for defect fix deadlines
   - Critical: 4h, High: 24h, Medium: this sprint

9. **Confluence integration**
   - The document mentions "Create Confluence page for Epic"
   - Automation: Epic created → Confluence page via blueprint

---

## 12. FINAL VERDICT

| Dimension | Score | Notes |
|---|---|---|
| **Hierarchy Design** | 8/10 | Excellent, but Feature/Bug ambiguity |
| **Jira Compatibility** | 6/10 | Custom statuses and "block transition" not native |
| **Automation Feasibility** | 6/10 | 2/7 rules require add-ons |
| **Scalability** | 7/10 | Label strategy saves field limits |
| **Multi-Agent Model** | 9/10 | Innovative use of labels for agent identity |
| **Defect Handling** | 9/10 | Well-structured decision tree |
| **Enforceability** | 5/10 | Many rules are process-only, not automatable |

**Overall: 7.5/10 — Production-ready with remediation items addressed.**

---

*Audit completed. Recommend addressing Critical items before KAN board enters active Sprint execution.*
