import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
import worker, {
  ExtHub,
  decodeTurboStream,
  findValue,
  extractModels,
} from "../cloudflare/worker.js";

const CONVERSATIONS_LOADER_URL = "/loaders/list-conversations.data?_routes=routes%2Floaders%2Flist-converstaions";
const MODELS_LOADER_URL = "/loaders/list-models.data?_routes=routes%2Floaders%2Flist-models";
const MODEL_FALLBACK = ["gemini-3.1-flash-lite", "claude-sonnet-5@default"];

test("decodeTurboStream: parses turbo-stream flat reference pools correctly", () => {
  const turboPayload = JSON.stringify([
    { _1: 2 },
    "conversationId",
    "conv-test-12345-67890",
  ]);
  const decoded = decodeTurboStream(turboPayload);
  assert.equal(typeof decoded, "object");
  assert.equal(decoded.conversationId, "conv-test-12345-67890");
});

test("findValue: locates nested conversationId and id keys", () => {
  const treeA = { data: { conversationId: "conv-from-create-conv" } };
  assert.equal(findValue(treeA, "conversationId"), "conv-from-create-conv");

  const treeB = { data: { conversation: { id: "conv-from-temp-chat" } } };
  assert.equal(findValue(treeB, "id"), "conv-from-temp-chat");

  assert.equal(findValue(treeB, "nonexistent"), null);
});

test("extractModels: extracts valid selectable models and identifies free models", () => {
  const mockDecoded = [
    {
      id: "gemini-3.1-flash-lite",
      displayName: "Gemini 3.1 Flash Lite",
      provider: "google",
      selectable: true,
      ready: true,
      isFreeCredit: true,
    },
    {
      id: "claude-3-7-sonnet",
      displayName: "Claude 3.7 Sonnet",
      provider: "anthropic",
      selectable: true,
      ready: true,
      isFreeCredit: false,
    },
    {
      id: "unready-model",
      displayName: "Unready Model",
      selectable: true,
      ready: false,
    },
  ];

  const extracted = extractModels(mockDecoded);
  assert.equal(extracted.length, 2);
  const flashLite = extracted.find((m) => m.id === "gemini-3.1-flash-lite");
  assert.ok(flashLite);
  assert.equal(flashLite.free, true);
  assert.equal(flashLite.kind, "chat");

  const sonnet = extracted.find((m) => m.id === "claude-3-7-sonnet");
  assert.ok(sonnet);
  assert.equal(sonnet.free, false);
});

test("ExtHub: disconnected state returns 503 for chat completions", async () => {
  const hub = new ExtHub({}, {});
  assert.equal(hub.isExtConnected, false);

  const req = new Request("https://hub.internal/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: "gemini-3.1-flash-lite",
      messages: [{ role: "user", content: "hello" }],
    }),
  });

  const res = await hub.chatCompletions(req);
  assert.equal(res.status, 503);
  const body = await res.json();
  assert.equal(body.error.code, "unavailable");
});

test("ExtHub: resolveConversation uses conversationCache when present", async () => {
  const hub = new ExtHub({}, {});
  hub.conversationCache = "cached-conv-id-999";

  const resolved = await hub.resolveConversation("gemini-3.1-flash-lite");
  assert.equal(resolved, "cached-conv-id-999");
});

test("ExtHub: resolveConversation loads existing active conversation from session", async () => {
  const hub = new ExtHub({}, {});

  hub.extWriter = { write: async () => {} };
  hub.extReady = true;

  // Intercept runLoaderJob to simulate returning conversations list
  hub.runLoaderJob = async (url) => {
    assert.equal(url, CONVERSATIONS_LOADER_URL);
    // Return turbo-stream fixture with 2 conversations
    return JSON.stringify([
      [1, 2],
      { _3: 4, _5: 6 },
      { _3: 7, _5: 8 },
      "id", "conv-old",
      "updatedAt", "2026-09-17T10:00:00Z",
      "conv-latest", "2026-09-17T12:00:00Z",
    ]);
  };

  const resolved = await hub.resolveConversation("gemini-3.1-flash-lite");
  assert.equal(resolved, "conv-latest");
  assert.equal(hub.conversationCache, "conv-latest");
});

test("ExtHub: resolveConversation falls back to createConversation if no active conversations exist", async () => {
  const hub = new ExtHub({}, {});
  hub.extWriter = { write: async () => {} };
  hub.extReady = true;

  // Mock empty conversation list
  hub.loadConversations = async () => [];

  // Mock createConversation returning fresh temporary id
  hub.runCreateJob = async () => {
    return JSON.stringify([
      { _1: 2 },
      "id",
      "fresh-temp-conv-888",
    ]);
  };

  const resolved = await hub.resolveConversation("gemini-3.1-flash-lite");
  assert.equal(resolved, "fresh-temp-conv-888");
  assert.equal(hub.conversationCache, "fresh-temp-conv-888");
});

test("ExtHub: runJob dispatches SSE line and handles chunks and done", async () => {
  const hub = new ExtHub({}, {});
  let sentData = null;
  hub.extWriter = {
    write: async (encoded) => {
      sentData = new TextDecoder().decode(encoded);
    },
  };
  hub.extReady = true;

  const collectedChunks = [];
  const jobPromise = hub.runJob(
    { kind: "chat", modelId: "gemini-3.1-flash-lite", text: "hi", conversationId: "conv-1" },
    (delta) => collectedChunks.push(delta)
  );

  assert.ok(sentData);
  assert.match(sentData, /event: job/);

  // Extract jobId
  const match = sentData.match(/"jobId":"([^"]+)"/);
  assert.ok(match);
  const jobId = match[1];

  // Simulate extension streaming back chunks
  await hub.extPost(
    new Request("https://hub.internal/ext/chunk", {
      method: "POST",
      body: JSON.stringify({ jobId, parts: [{ kind: "text", text: "Hello" }, { kind: "text", text: " World" }] }),
    }),
    "chunk"
  );

  assert.deepEqual(collectedChunks, ["Hello", " World"]);

  // Simulate extension done
  await hub.extPost(
    new Request("https://hub.internal/ext/done", {
      method: "POST",
      body: JSON.stringify({ jobId, finishReason: "stop" }),
    }),
    "done"
  );

  const result = await jobPromise;
  assert.equal(result.finishReason, "stop");
  assert.equal(hub.jobs.size, 0);
});

test("ExtHub: chatCompletions returns formatted OpenAI completion", async () => {
  const hub = new ExtHub({}, {});
  hub.conversationCache = "test-conv-123";
  hub.extWriter = { write: async () => {} };
  hub.extReady = true;

  // Mock chat execution
  hub.runChatJob = async (text, modelId, conversationId) => {
    return {
      chunks: [{ text: "สวัสดีครับ ยินดีที่ได้คุยกัน!" }],
      finishReason: "stop",
    };
  };

  const req = new Request("https://hub.internal/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: "gemini-3.1-flash-lite",
      messages: [{ role: "user", content: "สวัสดีครับ" }],
    }),
  });

  const res = await hub.chatCompletions(req);
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.object, "chat.completion");
  assert.equal(json.model, "gemini-3.1-flash-lite");
  assert.equal(json.choices[0].message.content, "สวัสดีครับ ยินดีที่ได้คุยกัน!");
  assert.equal(json.choices[0].finish_reason, "stop");
  assert.ok(json.latency_ms >= 0);
});

test("ExtHub: reload endpoints emit reload_extension and reload_tab SSE events", async () => {
  const hub = new ExtHub({}, {});
  const emittedEvents = [];
  hub.extWriter = {
    write: async (encoded) => {
      emittedEvents.push(new TextDecoder().decode(encoded));
    },
  };

  // Test /ext/reload
  const reloadRes = await hub.fetch(new Request("https://hub.internal/ext/reload", { method: "POST" }));
  assert.equal(reloadRes.status, 200);
  assert.ok(emittedEvents.some((e) => e.includes("event: reload_extension")));

  // Test /ext/reload-tab
  const reloadTabRes = await hub.fetch(new Request("https://hub.internal/ext/reload-tab", { method: "POST" }));
  assert.equal(reloadTabRes.status, 200);
  assert.ok(emittedEvents.some((e) => e.includes("event: reload_tab")));
});

test("Chrome Extension: defaults and manifests are properly configured for Kiwi / Cloudflare", () => {
  const rootPkg = JSON.parse(fs.readFileSync(path.join(__dirname, "../package.json"), "utf8"));
  const coreManifest = JSON.parse(fs.readFileSync(path.join(__dirname, "../packages/core/aipass-bridge/extension/manifest.json"), "utf8"));
  const releaseManifest = JSON.parse(fs.readFileSync(path.join(__dirname, "../release/chrome-extension/manifest.json"), "utf8"));

  assert.equal(coreManifest.version, rootPkg.version);
  assert.equal(releaseManifest.version, rootPkg.version);

  const bgSource = fs.readFileSync(path.join(__dirname, "../packages/core/aipass-bridge/extension/background.js"), "utf8");
  assert.ok(bgSource.includes("const DEFAULT_BRIDGE = 'https://aipass-web-bridge.taijustarrett417.workers.dev';"));
  // v0.6.2: token is injected at build time by scripts/build-extension.py;
  // the source tree must carry only the placeholder, never a literal token.
  assert.ok(bgSource.includes("const DEFAULT_REMOTE_TOKEN = '__BRIDGE_AUTH_TOKEN__';"));

  const popupSource = fs.readFileSync(path.join(__dirname, "../packages/core/aipass-bridge/extension/popup.js"), "utf8");
  assert.ok(popupSource.includes("DEFAULT_BRIDGE"));

  const popupHtml = fs.readFileSync(path.join(__dirname, "../packages/core/aipass-bridge/extension/popup.html"), "utf8");
  assert.ok(popupHtml.includes("value=\"https://aipass-web-bridge.taijustarrett417.workers.dev\""));

  const extensionFiles = ["background.js", "popup.js", "popup.html", "content.js", "page.js", "offscreen.js", "manifest.json"]
    .map((f) => fs.readFileSync(path.join(__dirname, "../packages/core/aipass-bridge/extension", f), "utf8"));
  for (const src of extensionFiles) {
    assert.ok(!src.includes("aipass-bridge-secret-2026"), "extension source must not contain the retired default token");
  }
});

test("ExtHub: /registry and /registry/models return 200 with registry metadata and models list", async () => {
  const hub = new ExtHub({}, {});
  hub.modelCatalog = [
    { id: "gemini-3.5-flash-lite", name: "Gemini 3.5 Flash Lite", free: true, kind: "chat" },
    { id: "claude-opus-5-5@azure", name: "Claude Opus 5.5", free: false, kind: "chat" },
  ];
  hub.defaultModel = "gemini-3.5-flash-lite";

  // Test GET /registry
  const regReq = new Request("https://hub.internal/registry", { method: "GET" });
  const regRes = await hub.fetch(regReq);
  assert.equal(regRes.status, 200);
  const regJson = await regRes.json();
  assert.equal(regJson.ok, true);
  assert.equal(regJson.service, "aipass-web-bridge");
  assert.ok(regJson.registry);
  assert.ok(Array.isArray(regJson.data));
  assert.equal(regJson.data.length, 2);
  assert.equal(regJson.data[0].id, "gemini-3.5-flash-lite");

  // Test GET /registry/models
  const regModelsReq = new Request("https://hub.internal/registry/models", { method: "GET" });
  const regModelsRes = await hub.fetch(regModelsReq);
  assert.equal(regModelsRes.status, 200);
  const regModelsJson = await regModelsRes.json();
  assert.equal(regModelsJson.object, "list");
  assert.equal(regModelsJson.data.length, 2);
});

test("ExtHub: model remapping remaps gemini-3.1-flash-lite to gemini-3.5-flash-lite when needed", async () => {
  const hub = new ExtHub({}, {});
  hub.modelCatalog = [
    { id: "gemini-3.5-flash-lite", name: "Gemini 3.5 Flash Lite", free: true, kind: "chat" },
  ];
  hub.defaultModel = "gemini-3.5-flash-lite";
  hub.conversationCache = "test-conv-123";
  hub.extWriter = { write: async () => {} };
  hub.extReady = true;

  let dispatchedModelId = null;
  hub.runChatJob = async (text, modelId, conversationId) => {
    dispatchedModelId = modelId;
    return {
      chunks: [{ text: "ตอบกลับจาก Gemini 3.5 Flash Lite" }],
      finishReason: "stop",
    };
  };

  const req = new Request("https://hub.internal/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: "gemini-3.1-flash-lite",
      messages: [{ role: "user", content: "ทดสอบการทำงาน" }],
    }),
  });

  const res = await hub.chatCompletions(req);
  assert.equal(res.status, 200);
  assert.equal(dispatchedModelId, "gemini-3.5-flash-lite");
});

test("Edge worker fetch: /registry is accessible without token as public health/discovery", async () => {
  const env = {
    BRIDGE_SECRET: "mock-secret-123",
    CLIENT_API_KEY: "mock-key-456",
  };
  // Edge worker with no EXT_HUB (local-dev fallback check)
  const req = new Request("https://aipass-web-bridge.workers.dev/registry", { method: "GET" });
  const res = await worker.fetch(req, env);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
});

test("Chrome Extension: manifests and background.js support Gemini Enterprise (vertexaisearch.cloud.google)", () => {
  const coreManifest = JSON.parse(fs.readFileSync(path.join(__dirname, "../packages/core/aipass-bridge/extension/manifest.json"), "utf8"));
  const releaseManifest = JSON.parse(fs.readFileSync(path.join(__dirname, "../release/chrome-extension/manifest.json"), "utf8"));

  for (const m of [coreManifest, releaseManifest]) {
    assert.ok(m.host_permissions.some((p) => p.includes("vertexaisearch.cloud.google") || p.includes("cloud.google")));
    const contentScript = m.content_scripts.find((cs) => cs.js.includes("page.js"));
    assert.ok(contentScript.matches.some((p) => p.includes("vertexaisearch.cloud.google") || p.includes("cloud.google")));
  }

  const bgSource = fs.readFileSync(path.join(__dirname, "../release/chrome-extension/background.js"), "utf8");
  assert.ok(bgSource.includes("vertexaisearch.cloud.google") || bgSource.includes("cloud.google"));
});

test("ExtHub: resolveConversation bypasses conversation loader for Vertex / Gemini Enterprise models", async () => {
  const hub = new ExtHub({}, {});
  const convId = await hub.resolveConversation("gemini-enterprise-vertex");
  assert.equal(convId, "vertex-enterprise-session");
});

test("Chrome Extension: background.js routes vertex jobs to vertexaisearch tab and page.js flushes chunks before done", () => {
  const bgSource = fs.readFileSync(path.join(__dirname, "../packages/core/aipass-bridge/extension/background.js"), "utf8");
  assert.ok(bgSource.includes("isVertexJob"));
  assert.ok(bgSource.includes("findVertexTab"));

  const pageSource = fs.readFileSync(path.join(__dirname, "../packages/core/aipass-bridge/extension/page.js"), "utf8");
  assert.ok(pageSource.includes("flush();"));
  assert.ok(pageSource.includes("[Gemini Enterprise @"));
});

test("Chrome Extension: popup and background support per-page online/offline status and usable models listing", () => {
  const bgSource = fs.readFileSync(path.join(__dirname, "../packages/core/aipass-bridge/extension/background.js"), "utf8");
  assert.ok(bgSource.includes("getPagesStatus"));
  assert.ok(bgSource.includes("siteModels"));
  assert.ok(bgSource.includes("pages_status"));

  const popupHtml = fs.readFileSync(path.join(__dirname, "../packages/core/aipass-bridge/extension/popup.html"), "utf8");
  assert.ok(popupHtml.includes("id=\"pageAipass\""));
  assert.ok(popupHtml.includes("id=\"pageVertex\""));
  assert.ok(popupHtml.includes("id=\"usableSection\""));

  const popupJs = fs.readFileSync(path.join(__dirname, "../packages/core/aipass-bridge/extension/popup.js"), "utf8");
  assert.ok(popupJs.includes("renderPages"));
  assert.ok(popupJs.includes("renderUsableModels"));
});

test("Popup UI Deduplication: select#model removed, default banner and ★ Default badge integrated into usableSection", () => {
  const popupHtml = fs.readFileSync(path.join(__dirname, "../packages/core/aipass-bridge/extension/popup.html"), "utf8");
  // <select id="model"> must be removed to avoid duplication
  assert.ok(!popupHtml.includes('<select id="model"'), "popup.html must not contain <select id=\"model\"> dropdown");
  // Must include default model banner / indicator in usableSection
  assert.ok(popupHtml.includes('id="currentDefaultName"'), "popup.html must include currentDefaultName banner");
  // Must maintain filter pills
  assert.ok(popupHtml.includes('data-filter="all"'), "popup.html must include all filter");
  assert.ok(popupHtml.includes('data-filter="free"'), "popup.html must include free filter");
  assert.ok(popupHtml.includes('data-filter="aipass"'), "popup.html must include aipass filter");
  assert.ok(popupHtml.includes('data-filter="vertex"'), "popup.html must include vertex filter");

  const popupJs = fs.readFileSync(path.join(__dirname, "../packages/core/aipass-bridge/extension/popup.js"), "utf8");
  // Must include ★ Default badge
  assert.ok(popupJs.includes("★ Default"), "popup.js must render ★ Default badge on active model");
  // Must include click handler sending POST /config for default model switch
  assert.ok(popupJs.includes("/config"), "popup.js must send POST /config when switching default model");
  assert.ok(popupJs.includes("defaultModel"), "popup.js must handle defaultModel");
});

test("Multi-Provider Tab Isolation & Smart Routing in background.js", () => {
  const bgSource = fs.readFileSync(path.join(__dirname, "../packages/core/aipass-bridge/extension/background.js"), "utf8");
  // Multi-Provider Tab Isolation: no cross-provider fallback in findChatTab or handleJob
  assert.ok(!bgSource.includes("(await findVertexTab()) || (await findAipassTab())"), "findChatTab must not fall back from vertex to aipass");
  assert.ok(!bgSource.includes("(await findAipassTab()) || (await findVertexTab())"), "findChatTab must not fall back from aipass to vertex");
  assert.ok(!bgSource.includes("(await findVertexTab()) || (await findChatTab"), "handleJob must not fall back from vertex to chat tab");

  // tabCoordinator isolation: vertex tabs must not be added to tabCoordinator or steal leadership
  assert.ok(bgSource.includes("vertexPorts.has(tabId)"), "tabCoordinator must reject vertex tabs");
  assert.ok(bgSource.includes("vertex_isolated"), "lease requests from vertex tabs must be rejected");

  // Ensure siteModels.vertex does not contain duplicate gemini-3.5-flash-lite
  const siteModelsMatch = bgSource.match(/const siteModels = ({[\s\S]*?});/);
  assert.ok(siteModelsMatch, "siteModels must be defined");
  const parsedModels = eval(`(${siteModelsMatch[1]})`);
  assert.ok(!parsedModels.vertex.some((m) => m.id === "gemini-3.5-flash-lite"), "siteModels.vertex must not contain gemini-3.5-flash-lite to prevent duplicate default badges");

  // Test getProviderForModel logic by evaluating extracted function
  const funcMatch = bgSource.match(/function getProviderForModel\([\s\S]*?\n\}/);
  const isVertexModelMatch = bgSource.match(/function isVertexModel\([\s\S]*?\n\}/);
  assert.ok(funcMatch && isVertexModelMatch, "routing functions must exist");
  const testScope = {};
  const fnCode = `(function() {
    ${siteModelsMatch[0]}
    ${isVertexModelMatch[0]}
    ${funcMatch[0]}
    return { getProviderForModel, isVertexModel };
  })()`;
  const { getProviderForModel, isVertexModel } = eval(fnCode);

  assert.equal(getProviderForModel("gemini-enterprise-vertex"), "vertex");
  assert.equal(getProviderForModel("vertex/gemini-2.0"), "vertex");
  assert.equal(getProviderForModel("vertex:gemini-pro"), "vertex");
  assert.equal(getProviderForModel("gemini-3.5-flash-lite"), "aipass");
  assert.equal(getProviderForModel("claude-sonnet-5@default"), "aipass");
  assert.equal(getProviderForModel("auto"), "aipass");
  assert.equal(getProviderForModel(null), "aipass");
  assert.equal(getProviderForModel(""), "aipass");
});

test("ExtHub: POST /config updates defaultModel dynamically", async () => {
  const hub = new ExtHub({}, {});
  assert.equal(hub.defaultModel, "gemini-3.5-flash-lite");

  const req = new Request("https://hub.internal/config", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ defaultModel: "gemini-enterprise-vertex" }),
  });
  const res = await hub.fetch(req);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.defaultModel, "gemini-enterprise-vertex");
  assert.equal(hub.defaultModel, "gemini-enterprise-vertex");
});

