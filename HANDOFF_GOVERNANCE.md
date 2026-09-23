# 📋 HANDOFF — Jira Governance & Ticket Hierarchy Implementation

> **Created:** 2026-09-23 | **Repo:** `/Users/kimlenglim/Project/aipass-web-bridge`
> **Owner:** Hermes Agent | **Status:** ~70% complete — see remaining tasks below
> **Jira Project:** KAN (Hermes Agent Team) | **URL:** https://pansakorn.atlassian.net

---

## 📊 Current State Summary

### ✅ COMPLETED

| Item | File/Location | Status |
|------|---------------|--------|
| Governance framework document | `GOVERNANCE_TICKET_HIERARCHY.md` (43KB) | ✅ Written + audited by 5 teams |
| 5W1H commit-msg hook | `.git/hooks/commit-msg` | ✅ Installed |
| prepare-commit-msg (template injection) | `.git/hooks/prepare-commit-msg` | ✅ Installed |
| pre-commit (secret scan) | `.git/hooks/pre-commit` | ✅ Installed |
| pre-push (atomic gate) | `.git/hooks/pre-push` | ✅ Installed |
| post-commit (Jira comment sync) | `.git/hooks/post-commit` | ✅ Installed |
| Jira API client | `scripts/jira_api_helper.py` | ✅ Verified working |
| TDD gate script | `scripts/tdd_gate.py` | ✅ Written, needs testing |
| Atomic gate script | `scripts/atomic_gate.py` | ✅ Written, needs testing |
| Jira governance setup script | `scripts/jira_governance_setup.py` | ✅ Written, dry-run tested |
| Jira orchestrator monitor | `scripts/jira_orchestrator.py` | ✅ Verified working |
| GitHub Actions workflow | `.github/workflows/jira-sync.yml` | ✅ Written |
| Jira Automation config guide | `JIRA_AUTOMATION_RULES.md` | ✅ Written |

### ❌ REMAINING (Priority Order)

| # | Task | P | Effort | Details |
|---|------|---|--------|---------|
| 1 | Add GitHub Secrets | P0 | 5 min | `JIRA_BASE_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN` → Settings → Secrets → Actions |
| 2 | Run `jira_governance_setup.py` | P0 | 2 min | Creates TDD RED/GREEN/Review statuses + TDD Phase field |
| 3 | Configure Jira Automation Rules (6 rules) | P0 | 30 min | Manual UI — see `JIRA_AUTOMATION_RULES.md` |
| 4 | Install GitHub for Jira app | P0 | 10 min | Atlassian Marketplace → Connect GitHub account |
| 5 | Test 5W1H hooks end-to-end | P0 | 10 min | Create test commit, verify rejection/acceptance |
| 6 | Test TDD gate end-to-end | P0 | 15 min | Transition ticket to TDD RED, try non-test commit |
| 7 | Test atomic gate end-to-end | P0 | 10 min | Try 4-file push, verify rejection |
| 8 | Rotate JIRA_API_TOKEN | P0 | 5 min | Old token exposed in chat history |
| 9 | Add Branch Protection Rules | P1 | 15 min | Required reviews ≠ author, signed commits |
| 10 | Add Coverage Threshold | P1 | 10 min | CI fails if <80% |
| 11 | Create Jira Issue Templates | P1 | 20 min | Epic/Story/Subtask templates in Jira |
| 12 | Add DORA Metrics tracking | P2 | 2 hours | Deploy frequency, lead time, fail rate |
| 13 | Add WIP Limits per agent | P1 | 5 min | Max 2 In-Progress per agent |
| 14 | Add SAST (Semgrep) + DAST (ZAP) | P2 | 4 hours | Security scanning pipeline |
| 15 | Add SLO/SLI per component | P2 | 2 hours | Error budgets, reliability targets |

---

## 🏗️ Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        EVENT-DRIVEN GOVERNANCE                          │
│                        (No Hermes Cron Needed)                          │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  LOCAL GIT HOOKS                    GITHUB ACTIONS                      │
│  ────────────────                   ────────────────                    │
│  prepare-commit-msg ──→ Template    PR Opened ──→ Jira Review           │
│  pre-commit ──→ Secret scan         PR Merged ──→ Jira Done             │
│  commit-msg ──→ Jira key + 5W1H     Push ──→ TDD gate + Atomic gate     │
│  pre-push ──→ Atomic validation     CI Result ──→ TDD phase update      │
│  post-commit ──→ Jira comment                                            │
│                                                                         │
│  JIRA API (Verified Working)        JIRA AUTOMATION (Manual Setup)      │
│  ────────────────────────           ────────────────────────────        │
│  POST /search/jql (search)          Rule 1: PR Opened → Review          │
│  POST /issue/{id}/comment           Rule 2: PR Merged → Done            │
│  POST /issue/{id}/transitions       Rule 3: Branch Created → In Prog    │
│  GET /status (list statuses)        Rule 4: CI Failed → TDD RED         │
│  POST /status (create status)       Rule 5: Orphan Epic (daily)         │
│  POST /field (create field)         Rule 6: Stale Alert (4h)            │
│                                                                         │
│  ORCHESTRATOR MONITOR                                                   │
│  ────────────────────                                                   │
│  python3 scripts/jira_orchestrator.py --full-board                      │
│  python3 scripts/jira_orchestrator.py --recommend                       │
│  python3 scripts/jira_orchestrator.py --stale-only                      │
│  python3 scripts/jira_orchestrator.py --tdd-dist                        │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 📂 File Inventory

```
aipass-web-bridge/
├── GOVERNANCE_TICKET_HIERARCHY.md    ← Master governance document (43KB)
├── JIRA_AUTOMATION_RULES.md          ← UI setup guide for automation rules
├── .github/
│   └── workflows/
│       └── jira-sync.yml             ← GitHub Actions (TDD + PR sync)
├── scripts/
│   ├── jira_api_helper.py            ← Shared Jira API client
│   ├── jira_governance_setup.py      ← Create statuses + fields via API
│   ├── jira_orchestrator.py          ← Board monitor + delegation
│   ├── tdd_gate.py                   ← TDD RED→GREEN enforcement
│   ├── atomic_gate.py                ← Atomic execution validation
│   └── hooks/
│       ├── commit-msg                ← Jira key + 5W1H validation
│       ├── prepare-commit-msg        ← 5W1H template injection
│       ├── pre-commit                ← Secret scan (gitleaks patterns)
│       ├── pre-push                  ← Atomic execution gate
│       └── post-commit               ← Auto-push to Jira comment
└── .git/hooks/                       ← Installed copies of all hooks
    ├── commit-msg
    ├── prepare-commit-msg
    ├── pre-commit
    ├── pre-push
    └── post-commit
```

---

## 🔧 Step-by-Step Remaining Implementation

### STEP 1: Add GitHub Secrets (5 min)

1. Go to: `https://github.com/<org>/<repo>/settings/secrets/actions`
2. Click "New repository secret"
3. Add three secrets:
   - Name: `JIRA_BASE_URL` → Value: `https://pansakorn.atlassian.net`
   - Name: `JIRA_EMAIL` → Value: `pansakorn@gmail.com`
   - Name: `JIRA_API_TOKEN` → Value: *(rotate old token first)*

### STEP 2: Run Jira Governance Setup Script (2 min)

```bash
cd /Users/kimlenglim/Project/aipass-web-bridge

# Dry run first (no changes)
python3 scripts/jira_governance_setup.py --dry-run

# Execute
python3 scripts/jira_governance_setup.py
```

This creates:
- Custom statuses: `TDD RED`, `TDD GREEN`, `Review`
- Custom field: `TDD Phase` (select: RED/GREEN/REVIEW/N/A)

### STEP 3: Configure Jira Automation Rules (30 min)

**Jira Automation API returns 404** (current plan: Free/Standard). Must configure manually:

1. Go to: `Project Settings → Automation`
2. Click "Create rule"
3. Create 6 rules per `JIRA_AUTOMATION_RULES.md`

**Alternative:** Use Hermes cron as fallback:
```
*/30 * * * * python3 scripts/jira_orchestrator.py --stale-only
0 9 * * * python3 scripts/jira_orchestrator.py --orphans
```

### STEP 4: Install GitHub for Jira Integration (10 min)

1. Go to: [Atlassian Marketplace — GitHub for Jira](https://marketplace.atlassian.com/apps/1219592/github-for-jira)
2. Install app → Connect GitHub account
3. Select repository: `aipass-web-bridge`
4. Smart commits now work automatically:
   - `KAN-123 #comment Fixed the bug`
   - `KAN-123 #time 2h 30m`
   - `KAN-123 #close`

### STEP 5: Test Hooks End-to-End (10 min)

```bash
# Test 1: 5W1H rejection (empty fields)
git checkout -b test-5w1h
echo "test" > test.txt
git add test.txt
git commit  # Should inject template, then reject on empty fields

# Test 2: 5W1H acceptance
git commit -m "KAN-123: Test commit

## 5W1H
- Who: agent-developer_core
- What: Test change
- When: Sprint G
- Where: scripts/
- Why: Testing hooks
- How: Manual commit

## Files
- test.txt"

# Test 3: Atomic gate rejection (>3 files)
echo "a" > a.txt && echo "b" > b.txt && echo "c" > c.txt && echo "d" > d.txt
git add *.txt
git commit -m "KAN-123: Test"
git push  # Should reject (4 files > 3 max)

# Test 4: TDD gate (after ticket in TDD RED)
# Requires Jira ticket in TDD RED status — try commit without test files

# Cleanup
git checkout master
git branch -D test-5w1h
```

### STEP 6: Rotate Jira API Token (5 min)

1. Go to: https://id.atlassian.com/manage-profile/security/api-tokens
2. Revoke old token (exposed in chat history)
3. Create new token
4. Update `/Users/kimlenglim/Project/HoroConsultant/.env`:
   ```
   JIRA_API_TOKEN=<new_token>
   ```
5. Update GitHub Secrets (Step 1)

---

## 🔑 Credential Locations

| Service | Location | Notes |
|---------|----------|-------|
| Jira API Token | `/Users/kimlenglim/Project/HoroConsultant/.env` | `JIRA_API_TOKEN=` |
| Jira Email | Same file | `JIRA_EMAIL=pansakorn@gmail.com` |
| Jira Base URL | Same file | `JIRA_BASE_URL=https://pansakorn.atlassian.net` |
| GitHub Secrets | `github.com → repo → Settings → Secrets → Actions` | 3 vars needed |

---

## 📊 Current Jira Board State (Snapshot: 2026-09-23)

```
Total Active: 26 tickets
├── Ready (unassigned): 21  ← Needs delegation
├── TDD RED: 5
└── In Progress: 0

By Agent:
  agent-codex1: 7
  agent-lead_ba: 5
  agent-codex3: 4
  agent-hermes: 3
  agent-codex2: 3
  agent-developer_core: 2
  agent-user: 1
  unassigned: 1 (KAN-86 Epic)
```

---

## 🚨 Known Issues & Limitations

| Issue | Impact | Workaround |
|-------|--------|------------|
| Jira Automation API returns 404 | Cannot create rules via API | Manual UI setup or Hermes cron |
| `/search` endpoint deprecated | 410 Gone | Migrated to `/search/jql` in `jira_api_helper.py` |
| Agent licenses expensive | AI agents aren't Jira users | Use labels instead of assignees |
| Squash merge bypasses pre-push | Atomic gate lost | Disable squash or require PR |
| `git commit --no-verify` | Bypasses all hooks | GitHub branch protection + CI enforcement |

---

## 🎯 Quick Reference — Commands

```bash
# View board
python3 scripts/jira_orchestrator.py --full-board

# Get delegation recommendations
python3 scripts/jira_orchestrator.py --recommend

# Check stale tickets
python3 scripts/jira_orchestrator.py --stale-only

# Check TDD distribution
python3 scripts/jira_orchestrator.py --tdd-dist

# Setup Jira statuses/fields
python3 scripts/jira_governance_setup.py --dry-run  # Preview
python3 scripts/jira_governance_setup.py            # Execute

# Test Jira connection
python3 scripts/jira_api_helper.py
```

---

## 📚 Reference Documents

| Document | Path | Purpose |
|----------|------|---------|
| Governance Framework | `GOVERNANCE_TICKET_HIERARCHY.md` | Epic/Story/Task/Subtask rules + 5W1H + TDD lifecycle |
| Automation Config | `JIRA_AUTOMATION_RULES.md` | 6 automation rules to configure manually |
| Red Team Audit | `GOVERNANCE_RED_TEAM_AUDIT.md` (if exists) | 31 vulnerabilities + mitigations |
| Blue Team Audit | (generated by sub-agent) | Security hygiene gaps |
| Jira Specialist Audit | `JIRA_SPECIALIST_AUDIT_REPORT.md` (if exists) | Jira platform limits |
| Research Audit | `GOVERNANCE_AUDIT_REPORT.md` (if exists) | Best practice comparison |
| Orchestrator Audit | `ORCHESTRATOR_AUDIT_GOVERNANCE_ENFORCEMENT.md` (if exists) | Enforcement gaps |

---

## ✅ Acceptance Criteria

Implementation is complete when:

- [ ] All 5 hooks installed and tested (commit-msg, prepare-commit-msg, pre-commit, pre-push, post-commit)
- [ ] 5W1H template auto-injects on `git commit` (no -m flag)
- [ ] Commits without Jira key are rejected
- [ ] Commits without 5W1H are rejected (when template present)
- [ ] Pushes with >3 files are rejected (atomic gate)
- [ ] Cross-system pushes are rejected
- [ ] Jira comments auto-populate on commit
- [ ] GitHub Actions workflow triggers on PR
- [ ] Jira statuses created: TDD RED, TDD GREEN, Review
- [ ] Jira custom field created: TDD Phase
- [ ] 6 Jira automation rules configured (or Hermes cron fallback)
- [ ] GitHub Secrets configured
- [ ] Jira API token rotated
- [ ] Branch protection rules configured
- [ ] Smoke test: end-to-end commit → Jira sync → PR → merge → Done

---

## 📞 Escalation

| Problem | Contact | Action |
|---------|---------|--------|
| Jira API 404 on automation | Atlassian Support | Request Premium trial or use UI |
| GitHub secrets not working | Repo admin | Verify secrets in correct repo |
| Hooks not executing | Developer | Check `chmod +x .git/hooks/*` |
| Token permission errors | Jira admin | Verify token has required scopes |

---

*End of handoff document. Total remaining effort: ~2 hours (P0 items only).*
