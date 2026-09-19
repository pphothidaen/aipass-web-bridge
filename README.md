# AIPASS Web Bridge

Cloudflare Worker สำหรับ AIPASS — Bridge ระหว่าง Chrome Extension ↔ de.aipass.net

## Production

```
https://aipass-web-bridge.taijustarrett417.workers.dev
```

## Repo Structure

```
.
├── cloudflare/              # Cloudflare Worker (Production)
│   ├── worker.js            # Main entry point
│   └── wrangler.toml        # Wrangler config + secrets
├── packages/
│   ├── core/aipass-bridge/
│   │   ├── extension/       # Chrome Extension (connects to CF Worker)
│   │   └── test/            # Test suites (bridge, page, ssrf, red-team)
│   ├── vscode-extension/    # VS Code Extension (connects to CF Worker)
│   └── secretary.py         # Secretary/Middle Gateway
├── release/
│   └── chrome-extension/    # Chrome Extension release copy (mirror)
├── scripts/
│   ├── build-extension.py   # Build Chrome extension + inject token
│   ├── release.mjs          # Release script
│   └── ci_probe.sh          # CI probe script
├── docs/
│   ├── API-SPEC.md          # API specification
│   └── CONFIGURATION.md     # Configuration guide
└── .github/workflows/ci.yml # CI/CD (smoke, blueteam, redteam, deploy)
```

## Development & Deployment

**No local development server.** Develop and test directly on Cloudflare:

1. Clone repo
2. Install deps: `npm install`
3. Run tests: `npm test`
4. Deploy: `cd cloudflare && npx wrangler deploy` (requires `CLOUDFLARE_API_TOKEN`)
5. CI/CD auto-deploys on push to `master` (GitHub Actions)

## Chrome Extension

- Source: `packages/core/aipass-bridge/extension/`
- Release mirror: `release/chrome-extension/`
- Default bridge URL: `https://aipass-web-bridge.taijustarrett417.workers.dev`
- Build artifact: `python scripts/build-extension.py --output release/aipass-bridge-chrome-built`

## VS Code Extension

- Source: `packages/vscode-extension/`
- Default bridge URL: `https://aipass-web-bridge.taijustarrett417.workers.dev`

## Documentation

- [Development Workflow](docs/DEVELOPMENT.md) — Local dev, testing, deployment
- [API Specification](docs/API-SPEC.md) — Unified Bridge API
- [Configuration](docs/CONFIGURATION.md) — Secret storage policy

## License

MIT
