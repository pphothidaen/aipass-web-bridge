# Skill Audit Report — KAN-102

**Date:** 2026-09-24 (Asia/Bangkok)  
**Auditor:** agent-codex3  
**Ticket:** KAN-102  
**Scope:** All skills in `~/.hermes/skills/`

---

## 1. Executive Summary

| Metric | Value |
|--------|-------|
| Total SKILL.md files | 149 |
| Active skills | 126 |
| Archived skills | 23 |
| Top-level categories | 42 |
| Skills with frontmatter `description:` | 126 (100%) |
| Skills with frontmatter `trigger:` | 0 (0%) |
| Descriptions ≤ 60 chars (compliant) | 125/126 (99%) |
| Skills with `platforms:` field | 103/126 (82%) |
| Skills with `version:` field | 109/126 (87%) |
| Skills with `author: Hermes Agent` only | 52/126 (41%) |
| Skills with linked resources (refs/scripts/templates) | 58 (46%) |
| Skills with broken file references | 24 (19%) |
| Skills with [SKILL_PRUNED] marker | 1 |

**Overall Governance Score:** 62/100 (62% compliant)

---

## 2. Inventory by Category

### 2.1 Large Categories (5+ skills)

| Category | Count | Notes |
|----------|-------|-------|
| software-development | 19 | TDD, debugging, code review, planning |
| productivity | 17 | Docs, spreadsheets, meetings, PDFs |
| autonomous-ai-agents | 9 | Claude Code, Codex, subagent dispatch |
| workflow | 9 | Governance, handoff, decomposition |
| github | 7 | PRs, issues, repos, auth, CI |
| research | 7 | ArXiv, RSS, papers, citations |
| ai-agent-integration | 6 | MCP bridges, model routing |
| creative | 6 | Diagrams, art, design, music |
| devops | 5 | Cloudflare, Doppler, Jira-GitHub |
| apple | 4 | Notes, Reminders, FindMy, iMessage |

### 2.2 Medium Categories (2-4 skills)

| Category | Count |
|----------|-------|
| media | 3 |
| email | 2 |
| mlops | 2 |
| social-media | 2 |

### 2.3 Single-Skill Categories (28 total)

Standalone skills: `agy-quota-monitor`, `aipass-bridge-agent`, `aipass-bridge-verify`, `aipass-quota-allocator`, `auto-reconnect`, `bridge-health-check`, `bridge-verification`, `budget-enforcement`, `codex-auto-router`, `cost-optimization`, `documentation-scaffold`, `extension-verification`, `git-branch-audit`, `grillme`, `hermes-webhook-bridge`, `jira-board-operations`, `jira-goals-sync`, `note-taking`, `orchestration`, `quality-gate-enforcement`, `quota-monitor`, `secretary-brain`, `serving`, `smart-home`, `tmux-parallel-dispatch`, `ts-build-recovery`, `usage-analytics`, `web`

---

## 3. Governance Compliance

### 3.1 Frontmatter Standards

| Requirement | Pass | Fail | Rate |
|-------------|------|------|------|
| `description:` present | 126 | 0 | 100% |
| `description:` ≤ 60 chars | 125 | 1 | 99% |
| `version:` present | 109 | 17 | 87% |
| `platforms:` present | 103 | 23 | 82% |
| `author:` credits human first | 74 | 52 | 59% |

### 3.2 Description Length Violations

| Skill | Length |
|-------|--------|
| `budget-enforcement` | 67 chars |

### 3.3 Missing `platforms:` Field (23 skills)

`auto-reconnect`, `aipass-bridge-agent`, `devops/multi-account-ai-cli-management`, `serving/ovms-intel-gpu-deployment`, `codex-auto-router`, `grillme`, `software-development/codebase-audit-delegation`, `software-development/web-bridge-refactoring`, `software-development/parallel-tdd-redteam-lifecycle`, `mlops/ovms-openvino-gpu`, `bridge-health-check`, `ai-agent-integration/mcp-bridge-orchestration`, `ai-agent-integration/mcp-remote-bridge`, `documentation-scaffold`, `bridge-verification`, `cost-optimization`, `usage-analytics`, `aipass-bridge-verify`, `workflow/hermes-init-default-workflow`, `quota-monitor`, `secretary-brain`, `autonomous-ai-agents/herdr`, `devops/sdlc-review`

### 3.4 Author Format Issues

52 skills have `author: Hermes Agent` without human credit. Per governance, contributed skills should credit the human first.

### 3.5 Content Size Issues

| Skill | Lines | Issue |
|-------|-------|-------|
| research/research-paper-writing | 1,627 | 8x over target (~200 lines) |
| software-development/test-first-provenance-governance | 840 | 4x over target |
| autonomous-ai-agents/claude-code | 754 | 3.75x over target |
| autonomous-ai-agents/multi-account-cli-delegation | 735 | 3.7x over target |

---

## 4. Broken File References

24 skills reference files that do not exist on disk (46 total broken references).

### Skills with Most Broken References

| Skill | Broken Count | Missing Files |
|-------|-------------|---------------|
| jira-board-operations | 6 | tdd_gate.py, atomic_gate.py, jira_api_helper.py, jira_governance_setup.py, jira_orchestrator.py, hooks/ |
| software-development/test-first-provenance-governance | 4 | test_provenance_guard.py |
| software-development/parallel-tdd-redteam-lifecycle | 4 | Various script references |
| devops/cloudflare-deployment | 3 | build-extension.py, trigger_all_github_actions.py, references/vercel-vercelignore-strategies.md |
| software-development/inspecting-hermes-desktop-dom | 3 | CDP helper scripts |
| autonomous-ai-agents/multi-account-cli-delegation | 3 | Helper scripts |

---

## 5. Findings & Issues

### 5.1 Critical

| ID | Issue | Impact | Action |
|----|-------|--------|--------|
| C1 | [SKILL_PRUNED] marker in `workflow/jira-parallel-lane-governance` | Content loss | Restore from git or re-author |
| C2 | Missing `trigger:` field on all 126 skills | Auto-matching degraded | Batch-add trigger frontmatter |
| C3 | 46 broken file references across 24 skills | Skills can't be executed fully | Create missing scripts or remove references |
| C4 | research-paper-writing at 1,627 lines | Performance risk, context waste | Split into references/ |

### 5.2 Moderate

| ID | Issue | Details |
|----|-------|---------|
| M1 | 28 single-skill categories | Over-fragmentation; merge related |
| M2 | Missing `platforms:` on 23 skills | Can't gate by OS |
| M3 | Missing `version:` on 17 skills | Can't track skill evolution |
| M4 | `author: Hermes Agent` only on 52 skills | Should credit human contributors |
| M5 | Three quota skills | Potential consolidation target |
| M6 | `github/` category (7 skills) vs `software-development/github/` (1 skill) | Naming confusion |

### 5.3 Minor

| ID | Issue |
|----|-------|
| m1 | 6 skills < 50 lines — may be stubs |
| m2 | `budget-enforcement` description 67 chars (over 60 limit) |
| m3 | 26 descriptions don't end with period |

---

## 6. Duplicate Analysis

| Pair | Verdict |
|------|---------|
| `github/` (7 skills) vs `software-development/github/` (56 lines) | Not duplicates — different scope |
| `research-paper-writing/` (top-level dir) + `research/research-paper-writing/SKILL.md` | Top-level dir is migration leftover |
| `quota-monitor` + `agy-quota-monitor` + `aipass-quota-allocator` | Three similar quota skills — consolidation target |

---

## 7. Recommendations

### Short-term (This Sprint)

1. **Add `trigger:` fields** — Batch update all 126 skills with appropriate trigger patterns
2. **Fix C1** — Restore content for `jira-parallel-lane-governance` 
3. **Fix C3** — Audit broken references; create or remove missing files
4. **Fix M2/M3** — Add `platforms:` and `version:` to missing skills

### Medium-term (Next Sprint)

5. **Consolidate quota skills** — Merge into single `quota/` category
6. **Trim oversized skills** — research-paper-writing, test-first-provenance-governance, claude-code
7. **Merge single-skill categories** — Group related standalone skills
8. **Fix author attributions** — Update 52 skills to credit human contributors

---

## 8. Follow-Up Tickets

| Ticket | Title | Priority | Effort |
|--------|-------|----------|--------|
| KAN-102-I1 | Restore [SKILL_PRUNED] content in jira-parallel-lane-governance | High | 30 min |
| KAN-102-I2 | Batch-add trigger: frontmatter to 126 skills | High | 2 hrs |
| KAN-102-I3 | Fix 46 broken file references across 24 skills | High | 3 hrs |
| KAN-102-I4 | Trim research-paper-writing from 1,627 to < 400 lines | Medium | 1 hr |
| KAN-102-I5 | Add missing platforms: and version: fields | Medium | 1 hr |
| KAN-102-I6 | Consolidate quota-monitor family into single category | Medium | 1 hr |
| KAN-102-I7 | Merge 28 single-skill categories into topical groups | Low | 2 hrs |
| KAN-102-I8 | Fix author: format on 52 skills to credit human first | Low | 1 hr |

---

*Report generated by agent-codex3. All findings verified against actual file contents in `~/.hermes/skills/`.*
