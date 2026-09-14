# Plan: Bridge `/v1/files/*` + Hermes Agent Integration

**Date:** 2026-09-07
**Goal:** Expose the bridge server's file operations (`/v1/files/read`, `/v1/files/list`) as native Hermes Agent tools via the built-in MCP client.

## Current Context

- **Bridge server** (`packages/core/aipass-bridge/bridge/server.mjs`) is running on `http://127.0.0.1:8787` with two new endpoints:
  - `POST /v1/files/read` — reads a local file with pagination
  - `POST /v1/files/list` — lists directory contents with optional regex filter
- **Hermes Agent** already has file tools (`read_file`, `write_file`, `search_files`) that work locally. The bridge endpoints are for **remote/unified HTTP access** (e.g., other clients, scripts).
- **Hermes native MCP client** auto-discovers tools from MCP servers defined in `~/.hermes/config.yaml` under `mcp_servers`. Tools appear as `mcp_{server}_{tool}`.

## Approach

Build a **thin MCP server** (Node.js ESM, ~80 LOC) that:
1. Starts as a stdio MCP server (per Hermes convention)
2. Exposes two tools: `read_file` and `list_directory`
3. Each tool HTTP POSTs to the bridge at `http://127.0.0.1:8787/v1/files/*` and returns the result
4. Hermes connects via `mcp_servers.aipass_files` config entry

This keeps the bridge as the single source of truth for file access logic while making the tools native to Hermes.

## File Map

| File | Action | Purpose |
|---|---|---|
| `packages/core/aipass-bridge/bridge/mcp-server.mjs` | **CREATE** | MCP server wrapping bridge `/v1/files/*` |
| `~/.hermes/config.yaml` (mcp_servers section) | **PATCH** | Register `aipass_files` MCP server |

## Step-by-Step

### Task 1: Create `mcp-server.mjs`

**File:** `packages/core/aipass-bridge/bridge/mcp-server.mjs`

```javascript
// MCP server wrapping the aipass bridge /v1/files/* endpoints.
// Registers as a Hermes MCP tool source — tools appear as
// mcp_aipass_files_read_file and mcp_aipass_files_list_directory.
//
// Run via: node packages/core/aipass-bridge/bridge/mcp-server.mjs
// Hermes config: mcp_servers.aipass_files.command = "node"
//                mcp_servers.aipass_files.args = ["packages/core/aipass-bridge/bridge/mcp-server.mjs"]

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
      description: 'Read a file from the local filesystem with pagination. Returns line-numbered content.',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Absolute path to the file' },
          offset: { type: 'number', description: 'Starting line (1-indexed, default 1)' },
          limit: { type: 'number', description: 'Max lines to read (default 2000)' },
        },
        required: ['path'],
      },
    },
    {
      name: 'list_directory',
      description: 'List files and directories in a path, with optional regex filter.',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Absolute path to directory' },
          pattern: { type: 'string', description: 'Optional regex to filter names' },
          limit: { type: 'number', description: 'Max entries (default 50)' },
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
    if (!res.ok) {
      return { content: [{ type: 'text', text: `Error ${res.status}: ${data.error?.message || JSON.stringify(data)}` }] };
    }
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
  } catch (err) {
    return { content: [{ type: 'text', text: `Bridge request failed: ${err.message}` }] };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
```

**Verify:** Run `node packages/core/aipass-bridge/bridge/mcp-server.mjs` — should produce no output and wait for stdio.

### Task 2: Add `@modelcontextprotocol/sdk` dependency

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

**Expected:** `@modelcontextprotocol/sdk` added to `node_modules`.

### Task 3: Register MCP server in Hermes config

**File:** `~/.hermes/config.yaml` (use `hermes config` — never hand-edit)

```bash
hermes config set mcp_servers.aipass_files.command "node"
hermes config set mcp_servers.aipass_files.args '["packages/core/aipass-bridge/bridge/mcp-server.mjs"]'
hermes config set mcp_servers.aipass_files.timeout 30
hermes config set mcp_servers.aipass_files.connect_timeout 15
```

**Verify:** `hermes config get mcp_servers` — should show the `aipass_files` entry.

### Task 4: Restart Hermes and verify tools

1. Restart Hermes Agent (or `/reset` if already running).
2. Check startup logs: look for `aipass_files` tool discovery.
3. Ask the agent: "What tools do you have matching `aipass`?"
4. Expected: agent lists `mcp_aipass_files_read_file` and `mcp_aipass_files_list_directory`.

### Task 5: E2E verification

Ask Hermes: "Read the first 5 lines of `/Users/kimlenglim/Project/aipass-dev-suite/package.json` using the aipass file tool."

Expected: tool call to `mcp_aipass_files_read_file` with `{"path":"...","limit":5}` → returns line-numbered JSON content.

Ask Hermes: "List files matching `.*\.json` in `/Users/kimlenglim/Project/aipass-dev-suite`."

Expected: tool call to `mcp_aipass_files_list_directory` → returns filtered entries.

## Risks & Tradeoffs

| Risk | Mitigation |
|---|---|
| Bridge server not running when Hermes tries to call it | MCP tool returns clear error; Hermes file toolset remains as fallback |
| MCP SDK not installed in Hermes's Python venv | Check with `pip list \| grep mcp`; install if missing |
| Node.js `mcp-server.mjs` can't resolve `@modelcontextprotocol/sdk` | Install in `packages/core/aipass-bridge/bridge/` or globally |
| Stdio transport conflicts with Hermes's own stdio | Hermes MCP client manages subprocess lifecycle — no conflict |
| Tool name collision with built-in `read_file` | MCP tools are prefixed `mcp_aipass_files_*` — no collision |

## Open Questions

1. Should we also expose `write_file` and `search_files` via the bridge, or keep those local-only? (Recommendation: keep local-only for now — Hermes's native tools are superior for write/search.)
2. Should the MCP server read `AIPASS_BRIDGE_URL` from env, or hardcode `127.0.0.1:8787`? (Recommendation: env with default — matches bridge's own pattern.)
3. Auth on bridge endpoints? Currently none (local only). If the bridge ever moves to a remote host, add `headers` config to MCP server.

## Done When

- `mcp-server.mjs` exists and starts without error
- `hermes config get mcp_servers.aipass_files` returns the configured entry
- After restart, Hermes logs show `aipass_files` tools discovered
- Agent can successfully call `mcp_aipass_files_read_file` and `mcp_aipass_files_list_directory`
