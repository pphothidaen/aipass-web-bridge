# Primary brain ↔ Second brain — Architecture & Sequence (2026-09-11)

บทบาทตามข้อกำหนดล่าสุด: **AIPASS Bridge 8787 = Primary brain** (วิเคราะห์/วางแผน —
claude-sonnet-5@default), **Secretary = Second brain** (orchestrator บน Hermes,
execute + จัดการเครื่อง), Nous Portal = fallback planning lane

ข้อจำกัดของ bridge ที่ออกแบบรอบ: endpoint รับเฉพาะ user message สุดท้าย
(`extractUserParts` ใน `bridge/server.mjs`) แต่ server เก็บ conversation history เอง
→ ต่อ workflow ต้องเปิด conversation ใหม่ (`POST /conversations/new`) แล้วส่งทีละ
ข้อความ; protocol ทั้งหมด serialize ใน user message

## Sequence (Mermaid)

```mermaid
sequenceDiagram
    autonumber
    participant U as User
    participant S as Secretary = Second brain<br/>(บน Hermes, มี tools)
    participant P as Primary brain<br/>Bridge 8787<br/>claude-sonnet-5@default
    participant N as Nous Portal<br/>(escalate lane)
    participant H as Hermes/bridge-agent tools
    participant FS as Filesystem

    U->>S: คำสั่ง/คำถาม
    S->>S: skill reuse? → มี: execute เลย
    S->>S: gather_context (cwd, relevant_files, bridge status)
    S->>P: POST /conversations/new (temporary)
    loop ทุก turn (≤ PRIMARY_BRAIN_MAX_TURNS)
        S->>P: protocol intro + request + context/รายงานผล (user message เดียว)
        P-->>S: {"type":"instruction"|"question"|"done", ...}
        alt credit_not_enough switch ถูกตรวจ
            S-->>U: ⚠️ แจ้ง from→to model
            S->>N: escalate: longcat-2.0:free (high) → solar (med) → bridge consultant
            N-->>S: plan (one-shot)
            S->>H: execute plan ทั้งก้อน
        else instruction
            S->>H: execute_plan (shell / hermes lane / bridge-agent fallback)
            H->>FS: ลงมือจริง + ตรวจ side effect
            S->>S: verify_execution_result
            S->>P: รายงานผล (steps, output tails, verification failures)
        else question
            S->>FS: gather (อ่านไฟล์ที่ถูกถาม ≤2000 chars)
            S->>P: ตอบคำถาม / ระบุว่า gather ไม่ได้ + แนะนำทาง
        else done
            S-->>U: สรุปผล (brain_summary, turns, escalated, ...)
        end
    end
```

## พฤติกรรมที่ตรวจสอบแล้ว (2026-09-11)

- Primary mode = default (`SECRETARY_ORCHESTRATION=legacy` เพื่อกลับพฤติกรรมเดิม)
- ที่เครดิต 0: turn แรกตรวจเจอ `data-model_switched` → แจ้ง user → escalate ไป Nous
  (longcat high) → plan → hermes lane (tool-less หลัง switch) → bridge-agent fallback
  เขียนไฟล์จริง → verify ผ่าน → `orchestration:"primary", brain_switched:true, escalated:true`
- Legacy mode ยังทำงานครบ (`orchestration:"legacy"`)
- Unit tests: `test_primary_brain.py` 12/12 (parser, turn bound, session, switch detect)

## Protocol ของ Primary brain

```json
{"type":"instruction","analysis":"...","steps":[{"step":1,"action":"...","command_hint":"optional","expected_outcome":"checkable","is_file_operation":true}]}
{"type":"question","questions":["..."]}
{"type":"done","summary":"..."}
```

Primary ไม่เรียก tools เอง — ทุกการกระทำจริงผ่าน Secretary (second brain) เสมอ

## Fallback ladder (ปรับได้ด้วย env)

1. Skill reuse (ไม่ใช้ brain)
2. Primary brain loop (bridge claude-sonnet-5@default)
3. เจอ switch (credit_not_enough) → Nous longcat-2.0:free (high) → solar-pro4:free (med) → bridge consultant one-shot
4. Bridge ล่ม/turn budget หมด → legacy `run_secrets_workflow` ทั้งก้อน (`orchestration:"legacy_fallback"`)

หมายเหตุ: เมื่อโควตา AiPASS กลับมา > 0, claude-sonnet-5 ตอบจริงโดยไม่มี switch event
→ Primary brain loop ทำงานเต็มรูปแบบ (dialogue ได้หลาย turn) โดยไม่ต้องแก้โค้ด
