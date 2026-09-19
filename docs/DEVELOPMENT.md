# Development Workflow

## Overview

```
Local Dev → Dev Deploy → Production Deploy
(wrangler dev)  (preview env)   (master push)
```

**No local Node.js bridge.** Everything runs on Cloudflare runtime:
- `wrangler dev` simulates Worker + Durable Objects on localhost
- `wrangler deploy --env dev` deploys to a preview/staging environment
- Production deploys on push to `master` via CI/CD

## Prerequisites

```bash
# Install wrangler
npm install -g wrangler

# Or use npx (already configured)
npx wrangler --version

# Authenticate
npx wrangler login
```

## Local Development

### 1. Set up secrets for local dev

Create `cloudflare/.dev.vars` (git-ignored):

```bash
cd cloudflare
echo "BRIDGE_SECRET=your-dev-secret" >> .dev.vars
echo "CLIENT_API_KEY=your-dev-api-key" >> .dev.vars
```

Or use Doppler (recommended):

```bash
doppler run -- npx wrangler dev
```

### 2. Start local Worker

```bash
cd cloudflare
npx wrangler dev --env dev
```

This starts a local server (default: `localhost:8787`) that simulates:
- Cloudflare Worker runtime
- Durable Objects (`ExtHub`)
- Environment variables (from `.dev.vars`)

### 3. Point Chrome extension to local dev

In Chrome extension popup:
1. Check "Custom bridge URL"
2. Enter: `http://localhost:8787`
3. Click "Save & Test"

### 4. Test changes

```bash
# Run all tests
npm test

# Run specific test suite
node --test packages/core/aipass-bridge/test/bridge.test.mjs
```

### 5. Deploy to dev/staging

```bash
cd cloudflare
npx wrangler deploy --env dev
```

Get a preview URL (e.g., `https://aipass-web-bridge-dev.<account>.workers.dev`) for testing.

## Production Deploy

### Via CI/CD (recommended)

```bash
git push origin master
```

GitHub Actions runs:
1. `smoke` — syntax check + production health
2. `blueteam` — security scan
3. `redteam` — adversarial tests
4. `deploy` — deploys to production

### Manual deploy

```bash
cd cloudflare
npx wrangler deploy
```

Requires `CLOUDFLARE_API_TOKEN` env var.

## File Structure

```
cloudflare/
├── worker.js          # Main Worker entry
├── wrangler.toml      # Config + Durable Objects + migrations
└── .dev.vars          # Local secrets (git-ignored, create this)
```

## Scripts

```bash
# Local dev with live reload
npx wrangler dev

# Deploy to dev environment
npx wrangler deploy --env dev

# Deploy to production
npx wrangler deploy

# View logs
npx wrangler tail
```

## Testing

```bash
# Unit tests (Node:test)
npm test

# Live smoke (requires extension connected)
curl http://localhost:8787/status

# Health check
curl http://localhost:8787/health
```

## Troubleshooting

| Problem | Solution |
|---------|----------|
| `wrangler dev` fails to start | Check `wrangler.toml` syntax |
| Durable Objects not working | Run `wrangler dev --local` first time to initialize |
| Secrets missing | Create `cloudflare/.dev.vars` with `BRIDGE_SECRET` and `CLIENT_API_KEY` |
| Extension won't connect to local | Make sure `http://localhost:8787` is in `host_permissions` |
| Port 8787 in use | Change port: `wrangler dev --port 8788` |
