// ISOLATED world. Two jobs: relay between page.js and the service worker, and
// keep that worker alive while coordinating tab role (leader/standby).
(() => {
const GEN = (window.__aipassBridgeContentGen ?? 0) + 1;
window.__aipassBridgeContentGen = GEN;
const current = () => window.__aipassBridgeContentGen === GEN;

const TAG = '__aipass_bridge';

let tabPort = null;

// Sending to an evicted worker both wakes it and can transiently fail, so
// retry rather than dropping deltas on the floor. The upstream fetch keeps
// running in the page throughout.
async function toWorker(payload, attempt = 0) {
  if (!chrome.runtime?.id) return;
  try {
    await chrome.runtime.sendMessage({ type: 'from-page', payload });
  } catch {
    if (attempt >= 5 || !chrome.runtime?.id) return;
    setTimeout(() => toWorker(payload, attempt + 1), 200 * (attempt + 1));
  }
}

window.addEventListener('message', (event) => {
  if (!current()) return;
  if (event.source !== window) return;
  const msg = event.data;
  if (!msg || typeof msg !== 'object' || msg[TAG] !== 'res') return;
  const { [TAG]: _, ...payload } = msg;
  if (!payload.requestId && payload.jobId) payload.requestId = payload.jobId;

  // Normalize between legacy kind and Protocol v2 type for robust forwarding
  if (!payload.type && payload.kind) {
    if (payload.kind === 'models_discovered') payload.type = 'MODELS_DISCOVERED';
    else if (payload.kind === 'model_ready') payload.type = 'MODEL_READY';
    else if (payload.kind === 'chunk') payload.type = 'STREAM_CHUNK';
    else if (payload.kind === 'done') payload.type = 'STREAM_DONE';
    else if (payload.kind === 'error' || payload.kind === 'stream_error') payload.type = 'STREAM_ERROR';
    else if (payload.kind === 'session_ready') payload.type = 'SESSION_READY';
  } else if (!payload.kind && payload.type) {
    if (payload.type === 'MODELS_DISCOVERED') payload.kind = 'models_discovered';
    else if (payload.type === 'MODEL_READY') payload.kind = 'model_ready';
    else if (payload.type === 'STREAM_CHUNK') payload.kind = 'chunk';
    else if (payload.type === 'STREAM_DONE') payload.kind = 'done';
    else if (payload.type === 'STREAM_ERROR') payload.kind = 'error';
    else if (payload.type === 'SESSION_READY') payload.kind = 'session_ready';
  }

  toWorker(payload);
  if (tabPort) {
    try { tabPort.postMessage({ type: 'from-page', payload }); } catch { /* ignore */ }
  }
});

function handleIncomingMessage(msg) {
  if (!current()) return;
  if (!msg || typeof msg !== 'object') return;
  const t = msg.type;
  if (t === 'run' || t === 'EXECUTE_REQUEST' || t === 'execute_request') {
    window.postMessage({ [TAG]: 'req', job: msg.job || msg }, '*');
  } else if (t === 'abort' || t === 'CANCEL_REQUEST' || t === 'cancel_request') {
    window.postMessage({ [TAG]: 'abort', jobId: msg.jobId || msg.requestId }, '*');
  } else if (t === 'discover_models' || t === 'DISCOVER_MODELS') {
    window.postMessage({ [TAG]: 'discover_models' }, window.location.origin);
  } else if (t === 'prepare_model' || t === 'PREPARE_MODEL') {
    window.postMessage({ [TAG]: 'prepare_model', requestId: msg.requestId, model: msg.model }, window.location.origin);
  } else if (t === 'coordinator-role' || t === 'coordinator_role') {
    window.postMessage({ [TAG]: 'coordinator-role', role: msg.role, sessionEpoch: msg.sessionEpoch }, window.location.origin);
  } else if (t === 'SESSION_READY' || t === 'session_ready') {
    window.postMessage({ [TAG]: 'session_ready', sessionEpoch: msg.sessionEpoch, buildLabel: msg.buildLabel }, window.location.origin);
  } else if (t === 'MODELS_DISCOVERED' || t === 'models_discovered') {
    window.postMessage({ [TAG]: 'models_discovered', ...msg }, window.location.origin);
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!current()) return;
  if (msg?.type === 'ping' || msg?.type === 'PING') { sendResponse({ ok: true }); return true; }
  handleIncomingMessage(msg);
});

// Holds a dedicated coordinator/keepalive port.
// When tab closes or navigates, background detects disconnect immediately and
// triggers immediate failover.
function connectTabPort() {
  if (!current() || !chrome.runtime?.id) return;
  try {
    tabPort = chrome.runtime.connect({ name: 'aipass-tab' });
  } catch {
    if (!chrome.runtime?.id) return;
    setTimeout(connectTabPort, 1000);
    return;
  }

  tabPort.onMessage.addListener((msg) => {
    if (msg?.type === 'ping' || msg?.type === 'PING') {
      try { tabPort.postMessage({ type: 'pong', t: Date.now() }); } catch { /* ignore */ }
      return;
    }
    handleIncomingMessage(msg);
  });

  const beat = setInterval(() => {
    try { tabPort.postMessage({ type: 'heartbeat', t: Date.now() }); }
    catch { /* port disconnect handles reconnect */ }
  }, 20_000);

  // Cycle before Chrome's 5-minute ceiling to keep worker alive
  const cycle = setTimeout(() => tabPort?.disconnect(), 4 * 60 * 1000);

  tabPort.onDisconnect.addListener(() => {
    clearInterval(beat);
    clearTimeout(cycle);
    tabPort = null;
    if (chrome.runtime?.id) {
      setTimeout(connectTabPort, 250);
    }
  });
}

connectTabPort();
})();
