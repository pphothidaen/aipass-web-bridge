# Unified Bridge API Spec

Single contract that both **aipass-web-bridge** and **gemini-web-bridge**
implement, so clients (Hermes, Secretary, VS Code extension, OpenAI SDKs) can
point at either hub without code changes.

## Concepts (shared)

- **No upstream credentials on the server.** The hub never sees the provider
  session; a browser extension (MV3) holds the logged-in page and executes jobs.
  Hub ⇄ extension transport differs (SSE job-push for aipass, WebSocket for
  gemini) but the client-facing contract below is identical.
- **Fail fast, never fabricate**: missing extension → `503 extension
  disconnected`; unverified model → `422 model_unverified`; saturated queue →
  `429 queue_full`.
- **OpenAI-compatible error envelope** on all errors:
  `{"error":{"message":string,"type":string,"code":string}}`.

## Auth

| Role | Who | Credential | Header |
|---|---|---|---|
| API client | Hermes / SDKs / MCP | `CLIENT_API_KEY` | `Authorization: Bearer` |
| Extension | browser extension | `BRIDGE_SECRET` | `x-bridge-token` or `?token=` |

- Public without auth: `GET /`, `GET /status`, `GET /health`.
- Failure: `401` with envelope `code: "invalid_api_key"`.
- Worker with no secrets configured: `503 code: "secrets_unconfigured"`.

## Client-facing routes

### `GET /v1/models`
```json
{"object":"list","catalogRevision":"<uuid>",
 "default_model":"<id>","default_recommended":"<id>",
 "data":[{"id","object":"model","created":0,"owned_by","name","description",
          "kind":"chat|image|video|music|research","tier","use_case",
          "is_default":false,"thinking":false,"free_credit":false}]}
```
Both hubs use `default_model`/`default_recommended` as synonyms for client
compatibility.

### `POST /v1/chat/completions`
OpenAI request/response. Extras:
- Request extensions: `model` (may be prefixed `aipass/`), `attachments`
  (`[{type:"image"|"file", data:"data:...", filename?}]`), media options
  (`aspect_ratio`, `image_style`, `video_options`), `thinking_level`.
- `stream:true` → SSE chunks `chat.completion.chunk` … `data: [DONE]`.
- Non-streaming → `chat.completion` with `usage` (estimated `ceil(chars/4)`).
- Errors: `503` (extension disconnected / `unavailable`), `422`
  `model_unverified`, `429` `queue_full`/`rate_limit`, `502` `upstream_error`.

### `POST /mcp` (JSON-RPC 2.0)
- `initialize`, `tools/list`, `tools/call`.
- aipass tools: `aipass_chat`, `aipass_list_models`, `aipass_status`.
- gemini tools: `sdlc_solution_architect`, `check_bridge_health`, … (superset).
- Unknown method: `-32601`; unknown tool: `-32602`.

### Health / status
`GET /status` (aipass) and `GET /health` (both) return a JSON object with
`extension: "CONNECTED"|"OFFLINE"`-style state, never containing secrets.

## Hub ⇄ extension protocol (aipass flavor)

- Extension consumes SSE `GET /ext/events`: events `ready {clientId}`,
  `job {jobId, kind: chat|create|loader|assistant|video, …}`, `abort`,
  `reload_extension`, `reload_tab`; heartbeat comment every 15s.
- Extension POSTs results: `/ext/chunk {jobId, parts}`, `/ext/done
  {jobId, finishReason}`, `/ext/error {jobId, message}`, `/ext/loader
  {jobId, raw?, message?}`, `/ext/tab {tabId, url, jobId, kind}`.
- Job timeouts: 120s chat/create, 30s others; FIFO queue max 10.
