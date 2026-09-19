import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
import {
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
