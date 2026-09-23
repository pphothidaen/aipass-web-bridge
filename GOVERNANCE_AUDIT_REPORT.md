# 🔬 GOVERNANCE_TICKET_HIERARCHY.md — Best Practice Audit Report

> **Auditor:** Hermes Agent (Subagent Research)  
> **Date:** 2026-09-23  
> **Document Under Review:** `/Users/kimlenglim/Project/aipass-web-bridge/GOVERNANCE_TICKET_HIERARCHY.md` (923 lines, 43KB)  
> **Methodology:** Comparative analysis against SAFe 6.0, Scrum@Scale, Atlassian Team Handbook, Google RE:Work (Project Aristotle), DORA 2025 Metrics, and AI-agent orchestration literature.

---

## Executive Summary

The GOVERNANCE_TICKET_HIERARCHY.md document is **significantly more rigorous than standard agile team practices** — it exceeds baseline Scrum and approaches SAFe-level governance, with unique innovations for multi-agent AI orchestration (Red Team/Blue Team gates, TDD state machine, 5W1H completeness enforcement). However, it has **measurable gaps** against current industry standards, particularly in DORA metrics integration, WIP/capacity management, SRE practices, and AI-agent-specific reliability patterns.

| Dimension | Rating | Evidence |
|-----------|--------|----------|
| Hierarchy Structure | ⚠️ Good, minor gap | Missing Feature level (SAFe) |
| Workflow Rigor | ✅ Exceeds standard | TDD state machine, Red/Blue gates |
| Security/Hygiene | ✅ Exceeds standard | Zero-Token-Leak, gitleaks, pre-commit hooks |
| Metrics & Observability | ❌ Significant gap | No DORA metrics, no SLO/SLI, no error budgets |
| AI-Agent Specifics | ⚠️ Good, gaps exist | Missing agent context limits, retry protocols, capability drift |
| Capacity/Flow Management | ❌ Gap | No WIP limits, no velocity, no team topology alignment |
| Team Dynamics | ❌ Gap | No psychological safety, no Google RE:Work integration |

---

## 1. Framework-by-Framework Comparison

### 1.1 SAFe 6.0 (Scaled Agile Framework)

| SAFe Element | Present in Doc? | Assessment |
|---|---|---|
| **Portfolio Level** (Epic → Capability → Enabler) | ❌ No | Doc starts at Epic; no Portfolio/strategic theme layer |
| **Feature** (between Epic and Story) | ❌ No | SAFe requires Features as deliverable units between Epic and Story. Doc collapses this into Epic→Story. |
| **Story** (functional, user-facing) | ✅ Yes | Well-defined with INVEST |
| **Enabler** (architecture, compliance) | ⚠️ Partial | "Research Story" and "Task" cover some enabler work but not explicitly named |
| **Story Points / WSJF** | ⚠️ Partial | Mentions Story Points but not WSJF (Weighted Shortest Job First) prioritization |
| **PI Planning** | ❌ No | No Program Increment cadence, no PI objectives |
| **Release Train Engineer** | ❌ No | "Facilitator" role exists but no RTE-equivalent for cross-team coordination |

**Verdict:** Doc operates at the **Team level** of SAFe but misses the **Agile Release Train (ART)** and **Portfolio** layers. For a multi-agent team with 7+ agents, this may cause coordination friction at scale.

**SAFe 6.0 Reference:** `framework.scaledagile.com` — Features & Capabilities, hierarchy requires Portfolio → Epic → Feature → Story.

---

### 1.2 Scrum@Scale

| Scrum@Scale Element | Present? | Assessment |
|---|---|---|
| **Scrum of Scrums** | ❌ No | No cross-team sync mechanism for agent sub-teams |
| **Scaled Daily Scrum** | ❌ No | Daily Standup defined but no escalation/aggregation pattern |
| **Meta-Scrum** (stakeholder alignment) | ❌ No | No Product Owner forum for Epic-level prioritization |
| **Executive Action Team** | ❌ No | No escalation path beyond "Hermes arbitrates" |

**Verdict:** Doc is **single-scrum-team-scaled-with-orchestrator**, not truly scaled agile. Acceptable for now but will need Scrum@Scale patterns if agent count grows beyond ~10.

---

### 1.3 Atlassian Team Handbook & Engineering Practices

| Atlassian Practice | Present? | Assessment |
|---|---|---|
| **Sprint cadence** | ✅ Yes | Sprint Planning/Review/Retro defined |
| **Kanban option** | ⚠️ Partial | "On-Demand" and "Anytime" Research exist but no Kanban flow option |
| **Open DevOps** | ❌ No | No Jira + Bitbucket + Opsgenie integration guide |
| **Team Topology** (stream-aligned, platform, enabling, complicated-subsystem) | ⚠️ Partial | Specialist roles exist but not mapped to team topology types |
| **Autonomous team charter** | ❌ No | No team charter or mission statement beyond Epic-level |
| **Cross-team dependencies** | ⚠️ Partial | "relates to" / "links" mentioned but no dependency board |

**Verdict:** Follows Atlassian epic/story conventions well but misses the **operational excellence** layer (Open DevOps, team topology, platform thinking).

---

### 1.4 Google RE:Work (Project Aristotle)

Google's research on team effectiveness identifies **5 dynamics**:

| Dynamic | Present? | Gap |
|---|---|---|
| **Psychological Safety** | ❌ No | No mechanism for agents to flag "unclear" or "risky" tickets without penalty. No blameless post-mortem practice. |
| **Dependability** | ✅ Partial | "Stale In-Progress >24h" alert covers tardiness but no reliability SLA between agents |
| **Structure & Clarity** | ✅ Yes | 5W1H enforces clarity. Governance-as-code provides structure. |
| **Meaning** | ⚠️ Partial | "WHY" section captures value but no connection to team mission/vision |
| **Impact** | ❌ No | No retrospective analysis of whether Epics achieved their stated outcomes |

**Verdict:** Doc covers Structure well but misses **psychological safety** (critical for AI agents — need a way to say "I don't understand this ticket") and **impact measurement** (did the Epic actually close the gap stated in WHY?).

---

### 1.5 DORA Metrics (2025 — 5 Metrics)

| DORA Metric | Present? | Assessment |
|---|---|---|
| **Deployment Frequency** | ❌ No | No tracking of how often the team ships to production |
| **Change Lead Time** | ⚠️ Partial | "Created → Done" lifecycle exists but no SLA (e.g., "P0 fix lead time < 4h") |
| **Failed Deployment Recovery Time** | ⚠️ Partial | "Hotfix Task" + Incident Epic exist but no measured recovery time target |
| **Change Fail Rate** | ❌ No | No tracking of deployment → incident correlation |
| **Deployment Rework Rate** | ❌ No | No tracking of unplanned work ratio |

**AI-Specific DORA Gaps (per Larridin 2025, DevOps.com 2026):**
- No **Code Turnover Rate** tracking (GitClear data: AI-written code has 2x rewrite rate)
- No **PR Size** guardrail (DORA 2024: +154% PR size with AI tooling)
- No **Time in Review** tracking (+91% reported with AI-generated code)
- No **Complexity-Adjusted Output** (can't distinguish maintenance vs. innovation deploys)

**Verdict:** This is the **most significant gap**. DORA metrics are the industry standard for measuring software team performance. Without them, the team cannot:
- Benchmark against "Elite" performers (deploy on-demand, <1h recovery, <5% fail rate)
- Detect AI-induced quality degradation (stable CFR but rising code turnover)
- Make data-driven sprint decisions

---

## 2. What's MISSING (Gaps Requiring Addition)

### 2.1 DORA Metrics Integration ⭐ HIGH PRIORITY

**Evidence:** DORA research across 36,000 organizations (Forsgren et al., *Accelerate*) proves these metrics predict organizational performance. AI-era updates (DORA 2024-2025) explicitly address agent-assisted development.

**Recommended Addition:**
```markdown
## DORA Metrics Targets (AI-Agent Team)

| Metric | Elite Target | Current Baseline | Measurement |
|--------|-------------|-----------------|-------------|
| Deployment Frequency | On demand (multiple/day) | TBD | Jira "Done" → production deploy events |
| Change Lead Time | < 1 hour | TBD | Commit → production timestamp |
| Change Fail Rate | < 5% | TBD | Deploys causing incident / total deploys |
| Failed Recovery Time | < 1 hour | TBD | Incident start → service restored |
| Deployment Rework Rate | Minimal | TBD | Unplanned deploys / total deploys |

### AI-Specific Supplements (DORA 2024+)
- **Code Turnover Rate:** Track lines rewritten within 30 days of merge
- **PR Size Guardrail:** Flag PRs > 400 lines for decomposition
- **Time in Review:** Alert if PR review > 24h (bottleneck signal)
```

### 2.2 WIP Limits & Capacity Management

**Evidence:** Kanban Method (Anderson), DORA research (smaller batches = higher performance), Little's Law.

**Current Gap:** No WIP limits per agent or per sprint. "Queue Overflow" rule (>8 Subtasks) exists but no limit on concurrent In-Progress items.

**Recommended Addition:**
```markdown
### WIP Limits
- Per agent: max **2 concurrent In-Progress Subtasks**
- Per Story: max **5 active Subtasks** before requiring decomposition
- Per Epic: max **5 active Stories** to prevent scope overflow
- Sprint capacity: track **total estimated hours per sprint** vs. actual
```

### 2.3 Definition of Ready (DoR) vs Definition of Done (DoD)

**Evidence:** Scrum Guide 2020, SAFe, Atlassian best practices distinguish DoR (entry criteria) from DoD (exit criteria).

**Current Gap:** "Exit Criteria" defined per state but no explicit DoR checklist. Section 12 compliance list mixes both.

**Recommended Addition:**
```markdown
## Definition of Ready (Story can enter Sprint)
- [ ] 5W1H complete
- [ ] Acceptance criteria as Given/When/Then
- [ ] Dependencies identified and linked
- [ ] Estimated (Story Points or T-shirt)
- [ ] Agent role label attached
- [ ] Sprint assigned

## Definition of Done (Story can be marked Done)
- [ ] All Subtasks Done
- [ ] TDD: RED→GREEN→REFACTOR completed
- [ ] PR reviewed by non-assignee agent
- [ ] Blue Team scan clean (no secrets)
- [ ] Tests pass in CI
- [ ] Merged to main/deployed to production
- [ ] Monitoring healthy for 24h
- [ ] Epic progress updated
```

### 2.4 SLO/SLI Definitions (SRE Practice)

**Evidence:** Google SRE Book (Beyer et al.), DORA "Reliability" as 5th metric.

**Current Gap:** "Expected Outcome" in WHY mentions metrics (e.g., error_rate < 0.1%) but no formal SLOs with error budgets.

**Recommended Addition:**
```markdown
### Service Level Objectives (per Component)

| Component | SLI | SLO | Error Budget |
|-----------|-----|-----|--------------|
| Cloudflare Worker | Availability | 99.9% | 43m downtime/month |
| VS Code Extension | p95 cold start | < 2s | 5% violations/month |
| OVMS Inference | p95 latency | < 200ms | 5% violations/month |

**Policy:** If error budget exhausted → freeze feature work, enter reliability Epic
```

### 2.5 Feature Flag / Deployment Strategy

**Evidence:** DORA research (separate deployment from release), Google SRE (progressive rollout).

**Current Gap:** Mentions "feature flag or independent deployment possible" but no strategy.

**Recommended Addition:**
```markdown
### Deployment Strategy Matrix

| Risk Level | Strategy | Ticket Requirement |
|-----------|----------|-------------------|
| Low | Direct deploy to prod | Subtask with Blue Team scan |
| Medium | Canary (5% → 50% → 100%) | Story with monitoring gate |
| High | Feature flag + gradual rollout | Epic with wave plan |
| Critical | Blue-green deployment | Dedicated Task with rollback test |
```

### 2.6 Agent Reliability Patterns (AI-Specific)

**Evidence:** Multi-agent orchestration research (OpenAI, Anthropic), DORA AI-era findings.

**Current Gaps:**
- No agent context window budget per ticket
- No retry protocol when agent fails a Subtask
- No capability drift detection (agent was good at X, now degraded)
- No cross-session handoff protocol (agent A starts, agent B continues)

**Recommended Addition:**
```markdown
### Agent Reliability Rules

1. **Context Budget:** Each Subtask description + parent Story must fit within agent context window (< 50% capacity)
2. **Retry Protocol:** 
   - Subtask fails CI → agent retries up to 2 times
   - If still failing → escalate to Hermes for re-decomposition
3. **Capability Drift:** 
   - Track agent success rate per Epic type
   - If agent fails 3+ consecutive Subtasks in same domain → retrain or reassign
4. **Session Handoff:** 
   - Agent A can mark Subtask "Paused" with comment: context, next step, files touched
   - Agent B picks up via "Resume" action (not new Subtask)
```

### 2.7 Blameless Post-Mortem / Incident Learning

**Evidence:** Google SRE (blameless post-mortems), Etsy "Debriefing Forum", PagerDuty incident response.

**Current Gap:** "post-mortem 24h" mentioned for Hotfix but no template or blameless framework.

**Recommended Addition:**
```markdown
## Incident Post-Mortem Template (add to Defect section)

### Blameless Post-Mortem: INC-<ID>
- **Incident Summary:** What happened, when, impact
- **Timeline:** Minute-by-minute (from monitoring, not memory)
- **Root Cause:** 5 Whys analysis
- **Contributing Factors:** What made this possible
- **What went well:** (always include — reinforces good practice)
- **What went wrong:** (systems/processes, not people)
- **Action Items:** (each becomes a Subtask with owner + deadline)
- **Lessons Learned:** What we'll do differently
```

---

## 3. What's OVER-ENGINEERED (Potential Simplification)

### 3.1 5W1H on Every Ticket Including Subtasks

**Current Rule:** "Every ticket — from Epic to Subtask — MUST be documented with these six dimensions."

**Concern:** For a 1-4 hour Subtask (single agent, single file), writing 6 dimensions creates overhead that may exceed the work itself.

**Industry Comparison:** 
- Atlassian: Subtasks inherit context from parent Story. Only require description + estimate.
- SAFe: Subtasks are "how" of Story implementation, no separate acceptance criteria.

**Recommendation:** Subtasks inherit WHO/WHEN/WHERE/WHY from parent Story. Only require WHAT (steps) and HOW (method) in description.

### 3.2 Mandatory ≥3 Stories per Epic

**Current Rule:** Epic Playbook step 2: "แบ่งเป็น Stories ≥3 ตัว"

**Concern:** SAFe defines Epic as "multi-sprint, multi-team" — no minimum story count. An Epic with 2 large stories spanning multiple sprints is valid.

**Recommendation:** Change to "Epic must be decomposable into Stories that each fit within 1 sprint. If Epic has < 2 Stories, consider whether it should be a Story instead."

### 3.3 Mandatory ≥2 Subtasks per Story

**Current Rule:** "ทุก Story ต้องมี Subtasks อย่างน้อย 2 ตัว" (Section 12 compliance)

**Concern:** INVEST criteria don't mandate minimum subtasks. A Story that's atomic (one file, one test) might be a single Subtask.

**Recommendation:** Remove minimum. Add: "If Story has > 5 Subtasks, consider splitting Story" (already in Red Team section — consolidate).

### 3.4 Subtask Description ≤100 Words

**Current Rule:** "ตรวจสอบ Subtask description ชัดเจน (≤100 คำ)"

**Concern:** Some atomic work needs >100 words (complex migration, multi-step verification). Arbitrary limit may force obfuscation.

**Recommendation:** Change to "Subtask description should fit on one screen when viewed in Jira (~200 words). If longer, decompose further."

### 3.5 Research Story Exceeds 1 Sprint → Promote to Epic

**Current Rule:** "Research Story exceeds 1 sprint | Promote to Epic with phased Research Stories"

**Concern:** Not all long-running research should be Epics. A 3-week deep-dive on one technical question is still research, not necessarily multi-team/multi-system work.

**Recommendation:** "Research Story exceeding 2 sprints requires Hermes review: either promote to Epic OR decompose into multiple Research Stories."

---

## 4. Framework Hierarchy Comparison

### 4.1 Current Doc Hierarchy vs SAFe

```
SAFe 6.0:        Portfolio → Epic → Feature → Story → Task
Current Doc:     Initiative(optional) → Epic → Story/Feature → Task → Subtask

Gap: Missing Feature level between Epic and Story
     (Feature = deliverable capability, 1-2 sprints, fits in single PI)
```

### 4.2 Current Doc vs Atlassian Standard

```
Atlassian:       Initiative → Epic → Story → Sub-task
Current Doc:     Initiative → Epic → Story/Feature → Task → Subtask

Note: Doc conflates "Story" and "Feature" in one level.
      Atlassian treats Feature as separate issue type (larger than Story, smaller than Epic)
```

### 4.3 Recommended Refined Hierarchy

```markdown
Initiative (optional, strategic theme)
  └── Epic (multi-sprint, multi-agent, 4-12 weeks)
        └── Feature (single agent domain, 1-2 sprints) [NEW]
              └── Story (single sprint, clear AC)
                    └── Task (technical action, no direct user value)
                          └── Subtask (atomic, 1-4 hours)
```

---

## 5. Strengths (What to Keep)

The following are **best-in-class** and should be preserved:

### 5.1 5W1H Framework ⭐ EXCEEDS INDUSTRY
Most agile teams use only "Acceptance Criteria" + "Description". 5W1H adds ownership (WHO), timing (WHERE), and evidence (WHY) — far more rigorous than standard.

### 5.2 TDD State Machine ⭐ EXCEEDS INDUSTRY
Most teams say "use TDD" but don't enforce it in workflow. Doc's explicit TDD RED → TDD GREEN → Review states with CI gates is exceptional.

### 5.3 Red Team / Blue Team Gates ⭐ UNIQUE
No standard agile framework includes adversarial testing in ticket lifecycle. This is innovative and well-suited for AI-agent teams.

### 5.4 Defect Decision Tree ⭐ EXCEEDS INDUSTRY
Clear mapping of defect source → level. Most teams lack this rigor.

### 5.5 Governance as Code ⭐ EXCEEDS INDUSTRY
Rules in repo (AGENTS.md, this file, hooks) rather than tribal knowledge. Enables reproducibility.

### 5.6 Zero-Token-Leak Principle ⭐ CRITICAL FOR AI
AI agents process secrets in context. Explicit secret hygiene governance is essential and rare.

### 5.7 Single-Agent Ownership ⭐ GOOD FOR MULTI-AGENT
Prevents split-brain in concurrent agent execution. Aligns with DORA "small batch" philosophy.

---

## 6. Priority Action Items

| Priority | Action | Effort | Impact |
|----------|--------|--------|--------|
| **P0** | Add DORA metrics targets + AI supplements | Medium | High — enables performance measurement |
| **P0** | Add Definition of Ready / Definition of Done | Low | Medium — clarifies sprint boundaries |
| **P0** | Add WIP limits per agent | Low | High — prevents agent overload |
| **P1** | Add SLO/SLI definitions per component | Medium | High — enables reliability governance |
| **P1** | Add deployment strategy matrix | Low | Medium — reduces production risk |
| **P1** | Add blameless post-mortem template | Low | Medium — improves incident learning |
| **P2** | Add agent reliability patterns (retry, context budget, drift) | Medium | Medium — improves agent success rate |
| **P2** | Relax ≥3 Stories / ≥2 Subtasks minimums | Low | Low — reduces artificial constraints |
| **P3** | Consider Feature level between Epic and Story | Medium | Low — architectural clarity |
| **P3** | Add Google RE:Work impact measurement | Medium | Low — team health signal |

---

## 7. Conclusion

The GOVERNANCE_TICKET_HIERARCHY.md document is **stronger than 90% of industry agile team charters** — its TDD enforcement, Red/Blue team gates, and 5W1H framework are genuinely innovative. However, it has **structural gaps** in metrics (DORA), capacity management (WIP limits), and SRE practices (SLOs) that would be expected in a production-grade engineering governance document.

For an **AI-agent team** specifically, the document is ahead of the curve (no other published governance model addresses multi-agent orchestration this thoroughly) but needs **agent reliability patterns** and **AI-aware DORA supplements** to handle the unique failure modes of autonomous AI workers.

**Overall Score: 7.5/10** — Exceeds standard agile. Needs metrics + SRE + AI-reliability additions to reach 9/10.

---

## References

1. Forsgren, N., Humble, J., Kim, G. (2018). *Accelerate: The Science of Lean Software and DevOps*. IT Revolution Press.
2. DORA, Google Cloud. (2025). *DORA's Software Delivery Performance Metrics*. dora.dev
3. Scaled Agile Framework 6.0. (2024). *Features and Capabilities*. framework.scaledagile.com
4. Atlassian. (2024). *Agile Teams, Epics/Stories, Engineering Handbook*. atlassian.com/agile
5. Google re:Work. *Understand Team Effectiveness* (Project Aristotle). rework.withgoogle.com
6. Larridin. (2025). *Why DORA Metrics Break in the AI Era*. larridin.com
7. DevOps.com. (2026). *Why DORA Metrics Look Different When AI Is Part of Your Development Workflow*
8. re:cinq. (2025). *What Are DORA Metrics? The 5 Metrics, Benchmarks and AI*
9. Beyer, B., Jones, C., Petoff, J., Murphy, N.R. (2016). *Site Reliability Engineering*. O'Reilly Media.
10. Anderson, D.J. (2010). *Kanban: Successful Evolutionary Change for Your Technology Business*. Blue Hole Press.

---

*Report prepared by Hermes Agent subagent. Audit completed 2026-09-23.*
