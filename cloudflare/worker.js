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

export class ExtHub {
  constructor(state, env) {
    this.env = env;
    this.extWriter = null;      // SSE writer currently held for the extension
    this.extReady = false;      // extension sent its `ready` event
    this.jobs = new Map();      // jobId -> {chunks: [], resolve, timer}
    this.models = MODEL_FALLBACK;
    this.defaultModel = MODEL_FALLBACK[0];
    this.lastExtSeen = 0;
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
    this.extWriter = writable.getWriter();
    this.extReady = false;
    this.lastExtSeen = Date.now();
    const enc = new TextEncoder();

    // Greet exactly like the local bridge does
    this.extWriter.write(enc.encode(this.sseLine("ready", { clientId: "cf-hub" })));

    // Heartbeat comment keeps intermediaries from closing the stream
    const ping = setInterval(() => {
      this.extWriter?.write(enc.encode(": ping\n\n")).catch(() => clearInterval(ping));
    }, 15000);

    // Extension reconnects every ~4 min (Chrome service-worker ceiling);
    // clean up when the stream cancels.
    request.signal.addEventListener("abort", () => {
      clearInterval(ping);
      this.extWriter = null;
      this.extReady = false;
      for (const [jobId, job] of this.jobs) {
        job.reject(new Error("extension disconnected"));
        this.jobs.delete(jobId);
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
    } else if (kind === "done") {
      clearTimeout(job.timer);
      this.jobs.delete(body.jobId);
      job.resolve({ chunks: job.chunks, finishReason: body.finishReason || "stop" });
    } else if (kind === "error") {
      clearTimeout(job.timer);
      this.jobs.delete(body.jobId);
      job.reject(new Error(body.message || "extension error"));
    }
    return json({ ok: true });
  }

  // ---------- client API ----------
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
    const jobId = crypto.randomUUID();

    const job = { chunks: [], resolve: null, reject: null, timer: null };
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
    await this.extWriter.write(new TextEncoder().encode(
      this.sseLine("job", { jobId, kind: "chat", modelId, text })
    ));

    try {
      const { chunks, finishReason } = await result;
      const out = chunks.map(p => p?.text ?? "").join("");
      return jsonOpenAI(request, 200, {
        id: `chatcmpl-${jobId.slice(0, 24)}`,
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model: modelId,
        choices: [{ index: 0, message: { role: "assistant", content: out }, finish_reason: finishReason }],
        usage: {
          prompt_tokens: Math.ceil(text.length / 4),
          completion_tokens: Math.ceil(out.length / 4),
          total_tokens: Math.ceil((text.length + out.length) / 4),
        },
      });
    } catch (err) {
      return jsonOpenAI(request, 502, {
        error: { message: String(err.message || err), code: "upstream_error" },
      });
    }
  }

  async status(host) {
    return json({
      ok: true,
      service: "aipass-bridge-cloud-hub",
      architecture: "Cloudflare Worker + Durable Object (SSE hub)",
      extensions: this.isExtConnected ? 1 : 0,
      defaultModel: this.defaultModel,
      models: this.models.map(id => ({ id })),
      credits: null, // quota figures flow with the extension session; extend when needed
      mcp_endpoint: `https://${host}/mcp (TODO)`,
    });
  }

  async fetch(request) {
    const url = new URL(request.url);
    const p = url.pathname.replace(/^\/+|\/+$/g, "");

    if (request.method === "OPTIONS") return new Response(null, { status: 204 });

    if (p === "ext/events") return this.extEvents(request);
    if (p === "ext/chunk") return this.extPost(request, "chunk");
    if (p === "ext/done") return this.extPost(request, "done");
    if (p === "ext/error") return this.extPost(request, "error");

    if (p === "status" || p === "health") return this.status(url.host);
    if (p === "v1/models") {
      return json({ object: "list", data: this.models.map(id => ({ id, object: "model" })) });
    }
    if (p === "v1/chat/completions" && request.method === "POST") {
      return this.chatCompletions(request);
    }

    return json({ error: { message: `no route for ${request.method} ${p}`, code: "not_found" } }, 404);
  }
}

// ---------- edge worker: auth + route everything into the single DO ----------

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json", "access-control-allow-origin": "*" },
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

    // Token auth — two roles, matching the secrets set in the Workers dashboard:
    //   BRIDGE_SECRET  → the Chrome extension channel (x-bridge-token / ?token=)
    //   CLIENT_API_KEY → API clients like Hermes/Secretary (Authorization: Bearer)
    // A single shared token may be set via BRIDGE_TOKEN for both.
    const extToken = env.BRIDGE_SECRET || env.BRIDGE_TOKEN;
    const apiToken = env.CLIENT_API_KEY || env.BRIDGE_TOKEN;

    const provided =
      url.searchParams.get("token") ||
      request.headers.get("x-bridge-token") ||
      (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");

    // Extension channel paths must carry the bridge secret; everything else
    // (the OpenAI-compatible API, /status) must carry the client API key.
    const isExtPath = url.pathname.startsWith("/ext/");
    const required = isExtPath ? extToken : apiToken;
    if (required && provided !== required) {
      return json({ error: { message: "unauthorized", code: "unauthorized" } }, 401);
    }

    const id = env.EXT_HUB.idFromName("singleton");
    const stub = env.EXT_HUB.get(id);
    return stub.fetch(request);
  },
};
