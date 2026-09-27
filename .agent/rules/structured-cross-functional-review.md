---
title: Structured Cross-Functional Review Governance (KAN-122)
trigger: always_on
---

# Mandatory Rule: Structured Cross-Functional Review (KAN-122)

## 1. Context & Purpose
When software agents or developers face **major architectural decisions**, **complex problems**, or **iterative rework loops (>= 2 iterations)**, hasty unilateral implementation leads to severe regressions, resource exhaustion, security leaks, or architectural dead ends.

This rule mandates a **Structured Cross-Functional Review** before code or infrastructure mutations may proceed.

---

## 2. Trigger Conditions (When Review Is Required)

A task MUST undergo a Structured Cross-Functional Review if ANY of the following apply:
1. **Decision Point ที่ค่อนข้างใหญ่ (Major Architectural / System Decision Point)**:
   - Migration or redesign of core protocols, data stores, API schemas, routing engines, or execution runtimes.
   - Significant architectural tradeoffs (e.g. Option A vs Option B vs Option C).
   - High blast radius affecting multiple components across clusters (e.g. Node6 OVMS + Cloudflare Worker + Bridges).
2. **แก้หลายรอบ (Iterative Rework / Fix Loop)**:
   - The same bug, feature, or component has undergone $\ge 2$ failed attempts or regressions.
   - Signal: "If a fix fails twice, the design is flawed or constraints are misunderstood."
3. **ความซับซ้อนสูง (High Complexity)**:
   - Concurrent distributed state, race conditions, cross-platform lifecycle hooks, or multi-tenant agent orchestration.

---

## 3. The 4-Phase Review Protocol

```
Phase 1: Framing (Hermes Orchestrator)
   │
   ├─► Problem Statement
   ├─► Technical / Environmental Constraints
   └─► Decision Criteria
   │
Phase 2: Parallel Dispatch (4 Specialist Perspectives)
   │
   ├─► Red Team: "Probe: ช่องโหว่/edge case อะไรที่ Design X น่าจะเผชิญ?"
   ├─► Blue Team: "Defend: Design X จะ defend ได้ดีที่สุดที่จุดไหน? อะไรคือ weak point?"
   ├─► Worker Specialist: "Implementability: constraint อะไรที่ design นี้อาจ clash กับ infrastructure?"
   └─► Research: "Precedent: industry เคย solve ปัญหานี้ยังไง? pattern อะไรที่เกี่ยวข้อง?"
   │
Phase 3: Synthesize (Trade-off Matrix)
   │
   └─► Summarize 2-3 options with structured Trade-off Table
   │
Phase 4: Decision & Rationale Recording
   │
   ├─► Owner (Human PO / Lead Architect / Orchestrator) selects option
   ├─► Document explicit rationale, mitigations, and rollback plan
   └─► Mark status: APPROVED
```

### Phase 1: Hermes (Orchestrator) Framing
The Orchestrator defines the baseline framing:
- **Problem Statement**: Precise root-cause definition of what is broken or needed.
- **Constraints**: Hardware boundaries, memory limits (e.g. Cloudflare Worker 10MB/128MB, Node6 VRAM), latency SLAs, Zero-Token-Leak.
- **Decision Criteria**: Objective evaluation metrics (Reliability, Latency, Complexity, Blast Radius, Reversibility).

### Phase 2: Parallel Dispatch (4 Perspectives)
Dispatch the review query concurrently to 4 distinct perspectives:
1. **Red Team (Adversarial Probe)**:
   - **Prompt**: `"Probe: ช่องโหว่/edge case อะไรที่ Design X น่าจะเผชิญ?"`
   - **Focus**: Race conditions, edge cases, failure cascades, resource exhaustion, unexpected inputs, boundary anomalies.
2. **Blue Team (Defend & Resilience)**:
   - **Prompt**: `"Defend: Design X จะ defend ได้ดีที่สุดที่จุดไหน? อะไรคือ weak point?"`
   - **Focus**: Zero-Token-Leak, security perimeter, circuit breakers, graceful degradation, secret scrubbing, blast radius containment.
3. **Worker Specialist (Implementability & Infrastructure)**:
   - **Prompt**: `"Implementability: constraint อะไรที่ design นี้อาจ clash กับ infrastructure?"`
   - **Focus**: Node6 GPU OVMS compatibility, socket pooling, worker bundle sizes, process lifetimes, platform limits.
4. **Research (Industry Precedent & Patterns)**:
   - **Prompt**: `"Precedent: industry เคย solve ปัญหานี้ยังไง? pattern อะไรที่เกี่ยวข้อง?"`
   - **Focus**: RFC specifications, proven distributed design patterns, industry post-mortems, open-source precedent.

### Phase 3: Synthesize (Trade-off Matrix)
Synthesize the 4 perspectives into 2-3 viable architectural options:
- Present an explicit **Trade-off Table** evaluating each option against all criteria and specialist findings.

### Phase 4: Decision & Rationale Recording
- The **Owner (Human PO / Lead Architect / Orchestrator)** selects the winning option.
- Must document:
  1. Selected Option
  2. Rationale for choice
  3. Mitigations for risks identified by Red Team
  4. Rollback Plan
- Status must be marked **`APPROVED`**.

---

## 4. Enforcement & Tooling

1. **PreToolUse & PreGatewayDispatch Hooks**:
   - `structured_review_hook.py` validates that an approved review artifact exists before executing mutating tools (`write_file`, `patch`, `write_to_file`, `replace_file_content`, mutating `terminal` / `run_command`).
   - If a trigger is detected and review is missing/incomplete: **Hard block with Exit 2 / Deny**.
2. **Orchestrator CLI**:
   - Initialize review:
     `python3 ~/.hermes/scripts/cross_functional_review.py init --ticket <TICKET> --title "<TITLE>" --problem "<PROBLEM>"`
   - Get parallel prompts:
     `python3 ~/.hermes/scripts/cross_functional_review.py dispatch-prompts --ticket <TICKET> --design "<DESIGN>"`
   - Record findings:
     `python3 ~/.hermes/scripts/cross_functional_review.py record-perspective --file <FILE> --role <ROLE> --findings "<TEXT>"`
   - Synthesize:
     `python3 ~/.hermes/scripts/cross_functional_review.py synthesize --file <FILE> --options "<OPT1, OPT2, OPT3>"`
   - Decide & approve:
     `python3 ~/.hermes/scripts/cross_functional_review.py decide --file <FILE> --decision "<CHOICE>" --rationale "<REASON>" --owner "<NAME>"`
   - Verify completeness:
     `python3 ~/.hermes/scripts/cross_functional_review.py verify --file <FILE>`
