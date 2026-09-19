# Configuration & Secret Storage Policy

Applies to **both** bridge projects (`aipass-web-bridge` and `gemini-web-bridge`)
so they stay on one policy.

## Architecture

```
Chrome Extension ──SSE──▶ Cloudflare Worker (Durable Object)
                                │
                                └──▶ de.aipass.net (upstream LLM)
```

**No local development server.** Everything runs on Cloudflare in production.
Develop → test → deploy → verify on production Worker.

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
