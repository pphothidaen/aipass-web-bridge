# Plan: Hermes Agent + Bridge → Local Coding Agent

**Date:** 2026-09-07
**Goal:** Configure Hermes Agent to use the local bridge (`http://127.0.0.1:8787`) as its LLM backend while leveraging its native file/terminal/browser tools to autonomously develop code from the local project source.

## Current State

- **Bridge** (`packages/core/aipass-bridge/bridge/server.mjs`) runs on `http://127.0.0.1:8787`
  - `POST /v1/chat/completions` — LLM inference (OpenAI-compatible)
  - `POST /v1/files/read` — read local files
  - `POST /v1/files/list` — list directories
  - `GET /v1/models` — list available models
- **Hermes Agent** already configured with `model.provider: custom`, `model.base_url: http://127.0.0.1:8787/v1`
- **Hermes native tools** already work: `read_file`, `write_file`, `search_files`, `terminal`, `browser`, `web_search`

## The Gap

The bridge's file endpoints exist but Hermes doesn't use them — it uses its own native file tools. This is actually **correct** because:
1. Hermes native file tools are faster (no HTTP round-trip)
2. Hermes has better security (approval system, sandbox)
3. Hermes has more features (Office/PDF extraction, binary detection)

The real question is: **How do we make the Hermes + bridge combination an effective coding agent?**

## Approach

1. **Keep Hermes native file tools** — they're superior to the bridge's file endpoints
2. **Use the bridge purely as an LLM backend** — it translates Hermes's tool calls into model API calls
3. **Add a coding-specific system prompt** via `~/.hermes/AGENTS.md` to guide the agent's behavior
4. **Optionally add bridge file tools via MCP** for redundancy/unified access
5. **Verify the full loop**: read code → reason → edit → test → iterate

## File Map

| File | Action | Purpose |
|---|---|---|
| `~/.hermes/AGENTS.md` | **CREATE/PATCH** | Project-specific coding rules for the agent |
| `~/.hermes/config.yaml` | **PATCH** | Ensure model + tool configuration is optimal |
| `packages/core/aipass-bridge/bridge/mcp-server.mjs` | **CREATE** | (Optional) MCP wrapper for bridge file tools |

## Step-by-Step

### Task 1: Verify current Hermes model config

**Command:** `hermes config get model`

**Expected output:**
```
default: gpt-5.6-terra
provider: custom
base_url: http://127.0.0.1:8787/v1
api_key: not-needed
```

If not set, run:
```bash
hermes config set model.provider custom
hermes config set model.base_url "http://127.0.0.1:8787/v1"
hermes config set model.api_key "not-needed"
hermes config set model.default "gpt-5.6-terra"
```

### Task 2: Create project-level AGENTS.md

**File:** `~/.hermes/AGENTS.md`

```markdown
# Project: aipass-dev-suite

## Project Overview
AI Pass Dev Suite — a monorepo with VS Code extension and shared packages.
- `packages/shared` — shared utilities
- `packages/vscode-extension` — VS Code extension (main product)
- `packages/core/aipass-bridge` — local bridge to de.aipass.net

## Coding Rules
1. **Always read before editing** — use `read_file` to understand existing code before making changes
2. **Search first** — use `search_files` to find related code, not grep
3. **Test after changes** — run `npm test` after any code modification
4. **Build before release** — run `npm run build` before packaging
5. **Version bump** — increment version in `package.json` for any user-facing change
6. **Changelog** — document changes in `CHANGELOG.md`

## Architecture Decisions
- The bridge (`packages/core/aipass-bridge/bridge/server.mjs`) is a local HTTP proxy to de.aipass.net
- It uses SSE to communicate with the Chrome extension
- The extension performs real requests with user credentials
- Never put secrets in the bridge — it has no auth

## File Conventions
- `.mjs` for ESM modules, `.ts` for TypeScript
- Tests in `scripts/` or `test/` directories
- Use `node --test` for testing (built-in test runner)

## Tool Usage
- Use `read_file` with pagination for large files (offset/limit)
- Use `search_files` with regex for finding patterns
- Use `terminal` for git, npm, builds
- Use `browser` for documentation/research only
- Use `web_search` for finding external resources
```

**Command:** `cat > ~/.hermes/AGENTS.md << 'EOF'`
(paste content above)

**Verify:** `cat ~/.hermes/AGENTS.md | head -5`

### Task 3: Verify tool availability

**Command:** `hermes tools list`

**Expected:** All core tools enabled: `file`, `terminal`, `browser`, `web`, `search`, `vision`, `memory`, `skills`

If any missing:
```bash
hermes tools enable file
hermes tools enable terminal
hermes tools enable browser
hermes tools enable web
hermes tools enable search
```

### Task 4: Test the agent loop

Start a new Hermes session and ask:

```
Read packages/vscode-extension/src/extension.ts and tell me what it does.
```

**Expected behavior:**
1. Hermes calls `read_file` tool → reads the file locally
2. Hermes sends content to bridge model for inference
3. Hermes returns the model's analysis

**Verification:** Response should accurately describe the extension's functionality.

### Task 5: Test code modification

Ask:

```
Add a console.log('bridge connected') at the top of packages/core/aipass-bridge/bridge/server.mjs
```

**Expected behavior:**
1. Hermes reads the file first
2. Hermes uses `write_file` or `patch` to add the line
3. Hermes confirms the change

**Verification:** `head -20 packages/core/aipass-bridge/bridge/server.mjs` should show the new line.

### Task 6: Test search + edit workflow

Ask:

```
Find all files that import from @aipass/shared and list them.
```

**Expected behavior:**
1. Hermes calls `search_files` with pattern `@aipass/shared`
2. Hermes returns matching files with line numbers

### Task 7: Test terminal integration

Ask:

```
Run npm test and tell me the results.
```

**Expected behavior:**
1. Hermes calls `terminal` with `npm test`
2. Hermes captures output
3. Hermes summarizes results

### Task 8: (Optional) Add bridge file tools via MCP

If you want the agent to also access bridge file endpoints (for redundancy or unified access):

**File:** `packages/core/aipass-bridge/bridge/mcp-server.mjs`

```javascript
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const BRIDGE_URL = process.env.AIPASS_BRIDGE_URL || 'http://127.0.0.1:8787';

const server = new Server(
  { name: 'aipass-files', version: '1.0.0' },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'read_file',
      description: 'Read a file via the aipass bridge',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          offset: { type: 'number' },
          limit: { type: 'number' },
        },
        required: ['path'],
      },
    },
    {
      name: 'list_directory',
      description: 'List directory via the aipass bridge',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          pattern: { type: 'string' },
          limit: { type: 'number' },
        },
        required: ['path'],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params;
  const endpoint = name === 'read_file' ? '/v1/files/read' : '/v1/files/list';
  try {
    const res = await fetch(`${BRIDGE_URL}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
    });
    const data = await res.json();
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
  } catch (err) {
    return { content: [{ type: 'text', text: `Error: ${err.message}` }] };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
```

**Register in config:**
```bash
hermes config set mcp_servers.aipass_files.command "node"
hermes config set mcp_servers.aipass_files.args '["packages/core/aipass-bridge/bridge/mcp-server.mjs"]'
hermes config set mcp_servers.aipass_files.timeout 30
```

**Restart Hermes** — tools appear as `mcp_aipass_files_read_file` and `mcp_aipass_files_list_directory`.

## Verification Matrix

| Test | Command | Expected |
|---|---|---|
| Model inference | `hermes chat -q "say hello"` | Returns "hello" from bridge model |
| File read | Ask agent to read a file | Uses `read_file` tool, returns content |
| File search | Ask agent to find pattern | Uses `search_files`, returns matches |
| Terminal | Ask agent to run `npm test` | Uses `terminal`, returns test results |
| Code edit | Ask agent to add a line | Uses `patch`/`write_file`, confirms change |
| Browser | Ask agent to search docs | Uses `browser`/`web_search` |
| Full loop | "Fix the bug in X and test it" | Reads → reasons → edits → tests → reports |

## Risks & Mitigations

| Risk | Mitigation | Severity |
|---|---|---|
| Bridge server down | Hermes returns clear error; restart bridge with `node packages/core/aipass-bridge/bridge/server.mjs` | High |
| Model returns poor code | Use better model (`claude-sonnet-5@default`); add more context in AGENTS.md | Medium |
| Agent makes unwanted changes | Hermes approval system blocks destructive ops; use `approvals.mode: smart` | Low |
| Large files exceed context | Use pagination (`offset`/`limit`); summarize before sending to model | Medium |
| Tool name collision | MCP tools prefixed `mcp_aipass_files_*` — no collision with native `read_file` | None |

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                      Hermes Agent                            │
│                                                             │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐   │
│  │ read_file │  │write_file│  │search_   │  │ terminal │   │
│  │ (native)  │  │ (native) │  │files     │  │ (native) │   │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘   │
│       │              │              │              │         │
│  ┌────┴──────────────┴──────────────┴──────────────┴─────┐  │
│  │              Tool Orchestration Layer                  │  │
│  └────────────────────────┬──────────────────────────────┘  │
│                           │                                 │
│                    ┌──────┴──────┐                          │
│                    │ LLM Call    │                          │
│                    └──────┬──────┘                          │
└───────────────────────────┼─────────────────────────────────┘
                            │
                            │ HTTP POST /v1/chat/completions
                            │
┌───────────────────────────┼─────────────────────────────────┐
│                           ▼                                 │
│              Bridge Server (127.0.0.1:8787)                 │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  /v1/chat/completions → de.aipass.net API            │  │
│  │  /v1/files/read       → local filesystem             │  │
│  │  /v1/files/list       → local filesystem             │  │
│  │  /v1/models           → model list                   │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## Done When

- [ ] `hermes config get model` shows bridge as provider
- [ ] `~/.hermes/AGENTS.md` exists with project rules
- [ ] `hermes chat -q "hello"` returns response from bridge model
- [ ] Agent can read, search, edit, and test code in the project
- [ ] Full loop works: read → reason → edit → test → report
- [ ] (Optional) MCP file tools registered and working
