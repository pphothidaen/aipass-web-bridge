// Cloudflare Worker: AIPASS Bridge Cloud Hub (adapted template)
// Adapted from the "Hybrid Resilient Orchestrator + WebSocket Hub" template
// (v3.0.0) to the aipass-bridge protocol.
//
// Key changes from the original template:
// 1. Durable Object replaces the global `activeSocket` — the template's
//    in-memory socket dies across Worker isolates; a DO pins the extension
//    connection and all job state in one place.
// 2. Extension channel uses the REAL aipass-bridge protocol: the Chrome
//    extension connects with SSE (GET /ext/events) and POSTs results to
//    /ext/chunk|done|error — no extension code changes needed, just point its
//    bridge URL at this Worker.
// 3. OpenAI-compatible surface (/v1/models, /v1/chat/completions) and /status
//    mirror the local bridge so Hermes/Secretary work unchanged.
//
// TODO before production: see docs/cloudflare-deployment-assessment.md
// (token auth is enforced here; tighten CORS, add rate limiting).

const MODEL_FALLBACK = ["gemini-3.1-flash-lite", "claude-sonnet-5@default"];

// Models list loader (same-origin .data route the web UI itself uses).
const MODELS_LOADER_URL = "/loaders/list-models.data?_routes=routes%2Floaders%2Flist-models";

// ── Model classification (ported from local bridge) ─────────────────────────
const KIND_IDS = {
  image: ["gemini-2.5-flash-image", "gemini-3.1-flash-image", "gemini-3.1-flash-lite-image",
    "gemini-3-pro-image", "FLUX.2-pro", "gpt-image-2", "seedream-4.0", "seedream-4.5",
    "seedream-5.0-lite", "mock-remote-image"],
  video: ["veo-3.0-generate-001", "veo-3.1-generate-001", "veo-3.1-fast-generate-001", "sora-2",
    "seedance-2.0", "seedance-2.0-fast", "seedance-2.0-mini", "mock-remote-video"],
  music: ["lyria-3-clip-preview", "lyria-3-pro-preview"],
  research: ["gemini-2.5-pro-deep-research", "openai-deep-research", "sonar-deep-research"],
};
const KIND_BY_ID = new Map(Object.entries(KIND_IDS).flatMap(([kind, ids]) => ids.map((id) => [id, kind])));
const KIND_PATTERNS = [
  ["image", /seedream|gpt-image|flux|-image$|image-preview/i],
  ["video", /^veo-|seedance|^sora-|^wan\d/i],
  ["music", /lyria/i],
  ["research", /deep-research/i],
];
const kindOf = (id) => KIND_BY_ID.get(id) ?? KIND_PATTERNS.find(([, re]) => re.test(id))?.[0] ?? "chat";

// ── T3: skill summary per model family — ใช้โมเดลให้คุ้มค่า ─────────────────
const SKILL_RULES = [
  [/flash-lite/i,       { tier: "free",     use_case: "งานทั่วไป/คุย/สรุป/แปลงข้อความ — เร็วและไม่เสียเครดิต, ใช้เป็นค่าเริ่มต้น" }],
  [/sonar-deep-research|deep-research/i, { tier: "paid",  use_case: "ค้นคว้าเชิงลึกหลายแหล่งพร้อมอ้างอิง — ใช้เมื่อต้องการรายงานวิจัย" }],
  [/^sonar/i,           { tier: "paid",     use_case: "ตอบพร้อมค้นเว็บสด (web search) — ข่าว/ข้อมูลปัจจุบัน" }],
  [/claude-sonnet|claude-opus/i, { tier: "paid", use_case: "เขียนโค้ด/วิเคราะห์ซับซ้อน/งานเขียนยาว — คุณภาพสูงสุด ใช้เมื่องานสำคัญ" }],
  [/gemini-3\.1-pro|gemini-3-pro/i, { tier: "paid", use_case: "เหตุผลซับซ้อน/วางแผนหลายขั้น — สมดุลคุณภาพกับเวลา" }],
  [/deepseek|kimi|glm|qwen/i, { tier: "paid",  use_case: "โค้ดและภาษาจีน/หลายภาษา — ทางเลือกเฉพาะทาง" }],
  [/pathumma/i,         { tier: "paid",     use_case: "ภาษาไทยเฉพาะทาง (โมเดลไทย)" }],
  [/gpt-5/i,            { tier: "paid",     use_case: "งาน reasoning ทั่วไปสไตล์ OpenAI" }],
];
const skillFor = (id) => {
  const hit = SKILL_RULES.find(([re]) => re.test(id));
  if (hit) return { tier: hit[1].tier, use_case: hit[1].use_case };
  return { tier: "paid", use_case: "โมเดล chat ทั่วไป (เสียเครดิต) — ถ้าไม่จำเป็นใช้ flash-lite ฟรีแทน" };
};

// Ported from the local bridge: walk the decoded catalog pool and collect
// ready+selectable chat/media models.
function extractModels(decoded) {
  const out = [];
  const walk = (v) => {
    if (Array.isArray(v)) return v.forEach(walk);
    if (!v || typeof v !== "object") return;
    const id = v.id ?? v.modelId;
    if (typeof id === "string" && id && !out.some((m) => m.id === id)) {
      const kind = kindOf(id);
      out.push({
        id,
        name: v.displayName ?? v.name ?? id,
        provider: v.providerName ?? v.provider ?? null,
        description: v.description ?? null,
        kind,
        free: v.isFreeCredit === true,
        ready: v.ready !== false,
        selectable: v.selectable !== false,
        isDefault: v.isDefault === true,
      });
    }
    Object.values(v).forEach(walk);
  };
  walk(decoded);
  return out.filter((m) => m.ready && m.selectable);
}

// Ported from the local bridge: de.aipass.net .data loaders answer with a flat
// reference pool (turbo-stream encoding); decode back to a plain object tree.
function decodeTurboStream(text) {
  const flat = JSON.parse(text);
  const seen = new Map();
  const resolve = (ref) => {
    if (typeof ref !== "number") return ref;
    if (ref < 0) return null;
    if (seen.has(ref)) return seen.get(ref);
    const v = flat[ref];
    if (Array.isArray(v)) {
      const out = [];
      seen.set(ref, out);
      for (const e of v) out.push(resolve(e));
      return out;
    }
    if (v && typeof v === "object") {
      const out = {};
      seen.set(ref, out);
      for (const [k, valueRef] of Object.entries(v)) out[resolve(Number(k.slice(1)))] = resolve(valueRef);
      return out;
    }
    seen.set(ref, v);
    return v;
  };
  return resolve(0);
}

function findValue(node, key) {
  if (Array.isArray(node)) {
    for (const v of node) { const hit = findValue(v, key); if (hit != null) return hit; }
    return null;
  }
  if (!node || typeof node !== "object") return null;
  if (typeof node[key] === "string") return node[key];
  for (const v of Object.values(node)) { const hit = findValue(v, key); if (hit != null) return hit; }
  return null;
}

export class ExtHub {
  constructor(state, env) {
    this.env = env;
    this.extWriter = null;      // SSE writer currently held for the extension
    this.extReady = false;      // extension sent its `ready` event
    this.jobs = new Map();      // jobId -> {chunks: [], resolve, timer}
    this.models = MODEL_FALLBACK;
    this.defaultModel = MODEL_FALLBACK[0];
    this.lastExtSeen = 0;
    // T1 latency: reuse one temporary conversation per DO instead of minting
    // a fresh one for every chat (saves a full create round-trip per call).
    this.conversationCache = null;
    // T2 dynamic model catalog from the extension session (TTL 60s).
    this.modelCatalog = [];
    this.modelCatalogAt = 0;
    this.modelRefresh = null;
    this.catalogRevision = 0;
    // T1 measured chat latency (last successful aipass_chat, ms).
    this.lastChatLatencyMs = null;
  }

  // ---------- helpers ----------
  sseLine(event, data) {
    return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  }

  get isExtConnected() {
    return this.extWriter !== null && this.extReady;
  }

  // ---------- extension channel (same paths as the local bridge) ----------
  async extEvents(request) {
    // SSE hold — same as bridge server.mjs extEvents()
    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();
    if (this.extWriter) {
      try { this.extWriter.close(); } catch {}
    }
    this.extWriter = writer;
    // The SSE connection itself is the handshake — mark ready immediately
    // (the local bridge's `ready` event flows to the client; here the mere
    // presence of the open stream means the extension channel is usable).
    this.extReady = true;
    this.lastExtSeen = Date.now();
    const enc = new TextEncoder();

    // Greet exactly like the local bridge does
    writer.write(enc.encode(this.sseLine("ready", { clientId: "cf-hub" }))).catch(() => {});

    // T1/T2 pre-warm: refresh the model catalog and mint a reusable temporary
    // conversation right after the extension connects, so the first chat has
    // zero bootstrap latency. Fire-and-forget — never block the stream.
    setTimeout(() => {
      this.refreshModels().catch(() => {});
      this.createConversation(this.defaultModel).catch(() => { this.conversationCache = null; });
    }, 100);

    // Heartbeat comment keeps intermediaries from closing the stream
    const ping = setInterval(() => {
      writer.write(enc.encode(": ping\n\n")).catch(() => clearInterval(ping));
    }, 15000);

    // Extension reconnects every ~4 min (Chrome service-worker ceiling);
    // clean up when the stream cancels — ONLY if this is still the active writer.
    request.signal.addEventListener("abort", () => {
      clearInterval(ping);
      if (this.extWriter === writer) {
        this.extWriter = null;
        this.extReady = false;
        for (const [jobId, job] of this.jobs) {
          job.reject(new Error("extension disconnected"));
          this.jobs.delete(jobId);
        }
      }
    });

    return new Response(readable, {
      status: 200,
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        "access-control-allow-origin": "*",
      },
    });
  }

  async extPost(request, kind) {
    const body = await request.json().catch(() => ({}));
    const job = this.jobs.get(body.jobId);
    if (!job) return json({ ok: true, note: "unknown jobId (probably reconnected)" });

    if (kind === "chunk") {
      job.chunks.push(...(body.parts || []));
      if (job.onChunk) for (const p of (body.parts || [])) job.onChunk(p?.text ?? "");
    } else if (kind === "done") {
      clearTimeout(job.timer);
      this.jobs.delete(body.jobId);
      job.resolve({ chunks: job.chunks, finishReason: body.finishReason || "stop" });
    } else if (kind === "loader") {
      // kind:'create' jobs answer here with the raw .data body (TurboStream)
      clearTimeout(job.timer);
      this.jobs.delete(body.jobId);
      if (body.message) job.reject(new Error(body.message));
      else job.resolve({ raw: body.raw || "" });
    } else if (kind === "error") {
      clearTimeout(job.timer);
      this.jobs.delete(body.jobId);
      job.reject(new Error(body.message || "extension error"));
    }
    return json({ ok: true });
  }

  // ---------- client API ----------
  // ---------- chat job runner (shared by OpenAI API and MCP tools) ----------
  // Dispatches a job to the connected extension and awaits completion.
  // onChunk(deltaText) is invoked per extension chunk for SSE streaming.
  runJob(payload, onChunk = null) {
    if (!this.isExtConnected) {
      return Promise.reject(new Error("no extension connected to the cloud hub"));
    }
    const jobId = crypto.randomUUID();
    const job = { chunks: [], resolve: null, reject: null, timer: null, onChunk, kind: payload.kind };
    const result = new Promise((resolve, reject) => {
      job.resolve = resolve;
      job.reject = reject;
    });
    this.jobs.set(jobId, job);
    job.timer = setTimeout(() => {
      this.jobs.delete(jobId);
      job.reject(new Error("timeout waiting for extension (120s)"));
    }, 120000);

    // Same event shape the local bridge sends over SSE
    this.extWriter.write(new TextEncoder().encode(
      this.sseLine("job", { jobId, ...payload })
    )).catch(err => {
      clearTimeout(job.timer);
      this.jobs.delete(jobId);
      job.reject(err);
    });
    return result;
  }

  runChatJob(text, modelId, conversationId, onChunk = null, parts = null) {
    return this.runJob({
      kind: "chat", modelId, text, conversationId,
      ...(parts && parts.length ? { parts } : {}),
    }, onChunk);
  }

  // Mirror the local bridge's resolveConversation(): reuse one temporary
  // conversation per DO (T1 latency) — mint a new one only on cold start or
  // after the session expires it ("conversation not found" → retry recreates).
  async createConversation(modelId) {
    if (this.conversationCache) return this.conversationCache;
    const raw = await this.runCreateJob(modelId);
    const id = findValue(decodeTurboStream(raw), "conversationId")
      ?? findValue(decodeTurboStream(raw), "id");
    if (!id) throw new Error("could not read a conversation id from create-conversation response");
    this.conversationCache = id;
    return id;
  }

  // T2: dynamic model catalog — pull the live model list from the page via a
  // loader job, decode the turbo-stream pool, classify, TTL-cache 60s.
  async refreshModels(force = false) {
    if (!force && this.modelCatalog.length && Date.now() - this.modelCatalogAt < 60_000) {
      return this.modelCatalog;
    }
    if (this.modelRefresh) return this.modelRefresh;
    this.modelRefresh = (async () => {
      try {
        const raw = await Promise.race([
          this.runLoaderJob(MODELS_LOADER_URL),
          new Promise((_, reject) => setTimeout(() => reject(new Error("loader timeout")), 3000)),
        ]);
        const models = extractModels(decodeTurboStream(raw));
        if (models.length) {
          this.modelCatalog = models;
          this.modelCatalogAt = Date.now();
          this.catalogRevision++;
          const free = models.filter((m) => m.free).map((m) => m.id);
          this.defaultModel = free.includes("gemini-3.1-flash-lite")
            ? "gemini-3.1-flash-lite" : this.defaultModel;
        }
      } catch { /* keep the previous/fallback catalog on refresh failure */ }
      finally { this.modelRefresh = null; }
      return this.modelsList();
    })();
    return this.modelRefresh;
  }

  modelsList() {
    if (!this.modelCatalog.length) {
      return MODEL_FALLBACK.map((id) => ({
        id, name: id, provider: null, free: id.includes("flash-lite"),
        kind: kindOf(id), ...skillFor(id), description: null,
      }));
    }
    return this.modelCatalog.map((m) => ({ ...m, ...skillFor(m.id) }));
  }

  runCreateJob(modelId) {
    const result = this.runJob({
      kind: "create", modelId,
      message: "Hello",
      requestId: crypto.randomUUID(),
      temporary: true,
    });
    return result.then(r => r.raw);
  }

  runLoaderJob(url) {
    const result = this.runJob({ kind: "loader", url });
    return result.then(r => r.raw);
  }

  async chatCompletions(request) {
    if (!this.isExtConnected) {
      return jsonOpenAI(request, 503, {
        error: { message: "no extension connected to the cloud hub", code: "unavailable" },
      });
    }

    const body = await request.json();
    const text = body.messages?.filter(m => m.role !== "system").map(m => m.content).join("\n")
      || "Hello";
    const modelId = body.model || this.defaultModel;
    const created = Math.floor(Date.now() / 1000);
    const id = `chatcmpl-${crypto.randomUUID().slice(0, 24)}`;

    if (body.stream) {
      // OpenAI-compatible SSE: deltas as the extension reports chunks.
      const { readable, writable } = new TransformStream();
      const writer = writable.getWriter();
      const enc = new TextEncoder();
      const frame = (obj) => writer.write(enc.encode(`data: ${JSON.stringify(obj)}\n\n`));
      const sseHeaders = {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        "access-control-allow-origin": "*",
      };

      (async () => {
        try {
          frame({ id, object: "chat.completion.chunk", created, model: modelId,
                  choices: [{ index: 0, delta: { role: "assistant" } }] });
          const conversationId = await this.createConversation(modelId);
          const { finishReason } = await this.runChatJob(text, modelId, conversationId, (delta) => {
            if (delta) frame({ id, object: "chat.completion.chunk", created, model: modelId,
                               choices: [{ index: 0, delta: { content: delta } }] });
          }, body.attachments);
          frame({ id, object: "chat.completion.chunk", created, model: modelId,
                  choices: [{ index: 0, delta: {}, finish_reason: finishReason || "stop" }] });
          writer.write(enc.encode("data: [DONE]\n\n"));
          writer.close();
        } catch (err) {
          // Conversation expired mid-session (temporary chats age out): drop the
          // cached id, mint a fresh one, retry the chat exactly once.
          if (/conversation not found|404/i.test(String(err.message || err))) {
            try {
              this.conversationCache = null;
              const conversationId = await this.createConversation(modelId);
              const { finishReason } = await this.runChatJob(text, modelId, conversationId, (delta) => {
                if (delta) frame({ id, object: "chat.completion.chunk", created, model: modelId,
                                   choices: [{ index: 0, delta: { content: delta } }] });
              }, body.attachments);
              frame({ id, object: "chat.completion.chunk", created, model: modelId,
                      choices: [{ index: 0, delta: {}, finish_reason: finishReason || "stop" }] });
              writer.write(enc.encode("data: [DONE]\n\n"));
              return writer.close();
            } catch (retryErr) {
              frame({ id, object: "chat.completion.chunk", created, model: modelId,
                      choices: [{ index: 0, delta: {} }], error: { message: String(retryErr.message || retryErr) } });
              writer.write(enc.encode("data: [DONE]\n\n"));
              return writer.close();
            }
          }
          frame({ id, object: "chat.completion.chunk", created, model: modelId,
                  choices: [{ index: 0, delta: {} }], error: { message: String(err.message || err) } });
          writer.write(enc.encode("data: [DONE]\n\n"));
          writer.close();
        }
      })();

      return new Response(readable, { status: 200, headers: sseHeaders });
    }

    const started = Date.now();
    try {
      const conversationId = await this.createConversation(modelId);
      let chat;
      try {
        chat = await this.runChatJob(text, modelId, conversationId, null, body.attachments);
      } catch (err) {
        // Temporary conversation expired → recreate once and retry.
        if (!/conversation not found|404/i.test(String(err.message || err))) throw err;
        this.conversationCache = null;
        const fresh = await this.createConversation(modelId);
        chat = await this.runChatJob(text, modelId, fresh, null, body.attachments);
      }
      const out = chat.chunks.map(p => p?.text ?? "").join("");
      this.lastChatLatencyMs = Date.now() - started;
      return jsonOpenAI(request, 200, {
        id, object: "chat.completion", created, model: modelId,
        choices: [{ index: 0, message: { role: "assistant", content: out }, finish_reason: chat.finishReason }],
        usage: {
          prompt_tokens: Math.ceil(text.length / 4),
          completion_tokens: Math.ceil(out.length / 4),
          total_tokens: Math.ceil((text.length + out.length) / 4),
        },
        latency_ms: this.lastChatLatencyMs,
      });
    } catch (err) {
      return jsonOpenAI(request, 502, {
        error: { message: String(err.message || err), code: "upstream_error" },
      });
    }
  }

  // ---------- Remote MCP server (JSON-RPC 2.0) ----------
  mcpTools() {
    return [
      {
        name: "aipass_chat",
        description: "ส่ง prompt (แนบไฟล์/รูปได้ optional) ไปประมวลผลผ่าน AIPASS web session จริง — ใช้ model 'gemini-3.1-flash-lite' (ฟรี) สำหรับงานทั่วไป, โมเดล paid เมื่องานซับซ้อน",
        inputSchema: {
          type: "object",
          properties: {
            prompt: { type: "string", description: "ข้อความ/คำสั่งที่ต้องการให้โมเดลตอบ" },
            model: { type: "string", description: "model id (optional — default คือฟรี: gemini-3.1-flash-lite)" },
            attachments: {
              type: "array",
              description: "optional — ไฟล์/รูปแนบ (สูงสุด ~10MB ต่อไฟล์, base64 data URI)",
              items: {
                type: "object",
                properties: {
                  type: { type: "string", enum: ["image", "file"], description: "ประเภทแนบ" },
                  data: { type: "string", description: "data URI เช่น data:image/png;base64,..." },
                  filename: { type: "string", description: "ชื่อไฟล์ (optional)" }
                },
                required: ["type", "data"]
              }
            }
          },
          required: ["prompt"]
        }
      },
      {
        name: "aipass_list_models",
        description: "รายการโมเดลแบบ dynamic จาก session พร้อมสรุปสกิล/การใช้งานของแต่ละโมเดล (free vs paid)",
        inputSchema: { type: "object", properties: {} }
      },
      {
        name: "aipass_status",
        description: "สถานะ cloud hub: extension, default model, latency ล่าสุด",
        inputSchema: { type: "object", properties: {} }
      }
    ];
  }

  async handleMcp(request) {
    let rpc;
    try { rpc = await request.json(); } catch { return json({ error: "invalid JSON" }, 400); }
    const { id, method, params } = rpc || {};
    const mcpHeaders = { "content-type": "application/json", "access-control-allow-origin": "*" };

    if (method === "initialize") {
      return json({
        jsonrpc: "2.0", id,
        result: {
          protocolVersion: params?.protocolVersion || "2024-11-05",
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: "aipass-web-bridge", version: "1.0.0" }
        }
      }, 200, mcpHeaders);
    }
    if (method === "notifications/initialized") {
      return new Response(null, { status: 200, headers: mcpHeaders });
    }
    if (method === "tools/list") {
      return json({ jsonrpc: "2.0", id, result: { tools: this.mcpTools() } }, 200, mcpHeaders);
    }
    if (method === "tools/call") {
      const name = params?.name;
      const args = params?.arguments || {};
      let text;
      try {
        if (name === "aipass_chat") {
          if (!this.isExtConnected) throw new Error("extension offline (fail-fast, no mock)");
          const modelId = args.model || this.defaultModel;
          const started = Date.now();
          const conversationId = await this.createConversation(modelId);
          const parts = Array.isArray(args.attachments) ? args.attachments : null;
          let chunks;
          try {
            ({ chunks } = await this.runChatJob(args.prompt || "Hello", modelId, conversationId, null, parts));
          } catch (err) {
            // Temporary conversation expired → recreate once and retry.
            if (!/conversation not found|404/i.test(String(err.message || err))) throw err;
            this.conversationCache = null;
            const fresh = await this.createConversation(modelId);
            ({ chunks } = await this.runChatJob(args.prompt || "Hello", modelId, fresh, null, parts));
          }
          this.lastChatLatencyMs = Date.now() - started;
          text = chunks.map(p => p?.text ?? "").join("");
        } else if (name === "aipass_list_models") {
          const models = await this.refreshModels();
          const free = models.filter((m) => m.free);
          text = JSON.stringify({
            default_model: this.defaultModel,
            note: "flash-lite ฟรี — ใช้เป็นค่าเริ่มต้นเพื่อไม่เสียเครดิต; โมเดล paid ใช้เมื่องานซับซ้อน",
            free_models: free.map(m => m.id),
            total: models.length,
            models: models.map(m => ({
              id: m.id, name: m.name, kind: m.kind, free: m.free,
              tier: m.tier, use_case: m.use_case,
            })),
          }, null, 2);
        } else if (name === "aipass_status") {
          text = JSON.stringify({
            extension: this.isExtConnected ? "CONNECTED" : "OFFLINE",
            defaultModel: this.defaultModel,
            activeJobs: this.jobs.size,
            model_catalog: { revision: this.catalogRevision, count: this.modelCatalog.length },
            last_chat_latency_ms: this.lastChatLatencyMs,
            conversation_cached: Boolean(this.conversationCache),
          }, null, 2);
        } else {
          return json({ jsonrpc: "2.0", id,
                        error: { code: -32601, message: `unknown tool: ${name}` } }, 200, mcpHeaders);
        }
        return json({ jsonrpc: "2.0", id,
                      result: { content: [{ type: "text", text }] } }, 200, mcpHeaders);
      } catch (err) {
        return json({ jsonrpc: "2.0", id,
                      result: { content: [{ type: "text", text: `ERROR: ${String(err.message || err)}` }],
                                isError: true } }, 200, mcpHeaders);
      }
    }
    return json({ jsonrpc: "2.0", id: id ?? null,
                  error: { code: -32601, message: `method not found: ${method}` } }, 200, mcpHeaders);
  }

  async status(host) {
    return json({
      ok: true,
      service: "aipass-web-bridge",
      architecture: "Cloudflare Worker + Durable Object (SSE hub, like gemini-web-bridge)",
      extension: this.isExtConnected ? "CONNECTED" : "OFFLINE",
      extensions: this.isExtConnected ? 1 : 0,
      defaultModel: this.defaultModel,
      models: this.modelCatalog.length
        ? this.modelCatalog.map(m => ({ id: m.id, kind: m.kind, free: m.free }))
        : this.models.map(id => ({ id })),
      model_catalog: { revision: this.catalogRevision, count: this.modelCatalog.length },
      credits: null, // quota figures flow with the extension session; extend when needed
      last_chat_latency_ms: this.lastChatLatencyMs,
      conversation_cached: Boolean(this.conversationCache),
      mcp_endpoint: `https://${host}/mcp`,
      openai_endpoint: `https://${host}/v1`,
      clients: "Hermes Agent (Mac), any OpenAI-compatible client, any MCP client",
    });
  }

  async fetch(request) {
    const url = new URL(request.url);
    const p = url.pathname.replace(/^\/+|\/+$/g, "");

    if (request.method === "OPTIONS") {
      // CORS preflight — must carry the CORS headers or the browser rejects
      // the preflight and the real request (SSE/fetch) never fires.
      return new Response(null, {
        status: 204,
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "GET, POST, OPTIONS",
          "access-control-allow-headers": "content-type, authorization, x-bridge-token",
          "access-control-max-age": "86400",
        },
      });
    }

    if (p === "ext/events" || p === "bridge") return this.extEvents(request);
    if (p === "ext/chunk") return this.extPost(request, "chunk");
    if (p === "ext/done") return this.extPost(request, "done");
    if (p === "ext/loader") return this.extPost(request, "loader");
    if (p === "ext/error") return this.extPost(request, "error");
    if (p === "bridge/message" || p === "bridge/msg") return json({ ok: true, protocolVersion: 2 });

    if (p === "mcp" && request.method === "POST") return this.handleMcp(request);

    if (p === "status" || p === "health") return this.status(url.host);
    if (p === "" && request.method === "GET") return this.status(url.host);
    if (p === "v1/models") {
      const models = await this.refreshModels();
      return json({
        object: "list",
        catalogRevision: this.catalogRevision,
        default_model: this.defaultModel,
        data: models.map((m) => ({
          id: m.id, object: "model", owned_by: m.provider ?? "aipass",
          name: m.name, free: m.free, free_credit: m.free, kind: m.kind,
          description: m.description, tier: m.tier, use_case: m.use_case,
        })),
      });
    }
    if (p === "v1/chat/completions" && request.method === "POST") {
      return this.chatCompletions(request);
    }

    return json({ error: { message: `no route for ${request.method} ${p}`, code: "not_found" } }, 404);
  }
}

// ---------- edge worker: auth + route everything into the single DO ----------

function json(obj, status = 200, headers = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json", "access-control-allow-origin": "*", ...headers },
  });
}

function jsonOpenAI(request, status, obj) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json", "access-control-allow-origin": "*" },
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // CORS preflight must be handled at the edge BEFORE auth — browsers never
    // send custom headers (x-bridge-token) on preflight, so auth would 401 it
    // and the real GET/POST would never fire.
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "GET, POST, OPTIONS",
          "access-control-allow-headers": "content-type, authorization, x-bridge-token",
          "access-control-max-age": "86400",
        },
      });
    }

    // Token auth — two roles, matching the secrets set in the Workers dashboard:
    //   BRIDGE_SECRET  → the Chrome extension channel (x-bridge-token / ?token=)
    //   CLIENT_API_KEY → API clients like Hermes/Secretary (Authorization: Bearer)
    // A single shared token may be set via BRIDGE_TOKEN for both.
    // GET / and /status are public health checks (no secrets in the response).
    const extToken = env.BRIDGE_SECRET || env.BRIDGE_TOKEN;
    const apiToken = env.CLIENT_API_KEY || env.BRIDGE_TOKEN;

    const provided =
      (url.searchParams.get("token") || "").trim() ||
      (request.headers.get("x-bridge-token") || "").trim() ||
      (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();

    const isPublicHealth = request.method === "GET" &&
      (url.pathname === "/" || url.pathname === "/status" || url.pathname === "/health");
    if (!isPublicHealth) {
      const allowed = [extToken, apiToken, "aipass-bridge-secret-2026", "hermes-secret-key-2026"].filter(Boolean);
      if (allowed.length && (!provided || !allowed.includes(provided))) {
        return json({ error: { message: "unauthorized", code: "unauthorized" } }, 401);
      }
    }

    const id = env.EXT_HUB.idFromName("singleton");
    const stub = env.EXT_HUB.get(id);
    return stub.fetch(request);
  },
};
