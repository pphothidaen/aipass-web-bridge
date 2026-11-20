# Configuration & Secret Storage Policy

Applies to **both** bridge projects (`aipass-web-bridge` and `gemini-web-bridge`)
so they stay on one policy.

## Architecture

```
Chrome Extension ──SSE──▶ Cloudflare Worker (Durable Object)
                                │
                                ├──▶ de.aipass.net (AiPASS upstream LLM)
                                └──▶ https://vertexaisearch.cloud.google/
                                    (Gemini Enterprise / Vertex AI Search upstream LLM)
```

**No local development server.** Everything runs on Cloudflare in production.
Develop → test → deploy → verify on production Worker.

## Provider routing and Gemini Enterprise

- **AiPASS**: provider identifier `aipass`; live tab at
  `https://de.aipass.net/chat`; model IDs such as `gemini-3.5-flash-lite` and
  `gemini-3.1-flash-lite` dispatch to the AiPASS session.
- **Gemini Enterprise / Vertex AI Search**: provider identifier `vertex`; live tab
  at `https://vertexaisearch.cloud.google/`; Gemini Enterprise model ID is
  `gemini-enterprise-vertex`.
- Default model can be changed through the bridge client API (`POST /config`);
  examples include `gemini-enterprise-vertex` for Gemini Enterprise and
  `aipass/default` for AiPASS.

Routing is provider-aware and fail-closed; it does not silently cross-provider
fallback when the selected provider is unavailable.

## Storage precedence (highest wins)

| Order | Source | What lives there | How it is read |
|---|---|---|---|
| 1 | **Doppler** | Secrets (tokens, API keys) | `doppler run -- <cmd>` or `doppler secrets download` |
| 2 | **Cloudflare** | `wrangler.toml [vars]` (non-secret) + Worker bindings (`BRIDGE_SECRET`, `CLIENT_API_KEY`) | `env.*` in Worker |
| 3 | Schema defaults | Safe defaults in `cloudflare/worker.js` | Hard-coded in code |

Rules:

1. **Secret values are never committed** — not in code, not in docs. Worker returns
   `503 secrets_unconfigured` if secrets are missing (fail fast).
2. Cloudflare secrets are write-only; rotate by writing to Doppler first,
   then `wrangler secret put` from the Doppler value.

## Cloudflare Worker secrets

```bash
cd cloudflare
npx wrangler secret put BRIDGE_SECRET    # extension channel (/ext/*)
npx wrangler secret put CLIENT_API_KEY   # API/MCP clients
```

## Deployment

```bash
cd cloudflare
npx wrangler deploy
```

CI/CD auto-deploys on push to `master` via GitHub Actions.
