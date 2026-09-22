# ⚡ AIPASS Web Bridge

<div align="center">

[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers%20Durable%20Objects-F38020?logo=cloudflare&logoColor=white)](https://workers.cloudflare.com/)
[![Chrome Extension](https://img.shields.io/badge/Chrome-Extension%20MV3-4285F4?logo=googlechrome&logoColor=white)](https://developer.chrome.com/docs/extensions/)
[![VS Code Extension](https://img.shields.io/badge/VS%20Code-Extension-22A6F2?logo=visualstudiocode&logoColor=white)](https://code.visualstudio.com/api)
[![MCP Protocol](https://img.shields.io/badge/MCP-JSON--RPC%202.0-8A2BE2)](https://modelcontextprotocol.io/)
[![OpenAI Compatible](https://img.shields.io/badge/API-OpenAI%20Compatible-412991?logo=openai&logoColor=white)](https://platform.openai.com/docs/api-reference)
[![CI Gates](https://img.shields.io/badge/CI-smoke%20·%20blueteam%20·%20redteam%20·%20deploy-brightgreen.svg)](.github/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

[English](#-english) | [ภาษาไทย](#-ภาษาไทย) | [简体中文](#-简体中文) | [💼 Career & Recruitment](#-for-hr--technical-recruiters--สำหรับผู้สรรหาบุคลากร--招聘与合作)

</div>

---

## 🌐 English

**AIPASS Web Bridge (v0.6.5)** is a production-grade Edge AI Gateway that bridges a live, authenticated [de.aipass.net](https://de.aipass.net) browser session into an **OpenAI-Compatible REST API** (with real SSE streaming) and a **Remote MCP Server**, powered by **Cloudflare Durable Objects** — with zero upstream credentials ever touching the server.

It enables autonomous AI clients and developer tools — **Hermes Agent**, **Secretary**, the bundled **VS Code extension**, any OpenAI SDK, or any MCP client — to call 100+ AI models (chat, image, video, music, research) through the logged-in AIPASS web session, with strict fail-closed behavior and zero mocks.

### ✨ Key Features

- **Cloudflare Durable Objects Hub (`ExtHub`)** — Stateful in-memory Edge coordinator. The extension consumes an SSE job stream (`GET /ext/events`) and POSTs results back (`/ext/chunk|done|error|loader|tab`); a FIFO queue (depth 10) serializes jobs with per-kind timeouts (120s chat/create, 30s others).
- **OpenAI-Compatible API** — `GET /v1/models` (live catalog with tier/kind/use-case metadata) and `POST /v1/chat/completions` with real SSE streaming (`chat.completion.chunk` → `data: [DONE]`), attachments, media options (`aspect_ratio`, `image_style`, `video_options`), and `thinking_level`. Chatbox AI compatibility routes (`/models`, `/chat/completions` without the `/v1` prefix) included.
- **Remote MCP Server (`POST /mcp`)** — JSON-RPC 2.0 / MCP spec: `initialize`, `tools/list`, `tools/call` with `aipass_chat`, `aipass_list_models`, `aipass_status`.
- **Dual-Role Token Auth** — `BRIDGE_SECRET` for the extension channel (`x-bridge-token`), `CLIENT_API_KEY` for API/MCP clients (`Authorization: Bearer`); OpenAI-style error envelopes everywhere (`invalid_api_key` 401, `secrets_unconfigured` 503).
- **Zero-Token-Leak Privacy (GUARDRAILS G1)** — No upstream AIPASS credentials exist on the server; the logged-in session lives only in the browser. Extension builds ship with a `__BRIDGE_AUTH_TOKEN__` placeholder and are injected at build time (`scripts/build-extension.py`) — nothing leaks into git.
- **Strict Fail-Closed Architecture** — `503 extension disconnected`, `422 model_unverified`, `429 queue_full`. Never fabricates a response.
- **Blue Team / Red Team CI Governance** — Four CI gates on every push: `smoke`, `blueteam` (gitleaks, npm audit, secret hygiene), `redteam` (unit tests, chaos suites: split-brain, upstream 403 injection, failover, epoch-replay, queue overflow, SSRF), and `deploy` (Wrangler + post-deploy smoke).
- **VS Code Extension** — A companion extension connects to the same Cloudflare Worker, so AIPASS models are available directly inside the editor.

### 🚀 Quickstart

#### 1. Deploy the Cloudflare Worker

```bash
git clone --recurse-submodules https://github.com/pphothidaen/aipass-web-bridge.git
cd aipass-web-bridge
npm install
cd cloudflare
npx wrangler deploy
```

Configure required secrets:

```bash
npx wrangler secret put BRIDGE_SECRET    # extension channel
npx wrangler secret put CLIENT_API_KEY   # API / MCP clients
```

#### 2. Install the Chrome Extension

1. Open `chrome://extensions/` in Google Chrome.
2. Enable **Developer mode** (top-right toggle).
3. Click **Load unpacked** and select `packages/core/aipass-bridge/extension` (or a built artifact from `python scripts/build-extension.py --output release/aipass-bridge-chrome-built --zip`).
4. Log in to [de.aipass.net](https://de.aipass.net) in a normal tab.
5. Confirm the popup shows the bridge as **Connected** (default bridge URL: `https://aipass-web-bridge.<account>.workers.dev`).

#### 3. Connect an AI Client

**Hermes Agent configuration:**

```yaml
model:
  default: aipass/default
  provider: aipass-web-bridge

providers:
  aipass-web-bridge:
    type: custom
    name: aipass-web-bridge
    base_url: https://aipass-web-bridge.taijustarrett417.workers.dev/v1
    api_key: ${CLIENT_API_KEY}
```

**Python (OpenAI SDK):**

```python
from openai import OpenAI

client = OpenAI(
    base_url="https://aipass-web-bridge.taijustarrett417.workers.dev/v1",
    api_key="YOUR_CLIENT_API_KEY",
)

response = client.chat.completions.create(
    model="aipass/default",
    messages=[{"role": "user", "content": "Explain Cloudflare Durable Objects"}],
    stream=True,
)

for chunk in response:
    print(chunk.choices[0].delta.content or "", end="")
```

#### 4. Check system health

```bash
curl -s https://aipass-web-bridge.taijustarrett417.workers.dev/status | jq .
```

---

## 🌐 ภาษาไทย

**AIPASS Web Bridge (v0.6.5)** คือ Edge AI Gateway ระดับโปรดักชัน ที่ทำหน้าที่เป็นสะพานเชื่อมต่อเซสชันเว็บจริงของ [de.aipass.net](https://de.aipass.net) เข้าสู่ **OpenAI-Compatible REST API** (รองรับ Real SSE Streaming) และ **Remote MCP Server** ผ่านขุมพลัง **Cloudflare Durable Objects** — โดยเซิร์ฟเวอร์ไม่เคยถือ credential ของผู้ให้บริการเลยแม้แต่ครั้งเดียว

ระบบนี้ออกแบบมาเพื่อให้ AI Agent และเครื่องมือนักพัฒนา เช่น **Hermes Agent**, **Secretary**, **VS Code Extension** ที่แถมมา, OpenAI SDK หรือ MCP client ใดก็ตาม เรียกใช้โมเดล AI กว่า 100 ตัว (แชท, ภาพ, วิดีโอ, เพลง, research) ผ่านเซสชัน AIPASS ที่ล็อกอินแล้วในเบราว์เซอร์ ด้วยสถาปัตยกรรม Fail-Closed เคร่งครัดและไม่มีคำตอบหลอก (Zero Mocks)

### ✨ จุดเด่นที่สำคัญ

- **ศูนย์กลาง Cloudflare Durable Objects (`ExtHub`)** — ประสานงานระหว่าง Extension (รับงานผ่าน SSE `GET /ext/events` และส่งผลลัพธ์กลับผ่าน `/ext/chunk|done|error`) กับ REST/MCP API บน Edge พร้อมระบบคิวงาน FIFO (ความลึก 10) และ timeout ตามชนิดงาน (120 วินาทีสำหรับ chat/create, 30 วินาทีสำหรับงานอื่น)
- **OpenAI-Compatible API** — `GET /v1/models` (แคตตาล็อกสด พร้อม metadata แบบ tier/kind/use-case) และ `POST /v1/chat/completions` แบบ SSE Streaming จริง รองรับ attachments, ตัวเลือกสื่อ (`aspect_ratio`, `image_style`, `video_options`) และ `thinking_level` — รวมถึง route สำหรับความเข้ากันได้กับ Chatbox AI
- **Remote MCP Server (`POST /mcp`)** — ตามสเปก JSON-RPC 2.0 / MCP: `initialize`, `tools/list`, `tools/call` พร้อมเครื่องมือ `aipass_chat`, `aipass_list_models`, `aipass_status`
- **ระบบ Auth สองบทบาท** — `BRIDGE_SECRET` สำหรับช่องทาง Extension (`x-bridge-token`) และ `CLIENT_API_KEY` สำหรับ API/MCP clients (`Authorization: Bearer`) พร้อม error envelope แบบ OpenAI ทุกกรณี
- **ความปลอดภัยระดับสูงสุด (Zero-Token-Leak - กฎเหล็ก G1)** — เซสชันล็อกอินอยู่ในเบราว์เซอร์เท่านั้น ตัว extension ที่ build ใช้ placeholder `__BRIDGE_AUTH_TOKEN__` แล้วฉีด token ตอน build (`scripts/build-extension.py`) — ไม่มี secret รั่วเข้าสู่ git เด็ดขาด
- **สถาปัตยกรรม Fail-Closed เคร่งครัด** — ตอบ `503 extension disconnected`, `422 model_unverified`, `429 queue_full` ทันที และจะไม่มีการสร้างคำตอบปลอม
- **ธรรมาภิบาล Blue Team / Red Team ใน CI** — 4 เกตบนทุก push: `smoke`, `blueteam` (gitleaks, npm audit, secret hygiene), `redteam` (unit tests, chaos suites: split-brain, upstream 403 injection, failover, epoch-replay, queue overflow, SSRF) และ `deploy` (Wrangler + post-deploy smoke)
- **VS Code Extension** — ส่วนขยายที่แถมมาเชื่อมต่อกับ Cloudflare Worker ตัวเดียวกัน เรียกใช้โมเดล AIPASS ได้ตรงจากใน editor

### 🚀 การเริ่มต้นใช้งานอย่างรวดเร็ว

#### 1. Deploy Cloudflare Worker

```bash
git clone --recurse-submodules https://github.com/pphothidaen/aipass-web-bridge.git
cd aipass-web-bridge
npm install
cd cloudflare
npx wrangler deploy
```

ตั้งค่า Environment Secrets:

```bash
npx wrangler secret put BRIDGE_SECRET    # ช่องทาง extension
npx wrangler secret put CLIENT_API_KEY   # API / MCP clients
```

#### 2. ติดตั้ง Chrome Extension

1. เปิด `chrome://extensions/` ใน Google Chrome
2. เปิดสวิตช์ **Developer mode (โหมดนักพัฒนา)** ที่มุมขวาบน
3. คลิก **Load unpacked** แล้วเลือกโฟลเดอร์ `packages/core/aipass-bridge/extension` (หรือ build artifact จาก `python scripts/build-extension.py --output release/aipass-bridge-chrome-built --zip`)
4. ล็อกอิน [de.aipass.net](https://de.aipass.net) ในแท็บปกติ
5. ตรวจสอบใน popup ว่าสถานะเป็น **Connected** (Bridge URL เริ่มต้น: `https://aipass-web-bridge.<account>.workers.dev`)

#### 3. ตรวจสอบสุขภาพระบบ

```bash
curl -s https://aipass-web-bridge.taijustarrett417.workers.dev/status | jq .
```

---

## 🌐 简体中文

**AIPASS Web Bridge (v0.6.5)** 是一个生产级 Edge AI 网关。它基于 **Cloudflare Durable Objects** 构建，将真实的、已认证的 [de.aipass.net](https://de.aipass.net) 网页会话桥接为 **兼容 OpenAI 的 REST API**（支持真正的 SSE 流式传输）以及 **远程 MCP 服务器** — 服务器端从不持有任何上游凭证。

它支持外部 AI Agent 与开发工具（如 **Hermes Agent**、**Secretary**、内置的 **VS Code 扩展**、任意 OpenAI SDK 或 MCP 客户端）通过已登录的 AIPASS 网页会话调用 100+ 个 AI 模型（聊天、图像、视频、音乐、研究），并严格遵循快速失败（Fail-Closed）原则，杜绝任何伪造数据。

### ✨ 核心亮点

- **Cloudflare Durable Objects 状态中枢 (`ExtHub`)** — 通过 SSE 任务流（`GET /ext/events`）与结果回传接口协调浏览器扩展与客户端 REST/MCP 请求，具备 FIFO 队列（深度 10）与按任务类型的超时控制。
- **兼容 OpenAI 的 API** — `GET /v1/models`（实时模型目录）与 `POST /v1/chat/completions`（真 SSE 流式输出），支持附件、媒体选项与 `thinking_level`，并兼容 Chatbox AI 的无前缀路由。
- **远程 MCP 服务器 (`POST /mcp`)** — 遵循 JSON-RPC 2.0 / MCP 规范，提供 `aipass_chat`、`aipass_list_models`、`aipass_status` 工具。
- **双角色令牌认证** — `BRIDGE_SECRET`（扩展通道）与 `CLIENT_API_KEY`（API/MCP 客户端），所有错误均使用 OpenAI 风格的错误信封。
- **零令牌泄露隐私安全（GUARDRAILS G1 准则）** — 登录会话仅存在于浏览器中；扩展构建产物使用占位符并在构建时注入令牌，绝不泄漏到代码仓库。
- **严格快速失败机制** — 扩展离线返回 `503`，模型未验证返回 `422`，队列饱和返回 `429`，绝不伪造响应。
- **蓝队/红队 CI 治理** — 每次推送经过 `smoke`、`blueteam`、`redteam`、`deploy` 四道 CI 门禁。

### 🚀 快速上手

#### 1. 部署 Cloudflare Worker

```bash
git clone --recurse-submodules https://github.com/pphothidaen/aipass-web-bridge.git
cd aipass-web-bridge && npm install
cd cloudflare && npx wrangler deploy
```

配置必要密钥：

```bash
npx wrangler secret put BRIDGE_SECRET
npx wrangler secret put CLIENT_API_KEY
```

#### 2. 安装 Chrome 扩展

1. 在 Chrome 中打开 `chrome://extensions/`。
2. 开启右上角 **开发者模式**。
3. 点击 **加载已解压的扩展程序**，选择目录 `packages/core/aipass-bridge/extension`。
4. 访问 [de.aipass.net](https://de.aipass.net) 并登录。
5. 在扩展弹窗中确认桥接状态为 **Connected**。

---

## 🧰 Remote MCP Tools (Model Context Protocol)

AIPASS Web Bridge provides a suite of remote MCP tools via `POST /mcp` conforming to the JSON-RPC 2.0 / MCP spec:

| Tool Name | Scope | Parameters | Description |
|:---|:---:|:---|:---|
| `aipass_chat` | Core | `messages`, `model?`, `stream?`, `attachments?`, `thinking_level?` | Sends a chat completion through the live AIPASS browser session with real SSE streaming. |
| `aipass_list_models` | Catalog | — | Live model catalog (`kind`: chat / image / video / music / research) discovered from the active session. |
| `aipass_status` | System | — | Hub health, extension connectivity, model catalog revision, and last chat latency. |

---

## 🏗️ Architecture Blueprint

```text
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                                   AI Clients Tier                                      │
│      Hermes Agent · Secretary · VS Code Extension · OpenAI SDKs · MCP · cURL           │
└───────────────────────────────────────────┬────────────────────────────────────────────┘
                                            │ HTTPS (Bearer Auth: CLIENT_API_KEY)
                                            ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                    Cloudflare Worker Edge Tier (aipass-web-bridge v0.6.5)              │
│                                                                                        │
│   ┌────────────────────────────────────────────────────────────────────────────────┐   │
││                          Edge Routing & Security Middleware                        │   │
│   │   • Dual-Role Token Auth (BRIDGE_SECRET / CLIENT_API_KEY)                       │   │
│   │   • Strict Fail-Closed Policy (503 offline, 422 unverified, 429 queue_full)     │   │
│   │   • CORS Preflight at the Edge (SSE-safe) + OpenAI Error Envelopes              │   │
│   └──────┬────────────────────────┬────────────────────────┬───────────────────────┘   │
│          │                        │                        │                           │
│          ▼                        ▼                        ▼                           │
│   ┌──────────────┐         ┌──────────────┐         ┌──────────────┐                   │
│   │ OpenAI REST  │         │  Remote MCP  │         │  Status API  │                   │
│   │ /v1/*        │         │  /mcp        │         │  /status     │                   │
│   └──────┬───────┘         └──────┬───────┘         └──────┬───────┘                   │
│          │                        │                        │                           │
│          └────────────────────────┼────────────────────────┘                           │
│                                   ▼                                                    │
│   ┌────────────────────────────────────────────────────────────────────────────────┐   │
│   │                    ExtHub (Stateful Durable Object Singleton)                  │   │
│   │   • Global Singleton (`idFromName("singleton")`)                               │   │
│   │   • FIFO Job Queue (Max 10 Waiters, 120s chat / 30s other timeouts)            │   │
│   │   • Real SSE Chunk Streaming (`/ext/chunk` → `chat.completion.chunk`)          │   │
│   │   • Dynamic Model Catalog & Revision Registry                                  │   │
│   │   • Job Dispatch Bus + Remote Reload Channels (/ext/reload, /ext/reload-tab)   │   │
│   └───────────────────────────────┬────────────────────────────────────────────────┘   │
│                                   │ SSE Job Push (GET /ext/events, auth: BRIDGE_SECRET)│
│                                   ▼                                                    │
│   ┌────────────────────────────────────────────────────────────────────────────────┐   │
│   │                 Chrome Extension (Manifest V3)                                 │   │
│   │   • background.js: SSE job consumer, result POSTer (/ext/chunk|done|error|tab) │   │
│   │   • offscreen.js + page.js: AIPASS page orchestration                          │   │
│   │   • content.js: tab-level relay                                                │   │
│   │   • popup: connection status & bridge URL configuration                        │   │
│   └───────────────────────────────┬────────────────────────────────────────────────┘   │
└───────────────────────────────────┼────────────────────────────────────────────────────┘
                                    │ chrome.tabs / offscreen document
                                    ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                        Google Chrome Tab Runtime (de.aipass.net)                       │
│   • Authenticated user session (credentials stay in the browser — GUARDRAILS G1)       │
│   • Executes chat / image / video / music / research jobs on the live page             │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

---

<div align="center">

### 🤝 Let's Connect & Build High-Impact AI Systems Together!

[![LinkedIn Profile](https://img.shields.io/badge/LinkedIn-Pansakorn%20Phothidaen-0A66C2?style=for-the-badge&logo=linkedin&logoColor=white)](https://www.linkedin.com/in/pansakorn/)
[![GitHub Profile](https://img.shields.io/badge/GitHub-pphothidaen-181717?style=for-the-badge&logo=github&logoColor=white)](https://github.com/pphothidaen)
[![Hugging Face Profile](https://img.shields.io/badge/HuggingFace-pphothidaen-181717?style=for-the-badge&logo=huggingface&logoColor=white)](https://huggingface.co/pphothidaen)

</div>

---

## 📄 License

MIT License — Released for open research, learning, and enterprise AI enablement.
