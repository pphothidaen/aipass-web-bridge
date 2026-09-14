# Plan: Extend aipass-bridge → Hermes Agent Integration

**Date:** 2026-09-07
**Goal:** ต่อยอด aipass-bridge (https://github.com/niawjunior/aipass-bridge) ให้ทำงานคู่กับ Hermes Agent เป็น AI Coding Agent

## Key Insights จาก aipass-bridge README

1. **Bridge Agent มี protocol เป็นของตัวเอง** — NEED/SEARCH/EDIT/CREATE/DONE (text-based, ไม่ใช่ OpenAI function calling)
2. **Bridge ไม่รองรับ OpenAI tools parameter** — ส่งเฉพาะ last user message, drop system prompt + tools ทั้งหมด
3. **Custom Assistant บน de.aipass.net** — เก็บ tool protocol ไว้ฝั่ง server, model รู้ format โดยไม่ต้องส่ง system prompt
4. **Hermes Agent ต้องการ function calling** — ส่ง tools parameter, รับ tool_calls กลับ

## ทำไม Hermes + Bridge ใช้ Tool Calling ไม่ได้ (ปัญหาเดิม)

```
Hermes → Bridge: tools=[read_file], messages=[system+user]
Bridge → de.aipass.net: ส่งเฉพาะ last user message (ตัด tools + system ออก)
de.aipass.net → Bridge: text response (ไม่มี tool_calls)
Bridge → Hermes: content="I can't access files" (ไม่มี tool_calls)
Hermes: ❌ ไม่สามารถ execute tool ได้
```

---

## ตัวเลือกการต่อยอด (เรียงตาม Value/Effort Ratio)

### Option 1: Hermes Delegates to Bridge Agent (Quick Win — 0 บรรทัด)

**อธิบาย:** Hermes ใช้ `terminal` เรียก `npm run agent` โดยตรง ไม่ต้องเขียนโค้ดเพิ่ม

**วิธีใช้:**
```bash
cd packages/core/aipass-bridge && npm run agent -- "add a health route" --root .
```

**ข้อดี:**
- ✅ ใช้งานได้ทันที ไม่ต้องเขียนโค้ด
- ✅ ใช้ bridge models + credits ได้
- ✅ Built-in approval (diff → y/N)

**ข้อเสีย:**
- ❌ ไม่ใช้ Hermes orchestration
- ❌ ไม่ได้ใช้ Hermes native tools

---

### Option 2: MCP Server Wrapping Bridge Agent (แนะนำ — ~150 บรรทัด)

**อธิบาย:** สร้าง MCP server ที่ wrap bridge agent protocol เป็น native Hermes tools

**Hermes จะเห็น tools:**
- `mcp_aipass_read_file` — อ่านไฟล์
- `mcp_aipass_list_directory` — list directory
- `mcp_aipass_search_files` — grep โปรเจกต์
- `mcp_aipass_edit_file` — แก้ไขไฟล์ (FIND/NEW)
- `mcp_aipass_create_file` — สร้างไฟล์
- `mcp_aipass_run_command` — รันคำสัง (optional)

**File Map:**

| File | Action | Purpose |
|---|---|---|
| `packages/core/aipass-bridge/bridge/mcp-agent.mjs` | **CREATE** | MCP server ที่ wrap bridge agent protocol |
| `packages/core/aipass-bridge/bridge/package.json` | **PATCH** | เพิ่ม `@modelcontextprotocol/sdk` dependency |
| `~/.hermes/config.yaml` | **PATCH** | เพิ่ม `mcp_servers.aipass_agent` config |

**Implementation:**

```javascript
// packages/core/aipass-bridge/bridge/mcp-agent.mjs
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { execSync } from 'node:child_process';

const ROOT = process.env.AIPASS_AGENT_ROOT || process.cwd();

const server = new Server(
  { name: 'aipass-agent', version: '1.0.0' },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'read_file',
      description: 'Read a text file with line numbers. Supports pagination.',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path (absolute or relative to root)' },
          offset: { type: 'number', description: 'Start line (1-indexed)' },
          limit: { type: 'number', description: 'Max lines' },
        },
        required: ['path'],
      },
    },
    {
      name: 'list_directory',
      description: 'List files and directories.',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Directory path' },
          pattern: { type: 'string', description: 'Regex filter' },
        },
        required: ['path'],
      },
    },
    {
      name: 'search_files',
      description: 'Search text across project files (grep).',
      inputSchema: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'Search text or regex' },
          path: { type: 'string', description: 'Directory to search' },
        },
        required: ['pattern'],
      },
    },
    {
      name: 'edit_file',
      description: 'Edit a file by replacing exact text (FIND/NEW).',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          find: { type: 'string', description: 'Exact text to find (must be unique)' },
          replace: { type: 'string', description: 'Replacement text' },
        },
        required: ['path', 'find', 'replace'],
      },
    },
    {
      name: 'create_file',
      description: 'Create or overwrite a file.',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          content: { type: 'string' },
        },
        required: ['path', 'content'],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params;
  try {
    let result;
    switch (name) {
      case 'read_file': {
        const fp = resolve(ROOT, args.path);
        const content = readFileSync(fp, 'utf8');
        const lines = content.split('\n');
        const offset = (args.offset || 1) - 1;
        const limit = args.limit || 2000;
        result = lines.slice(offset, offset + limit).map((l, i) => `${i + offset + 1}|${l}`).join('\n');
        break;
      }
      case 'list_directory': {
        const dp = resolve(ROOT, args.path);
        let entries = readdirSync(dp, { withFileTypes: true }).map(e => ({
          name: e.name,
          type: e.isDirectory() ? 'directory' : 'file',
        }));
        if (args.pattern) {
          const re = new RegExp(args.pattern, 'i');
          entries = entries.filter(e => re.test(e.name));
        }
        result = JSON.stringify(entries, null, 2);
        break;
      }
      case 'search_files': {
        const searchPath = args.path || ROOT;
        // Use grep for performance
        const cmd = `rg -n "${args.pattern}" ${searchPath} --max-count 50`;
        result = execSync(cmd, { encoding: 'utf8', timeout: 10000 });
        break;
      }
      case 'edit_file': {
        const fp = resolve(ROOT, args.path);
        const content = readFileSync(fp, 'utf8');
        const idx = content.indexOf(args.find);
        if (idx === -1) throw new Error('FIND text not found');
        if (content.indexOf(args.find, idx + 1) !== -1) throw new Error('FIND text is not unique');
        const newContent = content.replace(args.find, args.replace);
        writeFileSync(fp, newContent);
        result = `Edited ${args.path}`;
        break;
      }
      case 'create_file': {
        const fp = resolve(ROOT, args.path);
        writeFileSync(fp, args.content);
        result = `Created ${args.path}`;
        break;
      }
    }
    return { content: [{ type: 'text', text: result }] };
  } catch (err) {
    return { content: [{ type: 'text', text: `Error: ${err.message}` }] };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
```

**Register in Hermes config:**
```bash
hermes config set mcp_servers.aipass_agent.command "node"
hermes config set mcp_servers.aipass_agent.args '["packages/core/aipass-bridge/bridge/mcp-agent.mjs"]'
hermes config set mcp_servers.aipass_agent.timeout 30
```

**ข้อดี:**
- ✅ Native Hermes tools (อ่าน/เข้าใจง่าย)
- ✅ ใช้ bridge models + Hermes orchestration คู่กัน
- ✅ Hermes approval system ทำงานได้
- ✅ เพิ่ม/ลด tools ได้ตามต้องการ

**ข้อเสีย:**
- ❌ ต้อง maintain MCP server เพิ่ม
- ❌ ไม่ได้ใช้ bridge agent protocol โดยตรง (เขียนทับด้วย local execution)

---

### Option 3: Function Calling Passthrough (Long-term — ~50 บรรทัด)

**อธิบาย:** แก้ bridge ให้รับ-ส่งต่อ `tools` parameter ไป de.aipass.net

**สิ่งที่ต้องเข้าใจก่อน:** de.aipass.net ต้องรองรับ function calling ด้วย ถ้าไม่รองรับ ต้อง simulate

**File:** `packages/core/aipass-bridge/bridge/server.mjs`

**เพิ่มใน `chatCompletions()` function:**

```javascript
// รับ tools จาก payload
const tools = Array.isArray(payload.tools) ? payload.tools : null;
const toolChoice = payload.tool_choice || 'auto';

// ส่งต่อไปยัง extension/de.aipass.net
// (ต้องเพิ่ม tools ใน message ที่ส่งไป)
```

**ข้อดี:**
- ✅ ทุก OpenAI client ใช้ bridge ได้ (Hermes, Cline, Cursor, etc.)
- ✅ เป็น standard approach

**ข้อเสีย:**
- ❌ ถ้า de.aipass.net ไม่รองรับ function calling ต้อง simulate (fragile)
- ❌ ต้อง parse model text output เพื่อหา tool_calls (unreliable)
- ❌ อาจต้องแก้ extension ด้วย

---

### Option 4: Hybrid — Hermes Native Tools + Bridge LLM (Best of Both)

**อธิบาย:** ใช้ Hermes native file tools + ใช้ bridge เป็น LLM ผ่าน MCP

**สถาปัตยกรรม:**
```
Hermes Agent
├── File tools (native) ──→ Local filesystem ✅
├── Terminal (native) ────→ Shell commands ✅
└── LLM ─────────────────→ MCP Server → Bridge → de.aipass.net
```

**File:** `packages/core/aipass-bridge/bridge/mcp-llm.mjs`

```javascript
// MCP server ที่ทำหน้าที่เป็น LLM backend
// รับ prompt จาก Hermes → ส่งไป bridge → รับ response → ส่งกลับ
// ไม่มี tools เพราะ Hermes จัดการ file ops เอง
```

**ข้อดี:**
- ✅ Hermes ทำงานเต็ม 100% (file tools + terminal + browser)
- ✅ ใช้ bridge models + credits
- ✅ ไม่ต้อง simulate function calling

**ข้อเสีย:**
- ❌ ต้องสร้อง MCP server เพิ่ม
- ❌ ซับซ้อนกว่า Option 2

---

## คำแนะนำ

| สถานการณ์ | เลือก |
|---|---|
| อยากใช้ได้ทันที ไม่ต้องเขียนโค้ด | **Option 1** — `npm run agent` |
| อยากได้ native Hermes tools + bridge models | **Option 2** — MCP Server |
| อยากใช้ function calling จริงๆ | **Option 3** — ต้องเช็ค de.aipass.net ก่อน |
| อยากได้ best of both worlds | **Option 4** — Hybrid |

**แนะนำ:** เริ่มจาก **Option 2** — สร้าง MCP server ที่ wrap bridge agent protocol เป็น native Hermes tools ใช้เวลา ~150 บรรทัด ได้ผลลัพธ์ที่ดีที่สุด

## Step-by-Step (Option 2)

### Task 1: สร้าง `mcp-agent.mjs`

**File:** `packages/core/aipass-bridge/bridge/mcp-agent.mjs`

(ด้านบน)

**Verify:** `node packages/core/aipass-bridge/bridge/mcp-agent.mjs` — ไม่มี output, รอ stdio

### Task 2: เพิ่ม dependency

**File:** `packages/core/aipass-bridge/bridge/package.json`

```json
{
  "name": "@aipass/bridge-mcp",
  "private": true,
  "type": "module",
  "version": "1.0.0",
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.0"
  }
}
```

**Command:** `cd packages/core/aipass-bridge/bridge && npm install`

### Task 3: Register ใน Hermes config

```bash
hermes config set mcp_servers.aipass_agent.command "node"
hermes config set mcp_servers.aipass_agent.args '["packages/core/aipass-bridge/bridge/mcp-agent.mjs"]'
hermes config set mcp_servers.aipass_agent.timeout 30
hermes config set mcp_servers.aipass_agent.connect_timeout 15
```

### Task 4: Restart Hermes + Verify

1. Restart Hermes Agent
2. ตรวจสอบ startup logs หา `aipass_agent` tools
3. ทดสอบ: "Read package.json using aipass tools"

### Task 5: เพิ่ง `run_command` tool (optional)

เพิ่มใน `mcp-agent.mjs`:
```javascript
{
  name: 'run_command',
  description: 'Run a shell command (requires --allow-run flag).',
  inputSchema: {
    type: 'object',
    properties: {
      command: { type: 'string' },
    },
    required: ['command'],
  },
}
```

---

## Verification Matrix

| Test | Expected |
|---|---|
| `hermes tools list` เห็น `mcp_aipass_*` | ✅ |
| Hermes อ่านไฟล์ผ่าน `mcp_aipass_read_file` | ✅ |
| Hermes ค้นหาไฟล์ผ่าน `mcp_aipass_search_files` | ✅ |
| Hermes แก้ไขไฟล์ผ่าน `mcp_aipass_edit_file` | ✅ |
| Hermes สร้างไฟล์ผ่าน `mcp_aipass_create_file` | ✅ |
| Hermes approval system ทำงานเมื่อสร้าง/แก้ไข | ✅ |

## Risks

| Risk | Mitigation |
|---|---|
| MCP SDK ไม่ได้ติดตั้ง | `pip install mcp` ใน Hermes venv |
| Node module resolution | ติดตั้ง `@modelcontextprotocol/sdk` ใน bridge package |
| Hermes ไม่ discover tools | ตรวจสอบ startup logs, ลอง `/reset` |
| `search_files` ใช้ `rg` (ripgrep) ไม่มี | ติดตั้ง ripgrep หรือเปลี่ยนเป็น `grep -r` |
