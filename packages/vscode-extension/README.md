# AiPASS Dev Suite

**Use `de.aipass.net` from VS Code with a local bridge, project context controls, and an integrated chat sidebar.**

AiPASS Dev Suite connects VS Code to your own signed-in `de.aipass.net` browser session. Your browser keeps the session credential; the local bridge coordinates requests and the extension provides the VS Code experience.

## Features

- **Chat sidebar** — ask questions about your active file or workspace.
- **Model discovery** — load available AiPASS chat models from the bridge.
- **Project context** — send bounded coding and workspace context with a versioned context format.
- **Default-deny controls** — coding and project context are enabled by default; identity and memory remain off until explicitly enabled.
- **Local audit metadata** — record which context sections were used without storing full prompts.
- **Bridge lifecycle** — start the local bridge and test the connection from VS Code.
- **OpenAI-compatible backend** — uses the existing AiPASS bridge and Chrome extension transport.

## Prerequisites

1. Node.js 20 or newer.
2. Google Chrome or Chromium.
3. A signed-in `de.aipass.net/chat` tab.
4. VS Code 1.85 or newer.

> The Chrome extension remains required. It runs the real request inside the signed-in AiPASS tab so the bridge does not handle your browser session cookie.

## Quick start

1. Load `packages/core/aipass-bridge/extension` in `chrome://extensions` with Developer mode enabled.
2. Open `https://de.aipass.net/chat` and sign in.
3. Install this VS Code extension and open a project. The embedded app server starts automatically.
4. Run **AiPASS: Open Sidebar**, or **AiPASS: Test Bridge Connection** to verify the connection.

## Usage

### Ask about the active file

Open the AiPASS sidebar, choose a chat model, type a question, and press Enter. The extension can include the active file's language and bounded content according to your context settings.

### Configure context sharing

Open VS Code Settings and search for `AiPASS Context`:

| Setting | Default | Purpose |
|---|---:|---|
| `aipass.context.coding` | `true` | Share active-file coding context. |
| `aipass.context.projects` | `true` | Share workspace name and root metadata. |
| `aipass.context.identity` | `false` | Allow configured identity fields. |
| `aipass.context.memory` | `false` | Reserved for a future memory provider. |

Context is inserted into the newest user message because the upstream browser endpoint accepts that message shape. It is not sent as a hidden system prompt.

### Bridge settings

- `aipass.bridgeUrl` — default: `http://localhost:8787`
- `aipass.bridgePath` — optional path to an alternate `server.mjs`; leave empty to use the embedded app server.

## Security and privacy

- Keep the bridge bound to localhost.
- Do not expose port `8787` to an untrusted network.
- The bridge does not receive the browser session cookie.
- Context audit records contain metadata only: timestamp, model, and selected sections.
- Review the context settings before sharing source code with any AI service.

## Known limitations

- A Chrome/Chromium tab must remain signed in and connected.
- The VS Code sidebar currently supports chat models; media generation remains available through the bridge CLI.
- `AiPASS: Run Check Locally` is reserved for the checks-runner integration.
- Bridge authentication is not enabled by default; keep it on localhost.

## Release notes

See [CHANGELOG.md](CHANGELOG.md).

## About the creator

**PANSAKORN (林金龍) PHOTHIDAEN**  
● [linkedin.com/in/pansakorn](https://linkedin.com/in/pansakorn)  
● [github.com/pphothidaen](https://github.com/pphothidaen/)

## License

MIT — open source