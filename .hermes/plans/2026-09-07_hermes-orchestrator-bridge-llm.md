# Plan: Hermes Agent as Orchestrator + Bridge as LLM Backend

**Date:** 2026-09-07
**Goal:** Configure Hermes Agent to use the local bridge (`http://127.0.0.1:8787`) as its sole LLM backend while keeping all file/terminal/browser operations native to Hermes.

## Current Context

- **Bridge server** (`packages/core/aipass-bridge/bridge/server.mjs`) runs on `http://127.0.0.1:8787`
  - `POST /v1/chat/completions` — OpenAI-compatible LLM inference
  - `GET /v1/models` — model list
  - `GET /health` — health + credits
- **Hermes Agent** already has `model.provider: custom`, `model.base_url: http://127.0.0.1:8787/v1` set
- **Hermes native tools** (`read_file`, `write_file`, `search_files`, `terminal`, `browser`) work locally without the bridge
- **Bridge file endpoints** (`/v1/files/read`, `/v1/files/list`) exist but are **redundant** — Hermes native file tools are faster, safer, and more capable

## Architecture

```
Hermes Agent (orchestrator)
├── File tools (native) ──→ Local filesystem
├── Terminal (native) ────→ Shell commands
├── Browser (native) ─────→ Web/docs
└── LLM call ─────────────→ Bridge (127.0.0.1:8787/v1)
                              └──→ de.aipass.net API
```

The bridge is **LLM-only**. All file I/O stays native.

## Step-by-Step

### Task 1: Verify Hermes model config

**Command:**
```bash
hermes config get model
```

**Expected output:**
```
default: gpt-5.6-terra
provider: custom
base_url: http://127.0.0.1:8787/v1
api_key: not-needed
```

**If not set, run:**
```bash
hermes config set model.provider custom
hermes config set model.base_url "http://127.0.0.1:8787/v1"
hermes config set model.api_key "not-needed"
hermes config set model.default "gpt-5.6-terra"
```

**Verify:** `hermes config get model` shows the above.

### Task 2: Create project-level AGENTS.md

**File:** `~/.hermes/AGENTS.md`

**Content:**
```markdown
# Project: aipass-dev-suite

## Overview
AI Pass Dev Suite — monorepo with VS Code extension and shared packages.

## Structure
- `packages/shared` — shared utilities (build first)
- `packages/vscode-extension` — VS Code extension (main product)
- `packages/core/aipass-bridge` — local bridge to de.aipass.net

## Coding Rules
1. **Read before edit** — always `read_file` before making changes
2. **Search first** — use `search_files` to find related code
3. **Test after changes** — run `npm test` after code modifications
4. **Build before release** — `npm run build` before packaging
5. **Version bump** — increment `package.json` version for user-facing changes
6. **Changelog** — document in `CHANGELOG.md`

## Bridge Architecture
- Bridge (`packages/core/aipass-bridge/bridge/server.mjs`) is a local HTTP proxy
- Uses SSE to communicate with Chrome extension
- Extension performs real requests with user credentials
- **Never put secrets in the bridge** — it has no auth

## Tool Usage
- `read_file` with pagination for large files (offset/limit)
- `search_files` with regex for finding patterns
- `terminal` for git, npm, builds
- `browser` for documentation/research only
```

**Command:**
```bash
cat > ~/.hermes/AGENTS.md << 'AGENTSEOF'
# Project: aipass-dev-suite

## Overview
AI Pass Dev Suite — monorepo with VS Code extension and shared packages.

## Structure
- `packages/shared` — shared utilities (build first)
- `packages/vscode-extension` — VS Code extension (main product)
- `packages/core/aipass-bridge` — local bridge to de.aipass.net

## Coding Rules
1. **Read before edit** — always `read_file` before making changes
2. **Search first** — use `search_files` to find related code
3. **Test after changes** — run `npm test` after code modifications
4. **Build before release** — `npm run build` before packaging
5. **Version bump** — increment `package.json` version for user-facing changes
6. **Changelog** — document in `CHANGELOG.md`

## Bridge Architecture
- Bridge (`packages/core/aipass-bridge/bridge/server.mjs`) is a local HTTP proxy
- Uses SSE to communicate with Chrome extension
- Extension performs real requests with user credentials
- **Never put secrets in the bridge** — it has no auth

## Tool Usage
- `read_file` with pagination for large files (offset/limit)
- `search_files` with regex for finding patterns
- `terminal` for git, npm, builds
- `browser` for documentation/research only
AGENTSEOF
```

**Verify:** `head -5 ~/.hermes/AGENTS.md` shows `# Project: aipass-dev-suite`

### Task 3: Verify tool availability

**Command:**
```bash
hermes tools list
```

**Expected:** Core tools enabled: `file`, `terminal`, `browser`, `web`, `search`, `vision`, `memory`, `skills`

**If missing:**
```bash
hermes tools enable file
hermes tools enable terminal
hermes tools enable browser
hermes tools enable web
hermes tools enable search
```

### Task 4: Test LLM inference via bridge

**Command:**
```bash
hermes chat -q "Say hello in one word"
```

**Expected output:** `Hello!` (or similar short response from bridge model)

**If error:** Check bridge is running: `curl http://127.0.0.1:8787/health`

### Task 5: Test file read (native tool)

**Ask Hermes:**
```
Read the first 10 lines of packages/core/aipass-bridge/bridge/server.mjs
```

**Expected behavior:**
1. Hermes calls `read_file` tool (native, not bridge)
2. Returns line-numbered content
3. No HTTP call to bridge for file content

**Verify:** Response shows file content with line numbers.

### Task 6: Test file search (native tool)

**Ask Hermes:**
```
Find all files importing from @aipass/shared
```

**Expected behavior:**
1. Hermes calls `search_files` tool
2. Returns matching files with line numbers

### Task 7: Test terminal (native tool)

**Ask Hermes:**
```
Run npm test and summarize the results
```

**Expected behavior:**
1. Hermes calls `terminal` tool
2. Captures test output
3. Summarizes results

### Task 8: Test code edit (native tool)

**Ask Hermes:**
```
Add a comment line "// test-marker" at the top of packages/core/aipass-bridge/bridge/server.mjs, then remove it
```

**Expected behavior:**
1. Hermes reads the file first
2. Uses `patch` to add the line
3. Uses `patch` again to remove it
4. Confirms the file is unchanged

**Verify:** `head -5 packages/core/aipass-bridge/bridge/server.mjs` shows original content.

### Task 9: Full coding loop test

**Ask Hermes:**
```
Read packages/vscode-extension/src/extension.ts, find the activate function, and tell me what it does
```

**Expected behavior:**
1. Hermes reads the file (native tool)
2. Sends content to bridge model for inference
3. Returns analysis of the activate function

## Verification Matrix

| Test | Tool Used | Bridge Called? |
|---|---|---|
| LLM inference | `hermes chat -q` | ✅ Yes (LLM only) |
| File read | `read_file` (native) | ❌ No |
| File search | `search_files` (native) | ❌ No |
| Terminal | `terminal` (native) | ❌ No |
| Code edit | `patch`/`write_file` (native) | ❌ No |
| Full coding loop | native tools + bridge LLM | ✅ Yes (LLM only) |

## Risks & Mitigations

| Risk | Mitigation | Severity |
|---|---|---|
| Bridge server down | Restart: `node packages/core/aipass-bridge/bridge/server.mjs &` | High |
| Model returns poor code | Switch model: `/model aipass/claude-sonnet-5@default` | Medium |
| Agent makes unwanted changes | Hermes approval system blocks destructive ops | Low |
| Large files exceed context | Use pagination (`offset`/`limit`) | Medium |

## Done When

- [ ] `hermes config get model` shows bridge as provider
- [ ] `~/.hermes/AGENTS.md` exists with project rules
- [ ] `hermes chat -q "hello"` returns response from bridge model
- [ ] Agent can read, search, edit, and test code using native tools
- [ ] Full loop works: read → reason (bridge LLM) → edit → test → report
