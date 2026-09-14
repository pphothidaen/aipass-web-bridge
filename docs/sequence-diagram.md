# Secretary — Sequence Diagrams

## 1. Main workflow (`run_secrets_workflow`)

End-to-end flow: Hermes/User request → skill reuse → consultant → execution →
verification → skill save → self-heal loop → success or structured degradation.

```mermaid
sequenceDiagram
    autonumber
    actor U as User / Hermes Agent
    participant S as Secretary<br/>(run_secrets_workflow)
    participant SK as Skill Library<br/>(skills/*.json)
    participant B as AIPASS Bridge :8787<br/>(OpenAI protocol)
    participant C as Consultant<br/>(gemini model)
    participant E as Executor<br/>(shell / bridge agent)
    participant FS as Filesystem (cwd/sandbox)

    U->>S: request (text)
    S->>S: gather_context() + workflow_id

    rect rgb(235, 245, 255)
        note over S,SK: C12 — Skill Reuse
        S->>SK: load_skill(request)
        alt skill matches (op type + path + score)
            SK-->>S: saved plan (paths re-based to cwd)
            note over S: skill_reused = true<br/>(never re-saved, no consultation)
        else no match
            SK-->>S: null
        end
    end

    alt no reused skill AND should_consult(request)
        S->>B: POST /v1/chat/completions (plan request)
        B->>C: forward (model = CONSULTANT_MODEL)
        Note over B,C: auto model switch →<br/>data-model_switched in reasoning_content
        B-->>S: response (JSON plan or markdown-wrapped)
        S->>S: detect_model_switch() → warn user if switched
        alt consultant unavailable / malformed output
            S-->>U: status = degraded<br/>(consultant_unavailable | consultant_malformed_output)
        end
    else no reused skill AND simple file op
        S->>S: build simple plan (echo/rm command_hint)
    end

    rect rgb(235, 255, 235)
        note over S,FS: C14 — Execute + Automated Verification
        S->>E: execute_plan(steps)
        E->>FS: run command_hint / bridge agent task
        FS-->>E: output
        E-->>S: execution_result (success | partial_failure)
        S->>FS: verify file state (CREATE/UPDATE/DELETE)
        FS-->>S: verification_result
    end

    alt execution success AND verified
        rect rgb(255, 250, 230)
            note over S,SK: C13 — Save (only if NOT reused)
            S->>SK: save_successful_skill(...)
        end
        S-->>U: status = success (plan, latency, workflow_id)
    else failed or unverified
        rect rgb(255, 240, 240)
            note over S,C: C17 — Self-Heal Loop (max SECRETARY_MAX_HEAL_ATTEMPTS = 2)
            loop attempt = 1..2
                S->>S: _locate_failed_step()
                S->>B: POST /v1/chat/completions (self-heal request)
                B-->>S: alternative_plan | null | malformed
                alt valid alternative
                    S->>E: execute_plan(alternative)
                    E-->>S: alt execution_result
                    S->>FS: verify
                    FS-->>S: alt verification_result
                    alt verified
                        S-->>U: status = success (self_healing_applied)
                    else still failing
                        Note over S: consume attempt, try next
                    end
                else null / malformed output
                    Note over S: consume attempt<br/>(consultant_unavailable | malformed_output)
                end
            end
        end
        S-->>U: status = degraded<br/>(heal_attempts_exhausted + attempts[])
    end
```

## 2. C10–C11 live probe (`test_c10_c11_live_probe.py`, opt-in)

```mermaid
sequenceDiagram
    autonumber
    actor D as Developer
    participant P as Live Probe<br/>(SECRETARY_LIVE_TEST=1)
    participant B as AIPASS Bridge :8787
    participant C as Consultant
    participant SB as Temp Sandbox

    D->>P: run with SECRETARY_LIVE_TEST=1
    P->>B: GET /status
    B-->>P: ok, extensions (login), defaultModel, credits
    P->>B: GET /quota?refresh=1
    B-->>P: quota figures
    alt preflight fails (bridge down / no login / no credits / model missing)
        P-->>D: exit 2 — BLOCKED, no call, no credits used
    else preflight ok
        P->>SB: mkdir temp sandbox
        P->>B: POST /v1/chat/completions (EXACTLY ONE call)
        B->>C: plan request (one file in sandbox)
        C-->>P: plan
        P->>P: validate: 1 step, file op, paths inside sandbox,<br/>no dangerous patterns (NEVER executed)
        P-->>D: PASS (plan accepted, not executed) | FAIL
    end
```

## 3. Hermes Agent integration (macOS)

```mermaid
sequenceDiagram
    autonumber
    actor U as User
    participant H as Hermes Agent (macOS)
    participant B as AIPASS Bridge :8787
    participant C as gemini-3.1-flash-lite / pro-preview

    U->>H: hermes --provider aipass-bridge -m gemini-3.1-flash-lite
    H->>B: POST http://127.0.0.1:8787/v1/chat/completions
    B->>C: forward
    C-->>B: completion (+ data-model_switched if AIPASS auto-switched)
    B-->>H: OpenAI-format response
    H-->>U: answer (e.g. HERMES-AIPASS-OK)
```
