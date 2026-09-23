# 🔍 ORCHESTRATOR AUDIT — GOVERNANCE_TICKET_HIERARCHY.md Enforcement Assessment

**Audited:** 2026-09-23 | **Auditor:** Hermes Subagent (Orchestrator Audit)  
**Scope:** `/Users/kimlenglim/Project/aipass-web-bridge/GOVERNANCE_TICKET_HIERARCHY.md` (43KB, 923 lines)

---

## Executive Summary

| Dimension | Rating | Notes |
|-----------|--------|-------|
| 5W1H Enforcement | 🔴 **NOT ENFORCED** | Template defined, zero validation hooks |
| Atomic Execution | 🔴 **NOT ENFORCED** | Definition exists, no check mechanism |
| TDD Lifecycle | 🟡 **PARTIAL** | Hooks exist for Jira key + secrets, no TDD phase labels |
| Jira Board Monitoring | 🔴 **NOT ENFORCED** | No cron for orphan/stale/priority-inversion detection |
| Blue Team Gates | 🟡 **PARTIAL** | Secret scan hook exists, no gitleaks integration, no Blue Team Subtask automation |
| Red Team Gates | 🗙 **NOT ENFORCED** | Adversarial checks documented, zero automation |
| Quality Gate Script | 🔴 **STUB ONLY** | `jira_quality_gate.py` is a TODO stub |

**Verdict:** Governance is currently **documentation-only**. Without hooks, cron, and script implementation, it cannot enforce the rules it defines.

---

## 1. 5W1H Framework — Gap Analysis

### What the Document Requires
> "Every ticket — from Epic to Subtask — MUST be documented with these six dimensions. A ticket missing any W/H is a governance violation and cannot leave the `Created` state."

### What's Actually Enforced
| W/H | Required Check | Exists? | Implementation |
|-----|---------------|---------|----------------|
| WHO | Assignee present, Reviewer ≠ Assignee | ❌ No | No hook validates assignee/reviewer |
| WHAT | Playbook checklist in description | ❌ No | No parsing of description for playbook steps |
| WHEN | Sprint tag, deadline field | ❌ No | No sprint tag enforcement |
| WHERE | Component, Environment fields | ❌ No | No component validation |
| WHY | Gap analysis + Evidence sources | ❌ No | No template enforcement on description |
| HOW | Principles + Rollback plan | ❌ No | No rollback plan check |

### What Hermes Must Add

#### 1a. Jira Create-Hook (Pre-Create Validation)
```bash
# scripts/hooks/jira-validate-5w1h.sh
# Called by Hermes before mcp__atlassian__createJiraIssue
# Parses ADF description for ## WHO, ## WHAT, ## WHEN, ## WHERE, ## WHY, ## HOW headings
# Rejects creation if any section is missing or empty
```

#### 1b. 5W1H Compliance Cron (Every 30 min)
```python
# Cron: "governance-5w1h-audit"
# Query: project = KAN AND status != Done AND created > -7d
# For each issue: check description contains all 6 headings
# If missing: add comment "⚠️ 5W1H VIOLATION: Missing [WHO/WHAT/etc]"
# Transition to "Created" if in "Ready" with incomplete 5W1H
```

#### 1c. Epic-Level Additional Checks
- ✅ Epic must have ≥3 Stories linked within 7 days → **Jira Automation** (documented, not created)
- ✅ Story must have ≥2 Subtasks → **Pre-transition hook** (doesn't exist)
- ✅ Rollback plan for Epic-level → **Description field check** (not implemented)

---

## 2. Atomic Execution — Gap Analysis

### What the Document Requires
> "Subtask = single agent, single session, single outcome. ≤100 words description. Completed in 1–4 hours. Commit message MUST reference Subtask ID."

### What's Actually Enforced

| Rule | Status | Notes |
|------|--------|-------|
| Commit references Subtask ID | 🟡 Partial | commit-msg hook validates `[A-Z]+-[0-9]+` format but doesn't verify issue exists or is valid subtask |
| ≤100 words description | ❌ No | No length check |
| Single agent per subtask | ❌ No | No assignee uniqueness check |
| 1–4 hour completion SLA | ❌ No | No time-in-status monitoring |
| No parent = orphan violation | ❌ No | No orphan detection |
| >3 files → promote to Task | ❌ No | No file count check on subtask scope |

### What Hermes Must Add

#### 2a. Subtask Description Validator (Pre-Create)
```python
# scripts/jira_validate_subtask.py
# - Word count ≤ 100
# - Must have parent Story/Task (Jira enforces this, but custom check for "Task-type parent")
# - Assignee must match agent-<role> label pattern
# - Reject if parent status is Done/Closed
```

#### 2b. Stale Subtask Detection Cron (Every 15 min)
```python
# Cron: "subtask-stale-detector"
# Query: project = KAN AND issuetype = Subtask AND status = "In Progress" AND updated < -24h
# Action: 
#   - Ping assignee via Telegram/Slack
#   - Escalate to Hermes if no response in 4h
#   - Auto-transition to "Blocked" after 48h stale
```

#### 2c. Scope Creep Detector (Post-Commit)
```python
# Pre-push hook enhancement
# - Count files changed in PR linked to subtask
# - If >3 files: warn "Subtask scope exceeded — consider promoting to Task"
# - If >2 subsystems (path-based): flag for review
```

---

## 3. TDD Lifecycle — Gap Analysis

### What the Document Requires
> "TDD RED → GREEN → REFACTOR. Story cannot leave TDD RED without failing test committed. Labels: tdd-red, tdd-green, tdd-review, tdd-complete."

### What's Actually Enforced

| Rule | Status | Notes |
|------|--------|-------|
| TDD labels (tdd-red/green/review/complete) | ❌ No | No hook checks for these labels |
| Story cannot enter In Progress without RED test | ❌ No | commit-msg hook only checks Jira key, not TDD phase |
| CI RED→GREEN state machine | ❌ No | No integration with CI status in Jira transitions |
| Refactor commit allowed only after GREEN | ❌ No | No phase-gate logic |
| PR opens → ticket to Review | ❌ No | Jira automation documented but not created |

### What Hermes Must Add

#### 3a. TDD Phase Label Hook (Pre-Transition)
```bash
# scripts/hooks/jira-tdd-gate.sh
# Before transition to "In Progress": require label tdd-red
# Before transition to "TDD GREEN": require CI green webhook confirmation
# Before transition to "Review": require PR opened (check remotelink)
# Before transition to "Done": require label tdd-complete + Blue Team clean
```

#### 3b. CI/Jira Integration (Webhook Receiver)
```python
# scripts/ci_webhook_handler.py
# Listens for GitHub Actions webhooks
# On CI failure in "TDD GREEN" → move back to "TDD RED", alert assignee
# On CI pass in "TDD RED" → add label tdd-green candidate
# On PR opened → transition linked ticket to "Review"
```

#### 3c. TDD Compliance Cron
```python
# Cron: "tdd-phase-audit"
# Query: labels in (tdd-red, tdd-green) AND status = "In Progress" AND updated < -4h
# Action: ping agent — "TDD phase stale, please update"
```

---

## 4. Jira Board Monitoring — Gap Analysis

### What the Document Requires
> "Hermes monitors high-level board for: orphan Epics, queue overflow, priority inversion, stale items, INVEST violations, agent impersonation."

### What's Actually Enforced
**Zero automated monitoring.** No cron jobs, no Jira automations, no webhook receivers.

### What Hermes Must Add

#### 4a. Governance Dashboard Cron (Every 30 min)
```python
# Cron: "governance-board-monitor"
# 
# Query 1 — Orphan Epics:
#   issuetype = Epic AND status != Done AND created < -7d AND NOT (issuetype = Story AND "Epic Link" = Epic)
#   Action: comment on Epic, alert Hermes
#
# Query 2 — Queue Overflow:
#   issuetype = Story AND subtasks > 8
#   Action: flag for Hermes decomposition
#
# Query 3 — Priority Inversion:
#   issuetype = Epic AND priority = P3 AND subtasks with priority = P0
#   Action: alert to re-prioritize
#
# Query 4 — Stale In-Progress:
#   status = "In Progress" AND updated < -48h
#   Action: ping assignee, escalate
#
# Query 5 — Agent Impersonation:
#   assignee != agent-<role> label owner
#   Action: block transition, require correction
```

#### 4b. Jira Automation Rules (Manual Setup Required)
The document lists 7 automation rules in Section 9 — **none are created**:
1. Epic orphan alert (7 days no stories)
2. Story label required for In Progress
3. Subtask orphan rejection
4. PR→Review transition
5. CI fail→TDD RED
6. Stale ticket ping
7. Blue Team label merge gate

**Action:** Hermes must create these via `mcp__atlassian__` REST API or manual Jira UI.

#### 4c. INVEST Compliance Checker (Post-Create Story)
```python
# scripts/jira_invest_check.py
# For each new Story:
#   - Independent: no "is blocked by" links required
#   - Negotiable: acceptance criteria not marked final
#   - Valuable: has "so that [value]" clause
#   - Estimable: story points or T-shirt size present
#   - Small: estimated ≤ 1 sprint
#   - Testable: has Given/When/Then acceptance criteria
# Score 0-6; <4 = flag for lead_ba review
```

---

## 5. Blue Team Gates — Gap Analysis

### What's Enforced Now
- ✅ Pre-commit hook: secret scan (basic regex patterns, not gitleaks)
- ✅ Pre-push hook: npm test, untracked secret file check
- ✅ AGENTS.md: references TDD, Blue Team, Red Team governance

### What's Missing
| Rule | Status | Notes |
|------|--------|-------|
| gitleaks integration | ❌ No | Hook uses basic regex, not industry-standard gitleaks |
| `.env`/`wrangler.toml` protected file review | ❌ No | No Blue Team Subtask auto-creation |
| Doppler secret reference enforcement | ❌ No | No check for `process.env` literals |
| Blue Team Subtask auto-creation for prod changes | ❌ No | Documented but not automated |
| `agent-blueteam` label gate on merge | ❌ No | Documented, no hook |

### What Hermes Must Add

#### 5a. Enhanced Pre-Commit with Gitleaks
```bash
# scripts/hooks/pre-commit-enhanced.sh
# Install gitleaks: brew install gitleaks
# Run: gitleaks protect --staged
# Reject commit if any finding >0
```

#### 5b. Protected File Watcher
```bash
# In pre-commit hook:
# if git diff --cached --name-only | grep -qE '(\.env|wrangler\.toml|manifest\.json|secrets?)'; then
#   echo "⚠️ Protected file changed — requires Blue Team review Subtask"
#   echo "Create KAN-XXX with agent-blueteam label before committing"
#   exit 1
# fi
```

#### 5c. Blue Team Subtask Auto-Creation Cron
```python
# Cron: "blueteam-scan-monitor"
# Detect Stories with Environment: production
# Verify agent-blueteam Subtask exists
# If missing: create Subtask "Blue Team Security Scan" and assign to agent-blueteam
```

---

## 6. Red Team Gates — Gap Analysis

### What's Documented
- Epic scope creep detection (>10 Stories, >3 sprints each)
- Story size attack (>5 Subtasks, >1 sprint)
- INVEST violation detection
- Agent impersonation check
- Stale In-Progress detection (>24h)

### What's Enforced
**None.** Zero automation.

### What Hermes Must Add

#### 6a. Red Team Decomposition Review Cron
```python
# Cron: "redteam-decomp-check"
# Query: issuetype = Epic AND Stories > 10
# Action: comment "Scope creep detected — split Epic"
#
# Query: issuetype = Story AND Subtasks > 5 AND status != Done
# Action: flag for SPIDR split review
```

#### 6b. Post-Creation Adversarial Check
```python
# scripts/redteam_new_ticket.py
# Run after every Epic/Story creation:
# - Could this be split further? (SPIDR test)
# - Does it have clear failure mode?
# - Is blast radius contained to 1 sprint?
# - Is rollback plan documented?
# Output: risk score 0-10, append to ticket comment
```

---

## 7. Critical Tooling Gaps

### 7a. `jira_quality_gate.py` — STUB
```
Current: "# TODO: Implement jira_quality_gate.py"
Required: Full CLI with --check, --issue, audit modes
Must implement:
  - TDD phase label verification
  - Agent label presence check
  - Acceptance criteria parsing (numbered list evidence)
  - Cross-agent sign-off verification
  - Jira API retry logic (429/503)
```

### 7b. `jira_label_gate.py` — DOES NOT EXIST
Referenced in `governance-hooks.md` but **file not found**:
```
scripts/jira_label_gate.py audit   — full-board sweep
scripts/jira_label_gate.py check KAN-XX — single issue
```
Must implement: label taxonomy validation, agent-* label enforcement, bulk remediation.

### 7c. Pre-Dispatch Hook — NOT IMPLEMENTED
Documented in `governance-hooks.md`:
```
"Parse goal/context for Jira ticket reference → verify exists → BLOCK dispatch if missing"
```
**Reality:** `delegate_task` has no built-in governance hook. Hermes must implement this as a wrapper.

### 7d. Post-Merge Verification — NOT IMPLEMENTED
Documented in `governance-hooks.md`:
```
"Verify Jira ticket transitions to Review/Done, fixVersion populated, remotelink present"
```
**Reality:** No pre-push or CI check does this.

---

## 8. Project Key Mismatch Issue

**Critical Finding:** The commit-msg hook validates `[A-Z]+-[0-9]+` pattern, but:
- **Governance doc** references `KAN-XX` (correct, KAN is the actual Jira project)
- **Hook doc** references `HERMES-123, AIPASS-456` in error messages
- **Some agent skills** reference `HEROC-AUDIT-2026-XX` format

**Action Required:** Standardize on `KAN-XX` and update all hook error messages.

---

## 9. Priority Action Plan

### Phase 1 — Stop the Bleeding (Week 1)
| # | Action | Effort | Impact |
|---|--------|--------|--------|
| 1 | Implement `jira_quality_gate.py` (TDD + label checks) | 4h | Blocks false Done transitions |
| 2 | Implement `jira_label_gate.py` (audit + check) | 2h | Enforces agent-* label mandate |
| 3 | Enhance commit-msg hook to validate KAN-XX exists via API | 2h | Prevents fake ticket references |
| 4 | Create 7 Jira automation rules (Section 9) | 3h | Orphan/stale detection |
| 5 | Standardize project key to KAN-XX everywhere | 1h | Eliminates confusion |

### Phase 2 — Governance Loop (Week 2)
| # | Action | Effort | Impact |
|---|--------|--------|--------|
| 6 | Implement 5W1H validation hook | 4h | Enforces template compliance |
| 7 | Add gitleaks to pre-commit | 1h | Real secret detection |
| 8 | Implement stale subtask detector cron | 2h | Prevents zombie work |
| 9 | Create Blue Team Subtask auto-creation | 2h | Security gate for prod |
| 10 | Add protected file watcher to pre-commit | 1h | Prevents secret file commits |

### Phase 3 — Red Team & Monitoring (Week 3-4)
| # | Action | Effort | Impact |
|---|--------|--------|--------|
| 11 | Implement Red Team decomposition review cron | 3h | Scope creep prevention |
| 12 | Create governance board monitor cron | 4h | High-level visibility |
| 13 | Build CI/Jira webhook integration | 4h | Automated TDD phase gates |
| 14 | Implement post-merge verification | 2h | Traceability completeness |
| 15 | Build INVEST compliance checker | 3h | Story quality gate |

---

## 10. Summary of What Hermes Must Build

### Hooks (Git-level enforcement)
1. ✅ `commit-msg` — exists, needs KAN-XX API validation enhancement
2. ✅ `pre-commit` — exists, needs gitleaks + protected file watcher
3. ✅ `pre-push` — exists, needs post-merge Jira verification
4. ❌ `jira-validate-5w1h.sh` — pre-create validation
5. ❌ `jira-tdd-gate.sh` — TDD phase label enforcement

### Cron Jobs (Hermes-level monitoring)
1. ❌ `governance-5w1h-audit` — every 30 min
2. ❌ `subtask-stale-detector` — every 15 min
3. ❌ `governance-board-monitor` — every 30 min
4. ❌ `tdd-phase-audit` — every 1h
5. ❌ `blueteam-scan-monitor` — every 2h
6. ❌ `redteam-decomp-check` — every 4h

### Python Scripts (Tooling)
1. ❌ `jira_quality_gate.py` — currently stub, must implement
2. ❌ `jira_label_gate.py` — referenced, must create
3. ❌ `jira_validate_subtask.py` — atomic execution validation
4. ❌ `jira_validate_5w1h.py` — template compliance
5. ❌ `redteam_new_ticket.py` — adversarial review on create
6. ❌ `ci_webhook_handler.py` — GitHub Actions ↔ Jira bridge

### Jira Automation (Board-level)
All 7 rules in Section 9 must be created manually or via API.

---

## Conclusion

The GOVERNANCE_TICKET_HIERARCHY.md is an **excellent governance specification** — comprehensive, well-structured, and operationally sound. However, it currently has **zero automated enforcement**. Every rule is a "MUST" with no mechanism to verify compliance.

**The document describes what a well-governed multi-agent team should look like. It does not make the team actually governed.**

To make this governance real, Hermes needs:
- **15 hooks/scripts** (6 new, 3 enhanced, 6 stubs to implement)
- **6 cron jobs** for continuous monitoring
- **7 Jira automation rules** for board-level gates
- **1 CI webhook receiver** for TDD phase automation

**Estimated total effort: ~40 hours** of focused implementation work.

Until then, compliance depends entirely on agents reading and voluntarily following the document — which is to say, it depends on nothing at all.
