# Configuration & Secret Storage Policy

Applies to **both** bridge projects (`aipass-web-bridge` and `gemini-web-bridge`)
so they stay on one policy.

## Storage precedence (highest wins)

| Order | Source | What lives there | How it is read |
|---|---|---|---|
| 1 | **Doppler** | Secrets (tokens, API keys) per project/config | `doppler run -- <cmd>` injects into env, or the bridge fetches via `doppler secrets download --project <p> --config <c> --no-file --format env` |
| 2 | **Cloudflare** | Non-secret deployment vars in `cloudflare/wrangler.toml [vars]`; secret *values* only as Worker bindings (`BRIDGE_SECRET`, `CLIENT_API_KEY`) — unreadable by design | Worker reads `env.*`; local bridge parses `[vars]` |
| 3 | **`.env`** | Local developer overrides, never committed | `packages/core/aipass-bridge/.env` (loaded by `bridge/config.mjs`, no override of layers 1–2) |
| 4 | Schema defaults | Safe, non-secret defaults | Declared in `bridge/config.mjs` |

Rules:

1. **Secret values are never committed** — not in code, not in comments, not in
   docs. The Cloudflare Worker has no hard-coded fallback tokens; if
   `BRIDGE_SECRET`/`CLIENT_API_KEY` are missing the worker returns
   `503 secrets_unconfigured` (fail fast, never fabricate).
2. **Non-secret deployment config** (model names, feature flags, ports) may be
   duplicated into Doppler and/or `[vars]` — precedence resolves it.
3. Cloudflare secret values are write-only; rotate by writing to Doppler first,
   then `wrangler secret put` from the Doppler value.

## Local bridge usage

```bash
# Layer 1 — Doppler (recommended for secrets)
doppler run -- npm run start        # packages/core/aipass-bridge

# Layer 2 — non-secret defaults from cloudflare/wrangler.toml [vars]
# Layer 3 — optional local overrides
cp packages/core/aipass-bridge/.env.example packages/core/aipass-bridge/.env
```

`bridge/server.mjs` resolves every setting through `loadConfig()` in
`bridge/config.mjs`; behavior with no Doppler and no `.env` is identical to the
previous hard-coded defaults.

## Cloudflare Worker secrets

```bash
cd cloudflare
npx wrangler secret put BRIDGE_SECRET    # extension channel (/ext/*, x-bridge-token)
npx wrangler secret put CLIENT_API_KEY   # API/MCP clients (Authorization: Bearer)
```

Auth model matches gemini-web-bridge: two roles, one shared-token option
(`BRIDGE_TOKEN`), public `GET /` `/status` `/health` only, and an OpenAI-style
error envelope `{"error":{"message","type","code"}}` on failure.
