// Service worker: holds the long-lived connection to the local bridge and
// routes each job into a de.aipass.net tab.
//
// The connection lives here rather than in the content script because an
// https:// page talking to http://127.0.0.1 runs into mixed-content and
// Private Network Access checks; an extension request with host_permissions
// does not.
const DEFAULT_BRIDGE = 'https://aipass-web-bridge.taijustarrett417.workers.dev';
const RECONNECT_MS = 3000;
const CYCLE_MS = 4 * 60 * 1000; // reconnect before Chrome's long-request ceiling
const CLOUDFLARE_RETRY_DELAY_MS = 1200;

// ─── Lease Constants ──────────────────────────────────────────────────────
const LEASE_TTL_MS = 1000;        // failover cutoff
const HEARTBEAT_INTERVAL_MS = 250; // heartbeat renewal interval

let controller = null;
let connected = false;
let lastError = '';
const jobTabs = new Map();

// Protocol v2 bridge channel
let bridgeController = null;
let bridgeConnected = false;

// A Cloudflare 403 is an edge/session failure, not an application response.
// Reloading the logged-in chat tab refreshes the challenge/cookies, after
// which the original request can be attempted once without asking the user to
// manually repair the tab. Never retry a response that contains application
// content: a second POST could spend credits twice.
function isCloudflareForbidden(message) {
  const text = String(message ?? '');
  return /(?:aipass returned|returned) 403\b/i.test(text)
    && /cloudflare|cf-ray|attention required/i.test(text);
}

// The content script's keepalive port only exists while a de.aipass.net tab is
// open. With no tab the worker is evicted, the SSE stream dies with it, and the
// bridge reports the extension as gone until the one-minute alarm revives it —
// so an offscreen document holds a port of its own, which is a context Chrome
// does not discard.
//
// One in-flight creation at a time: hasDocument() then createDocument() is
// check-then-act, and this is called from the alarm, from connect(), and on a
// port dropping. Same shape as connect() and the model refresh below.
let offscreenSetup = null;

function ensureOffscreenDocument() {
  if (typeof chrome.offscreen === 'undefined') return Promise.resolve();
  if (offscreenSetup) return offscreenSetup;
  offscreenSetup = (async () => {
    try {
      if (await chrome.offscreen.hasDocument?.()) return;
      await chrome.offscreen.createDocument({
        url: 'offscreen.html',
        // The enum has no value for "keep the worker alive", which is the only
        // thing this document does. BLOBS is a stand-in; nothing here handles a
        // blob, and the justification says what is really going on.
        reasons: ['BLOBS'],
        justification: 'Holds a port open so the service worker survives while no aipass tab is open',
      });
    } catch (err) {
      // Losing a creation race is the outcome we wanted anyway.
      if (!/single offscreen document/i.test(String(err?.message ?? err))) {
        console.warn('[aipass-bg] offscreen document:', err);
      }
    } finally {
      offscreenSetup = null;
    }
  })();
  return offscreenSetup;
}

const bridgeUrl = async () => {
  try {
    const res = await chrome.storage.local.get(['bridgeUrl', 'userConfigured']);
    const val = res?.bridgeUrl ? String(res.bridgeUrl).trim() : '';
    if (!val || (!res?.userConfigured && (val === 'http://127.0.0.1:8787' || val === 'http://localhost:8787'))) {
      return DEFAULT_BRIDGE;
    }
    return val;
  } catch {
    return DEFAULT_BRIDGE;
  }
};

// Optional shared secret for remote bridges (e.g. Cloudflare Worker hub).
// Sent as a header on every request; the local bridge ignores it.
const DEFAULT_REMOTE_TOKEN = 'aipass-bridge-secret-2026';

const bridgeToken = async () => {
  try {
    const res = await chrome.storage.local.get('bridgeToken');
    const val = res?.bridgeToken ? String(res.bridgeToken).trim() : '';
    if (val) return val;
    return DEFAULT_REMOTE_TOKEN;
  } catch {
    return DEFAULT_REMOTE_TOKEN;
  }
};

async function authHeaders() {
  const token = await bridgeToken();
  const safeToken = token ? String(token).replace(/[^\x00-\xFF]/g, '') : '';
  return safeToken ? { 'content-type': 'application/json', 'x-bridge-token': safeToken }
                   : { 'content-type': 'application/json' };
}

async function post(path, body) {
  try {
    const res = await fetch(`${await bridgeUrl()}${path}`, {
      method: 'POST',
      headers: await authHeaders(),
      body: JSON.stringify(body),
    });
    // Retrying would duplicate deltas, so a refused post is surfaced, not
    // repeated — without this a rejected body (too large, unknown job) vanished
    // and the caller waited out its timeout for a reply that never came.
    if (!res.ok) {
      lastError = `bridge refused ${path} with ${res.status}`;
      console.warn('[aipass-bg] POST rejected:', path, res.status);
    }
  } catch (err) {
    lastError = String(err?.message ?? err);
    console.warn('[aipass-bg] POST error:', path, lastError);
  }
}

async function postBridge(body) {
  try {
    const res = await fetch(`${await bridgeUrl()}/bridge/message`, {
      method: 'POST',
      headers: await authHeaders(),
      body: JSON.stringify(body),
    });
    if (!res.ok) console.warn('[aipass-bg] bridge message rejected:', res.status);
  } catch (err) {
    console.warn('[aipass-bg] bridge message error:', String(err?.message ?? err));
  }
}

async function refreshModels() {
  try {
    const res = await fetch(`${await bridgeUrl()}/v1/models/refresh`, {
      method: 'POST',
      headers: await authHeaders(),
      body: '{}',
    });
    if (!res.ok) console.warn('[aipass-bg] model refresh rejected:', res.status);
  } catch (err) {
    // The bridge continues serving its persistent/static model fallback.
    console.warn('[aipass-bg] model refresh unavailable:', String(err?.message ?? err));
  }
}

async function findChatTab() {
  const tabs = await chrome.tabs.query({ url: ['https://*.aipass.net/*', 'https://aipass.net/*'] });
  if (!tabs.length) return null;
  const live = tabs.filter((t) => !t.discarded && t.status !== 'unloaded');
  const pool = live.length ? live : tabs;
  // Prefer a tab already sitting on a chat route.
  return pool.find((t) => t.url?.includes('/chat')) ?? pool[0];
}

function waitForComplete(tabId, timeoutMs = 15_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { chrome.tabs.onUpdated.removeListener(onUpdated); reject(new Error('tab did not finish loading')); }, timeoutMs);
    function onUpdated(id, info) {
      if (id !== tabId || info.status !== 'complete') return;
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      resolve();
    }
    chrome.tabs.onUpdated.addListener(onUpdated);
  });
}

async function ensureContentScript(tab) {
  const ping = () => chrome.tabs.sendMessage(tab.id, { type: 'ping' });
  let ok = false;
  try { await ping(); ok = true; } catch { /* not there yet */ }

  if (!ok && (tab.discarded || tab.status === 'unloaded')) {
    await chrome.tabs.reload(tab.id);
    await waitForComplete(tab.id);
  }

  if (!ok) {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, world: 'MAIN', files: ['page.js'] }).catch(() => {});
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, world: 'ISOLATED', files: ['content.js'] }).catch(() => {});
    await ping();
  }
}

async function handleJob(job) {
  // Prefer the leader tab from coordinator
  const leaderTabId = tabCoordinator.getLeaderTabId();
  let tab;
  if (leaderTabId) {
    try {
      tab = await chrome.tabs.get(leaderTabId);
    } catch {
      tabCoordinator.removeTab(leaderTabId);
      tab = await findChatTab();
    }
  } else {
    tab = await findChatTab();
  }
  if (!tab) {
    await post('/ext/error', { jobId: job.jobId, message: 'no de.aipass.net tab is open' });
    return;
  }
  post('/ext/tab', { tabId: tab.id, url: tab.url, jobId: job.jobId, kind: job.kind });
  jobTabs.set(job.jobId, { tabId: tab.id, job, cloudflareRetried: false });
  try {
    await ensureContentScript(tab);
    await chrome.tabs.sendMessage(tab.id, { type: 'run', job });
  } catch (err) {
    jobTabs.delete(job.jobId);
    await post('/ext/error', {
      jobId: job.jobId,
      message: `could not reach the de.aipass.net tab (${tab.url ?? tab.id}): ${err?.message ?? err}`,
    });
  }
}

async function retryAfterCloudflare(jobId, message) {
  const record = jobTabs.get(jobId);
  if (!record || record.cloudflareRetried || !isCloudflareForbidden(message)) return false;
  // A page job has no content yet when the HTTP request itself was denied, so
  // this is the one case where replaying the POST is safe enough to automate.
  if (!['chat', 'create', 'loader'].includes(record.job.kind)) return false;
  record.cloudflareRetried = true;

  try {
    await chrome.tabs.reload(record.tabId);
    await waitForComplete(record.tabId, 30_000);
    await new Promise((resolve) => setTimeout(resolve, CLOUDFLARE_RETRY_DELAY_MS));
    const tab = await chrome.tabs.get(record.tabId);
    await ensureContentScript(tab);
    await chrome.tabs.sendMessage(record.tabId, { type: 'run', job: record.job });
    console.warn('[aipass-bg] Cloudflare 403 recovered by reloading the chat tab');
    return true;
  } catch (err) {
    console.warn('[aipass-bg] Cloudflare recovery failed:', String(err?.message ?? err));
    return false;
  }
}

function handleEvent(name, data) {
  if (name === 'job') handleJob(data);
  else if (name === 'abort') {
    const tabId = jobTabs.get(data.jobId)?.tabId;
    if (tabId != null) chrome.tabs.sendMessage(tabId, { type: 'abort', jobId: data.jobId }).catch(() => {});
    jobTabs.delete(data.jobId);
  } else if (name === 'reload_extension') {
    try { chrome.runtime.reload(); } catch { /* ignore */ }
  } else if (name === 'reload_tab') {
    (async () => {
      const tab = await findChatTab();
      if (tab) chrome.tabs.reload(tab.id).catch(() => {});
    })();
  }
}

async function connect() {
  if (controller) return;
  controller = new AbortController();
  const signal = controller.signal;
  const cycle = setTimeout(() => controller?.abort(), CYCLE_MS);

  ensureOffscreenDocument();

  try {
    const token = await bridgeToken();
    const safeToken = token ? String(token).replace(/[^\x00-\xFF]/g, '') : '';
    const headers = safeToken
      ? { accept: 'text/event-stream', 'x-bridge-token': safeToken }
      : { accept: 'text/event-stream' };
    const res = await fetch(`${await bridgeUrl()}/ext/events`, {
      headers,
      signal,
    });
    if (!res.ok || !res.body) throw new Error(`bridge responded ${res.status}`);

    connected = true;
    lastError = '';
    void refreshModels();
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let pending = '';

    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      pending += decoder.decode(value, { stream: true });

      let cut;
      while ((cut = pending.search(/\r?\n\r?\n/)) !== -1) {
        const frame = pending.slice(0, cut);
        pending = pending.slice(cut + pending.slice(cut).match(/^\r?\n\r?\n/)[0].length);

        let name = 'message';
        const dataLines = [];
        for (const line of frame.split(/\r?\n/)) {
          if (line.startsWith('event:')) name = line.slice(6).trim();
          else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
        }
        if (!dataLines.length) continue; // comment / keepalive
        try { handleEvent(name, JSON.parse(dataLines.join('\n'))); } catch { /* ignore */ }
      }
    }
  } catch (err) {
    if (err?.name !== 'AbortError') lastError = String(err?.message ?? err);
  } finally {
    clearTimeout(cycle);
    connected = false;
    controller = null;
    setTimeout(connect, RECONNECT_MS);
  }
}

async function handleBridgeEvent(name, data) {
  // Protocol v2 messages from BridgeDO
  if (name === 'EXECUTE_REQUEST' || name === 'PREPARE_MODEL' || name === 'CANCEL_REQUEST') {
    const leaderTabId = tabCoordinator.getLeaderTabId();
    let tab = null;
    if (leaderTabId != null) {
      try { tab = await chrome.tabs.get(leaderTabId); }
      catch { tabCoordinator.removeTab(leaderTabId); }
    }
    if (!tab) tab = await findChatTab();
    if (!tab) {
      // Report error back to bridge channel
      await postBridge({ type: 'STREAM_ERROR', requestId: data.requestId, error: 'no de.aipass.net tab is open', code: 'no_tab' });
      return;
    }
    try {
      await ensureContentScript(tab);
      await chrome.tabs.sendMessage(tab.id, { type: name, ...data });
    } catch (err) {
      await postBridge({ type: 'STREAM_ERROR', requestId: data.requestId, error: `could not reach tab: ${err?.message ?? err}`, code: 'tab_unreachable' });
    }
  } else if (name === 'SESSION_READY') {
    // BridgeDO assigned session epoch — forward to leader tab
    const leaderTabId = tabCoordinator.getLeaderTabId();
    let tab = null;
    if (leaderTabId != null) {
      try { tab = await chrome.tabs.get(leaderTabId); } catch { /* failover below */ }
    }
    if (!tab) tab = await findChatTab();
    await tabCoordinator.setSessionEpoch(data.sessionEpoch, false);
    if (tab) {
      try {
        await chrome.tabs.sendMessage(tab.id, {
          type: 'coordinator-role', role: 'leader', sessionEpoch: data.sessionEpoch,
        });
      } catch { /* tab not ready yet */ }
    }
  } else if (name === 'PING') {
    await postBridge({ type: 'PONG' });
  }
}

async function connectBridge() {
  const url = await bridgeUrl();
  // Protocol v2 /bridge channel is for local stateful bridge (127.0.0.1 or localhost);
  // Cloudflare worker hub uses /ext/events (handled by connect()).
  if (!url.startsWith('http://127.0.0.1') && !url.startsWith('http://localhost')) {
    return;
  }
  if (bridgeController) return;
  bridgeController = new AbortController();
  const signal = bridgeController.signal;
  const cycle = setTimeout(() => bridgeController?.abort(), CYCLE_MS);

  try {
    const token = await bridgeToken();
    const res = await fetch(`${await bridgeUrl()}/bridge`, {
      headers: token
        ? { accept: 'text/event-stream', 'x-bridge-token': token }
        : { accept: 'text/event-stream' },
      signal,
    });
    if (!res.ok || !res.body) throw new Error(`bridge channel responded ${res.status}`);

    bridgeConnected = true;
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let pending = '';

    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      pending += decoder.decode(value, { stream: true });

      let cut;
      while ((cut = pending.search(/\r?\n\r?\n/)) !== -1) {
        const frame = pending.slice(0, cut);
        pending = pending.slice(cut + pending.slice(cut).match(/^\r?\n\r?\n/)[0].length);

        let name = 'message';
        const dataLines = [];
        for (const line of frame.split(/\r?\n/)) {
          if (line.startsWith('event:')) name = line.slice(6).trim();
          else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
        }
        if (!dataLines.length) continue;
        try { handleBridgeEvent(name, JSON.parse(dataLines.join('\n'))); } catch { /* ignore */ }
      }
    }
  } catch (err) {
    if (err?.name !== 'AbortError') {
      console.warn('[aipass-bg] bridge channel error:', String(err?.message ?? err));
    }
  } finally {
    clearTimeout(cycle);
    bridgeConnected = false;
    bridgeController = null;
    setTimeout(connectBridge, RECONNECT_MS);
  }
}

// ─── Lease-Based TabCoordinator ───────────────────────────────────────────
// TTL lease leader election with state machine:
//   ACQUIRE_LEASE → HEARTBEAT (loop) → YIELD | REVOKED
// Single active leader at any time. Lease persisted to chrome.storage.session.
const tabCoordinator = {
  ports: new Map(),   // tabId -> port
  leaderId: null,
  leaseExpiry: 0,
  sessionEpoch: 0,
  heartbeatTimer: null,

  // ─── Lease State Machine ───────────────────────────────────────────────

  // ACQUIRE_LEASE: A tab requests to become leader. Succeeds if no leader,
  // lease expired, or the same tab re-acquiring.
  async acquireLease(tabId) {
    try {
      const data = await chrome.storage.session.get(['leaderTabId', 'leaseExpiry']);
      const now = Date.now();
      const noLeader = !data.leaderTabId;
      const leaseExpired = data.leaseExpiry != null && data.leaseExpiry < now;
      const isCurrentLeader = data.leaderTabId === tabId;

      if (!noLeader && !leaseExpired && !isCurrentLeader) return false;

      const expiry = now + LEASE_TTL_MS;
      this.leaderId = tabId;
      this.leaseExpiry = expiry;
      if (!this.sessionEpoch) this.sessionEpoch = now;

      await chrome.storage.session.set({
        leaderTabId: tabId,
        leaseExpiry: expiry,
        sessionEpoch: this.sessionEpoch,
      });

      this.notifyRole(tabId, 'leader', this.sessionEpoch);
      // Demote others
      for (const [id] of this.ports) {
        if (id !== tabId) this.notifyRole(id, 'standby', this.sessionEpoch);
      }
      this._startHeartbeat(tabId);
      console.log('[aipass-bg] lease acquired by tab', tabId, 'until', new Date(expiry).toISOString());
      return true;
    } catch {
      return false;
    }
  },

  // HEARTBEAT: Current leader renews its lease. Extends expiry by LEASE_TTL_MS.
  async heartbeat(tabId) {
    if (this.leaderId !== tabId) return false;
    try {
      const expiry = Date.now() + LEASE_TTL_MS;
      this.leaseExpiry = expiry;
      await chrome.storage.session.set({ leaseExpiry: expiry });
      return true;
    } catch {
      return false;
    }
  },

  // YIELD: Current leader voluntarily gives up leadership. Next tab acquires.
  async yieldLeadership(tabId) {
    if (this.leaderId !== tabId) return;
    console.log('[aipass-bg] tab', tabId, 'yielding leadership');
    this._stopHeartbeat();
    this.leaderId = null;
    this.leaseExpiry = 0;
    await chrome.storage.session.remove(['leaderTabId', 'leaseExpiry']);

    // Failover: elect next available tab
    const next = this.ports.keys().next();
    if (!next.done) {
      this.acquireLease(next.value);
    } else {
      chrome.storage.session.remove('sessionEpoch');
      console.log('[aipass-bg] no tabs left for leader election');
    }
  },

  // REVOKED: Leadership was taken from this tab (failover or lease expired).
  // Internal transition — notifies the demoted tab.
  async revokeLease(tabId) {
    if (this.leaderId !== tabId) return;
    console.log('[aipass-bg] lease revoked from tab', tabId);
    this._stopHeartbeat();
    this.notifyRole(tabId, 'revoked', this.sessionEpoch);
    this.leaderId = null;
    this.leaseExpiry = 0;
    await chrome.storage.session.remove(['leaderTabId', 'leaseExpiry']);

    // Elect next available tab
    const next = this.ports.keys().next();
    if (!next.done) {
      this.acquireLease(next.value);
    } else {
      chrome.storage.session.remove('sessionEpoch');
      console.log('[aipass-bg] no tabs left for leader election');
    }
  },

  // ─── Heartbeat Timer ───────────────────────────────────────────────────

  _startHeartbeat(tabId) {
    this._stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this.leaderId === tabId) {
        this.heartbeat(tabId);
      } else {
        this._stopHeartbeat();
      }
    }, HEARTBEAT_INTERVAL_MS);
  },

  _stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  },

  // ─── Port Management ───────────────────────────────────────────────────

  addTab(tabId, port) {
    this.ports.set(tabId, port);
    // Attempt to acquire lease (first-tab-wins if no active lease)
    this.acquireLease(tabId);
  },

  removeTab(tabId) {
    this.ports.delete(tabId);
    if (this.leaderId === tabId) {
      this.revokeLease(tabId);
    }
  },

  async setSessionEpoch(epoch, announce = true) {
    if (epoch == null) return;
    this.sessionEpoch = epoch;
    await chrome.storage.session.set({ sessionEpoch: epoch });
    if (announce) await postBridge({ type: 'SESSION_READY', sessionEpoch: epoch, protocolVersion: 2 });
    for (const [id] of this.ports) this.notifyRole(id, id === this.leaderId ? 'leader' : 'standby', epoch);
  },

  notifyRole(tabId, role, sessionEpoch = this.sessionEpoch) {
    const port = this.ports.get(tabId);
    if (port) {
      try {
        port.postMessage({ type: 'coordinator-role', role, sessionEpoch });
      } catch { /* port closed */ }
    }
  },

  // ─── Leader Query ─────────────────────────────────────────────────────

  getLeaderTabId() {
    if (this.leaderId && this.leaseExpiry > Date.now()) {
      return this.leaderId;
    }
    // Lease expired — clear local leader and trigger re-election
    if (this.leaderId && this.leaseExpiry > 0 && this.leaseExpiry <= Date.now()) {
      console.log('[aipass-bg] leader lease expired for tab', this.leaderId);
      const expired = this.leaderId;
      this.leaderId = null;
      this.leaseExpiry = 0;
      // Reuse the same logic as revokeLease but without the notification
      // since the tab may still be around (just missed heartbeats)
      this.ports.delete(expired);
      const next = this.ports.keys().next();
      if (!next.done) {
        this.acquireLease(next.value);
      }
    }
    return this.leaderId;
  },

  getLeaderPort() {
    if (!this.leaderId) return null;
    return this.ports.get(this.leaderId) || null;
  },
};

// A content script and the offscreen document each hold one of these open, which
// is what stops Chrome evicting the worker.
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'keepalive' && port.name !== 'offscreen-keepalive' && port.name !== 'aipass-tab') return;
  // Leader election for content script keepalive ports
  if (port.name === 'keepalive' || port.name === 'aipass-tab') {
    const tabId = port.sender?.tab?.id;
    if (tabId != null) {
      if (port.name === 'aipass-tab') {
        tabCoordinator.addTab(tabId, port);
      }
      // Restore sessionEpoch from storage on (re)connect
      chrome.storage.session.get(['sessionEpoch', 'leaderTabId', 'leaseExpiry'], (data) => {
        if (chrome.runtime.lastError) return;
        if (data.sessionEpoch) tabCoordinator.sessionEpoch = data.sessionEpoch;
        // If we have a tab and there's an expired lease, try to acquire
        if (data.leaderTabId && data.leaseExpiry && data.leaseExpiry < Date.now()) {
          tabCoordinator.acquireLease(tabId);
        }
      });
    }
  }
  connect(); // a tab just appeared, or the worker just woke
  connectBridge();
  port.onMessage.addListener(() => {});
  
  port.onDisconnect.addListener(() => {
    void chrome.runtime.lastError;
    if (port.name === 'offscreen-keepalive') ensureOffscreenDocument();
    if (port.name === 'aipass-tab' && port.sender?.tab?.id != null) {
      tabCoordinator.removeTab(port.sender.tab.id);
    }
  });
});

chrome.tabs.onRemoved.addListener((tabId) => {
  tabCoordinator.removeTab(tabId);
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'from-page') {
    const p = msg.payload;
    if (p.kind === 'chunk') post('/ext/chunk', { jobId: p.jobId, parts: p.parts });
    else if (p.kind === 'done') { jobTabs.delete(p.jobId); post('/ext/done', { jobId: p.jobId, finishReason: p.finishReason }); }
    else if (p.kind === 'error') {
      void retryAfterCloudflare(p.jobId, p.message).then((retried) => {
        if (!retried) {
          jobTabs.delete(p.jobId);
          post('/ext/error', { jobId: p.jobId, message: p.message });
        }
      });
    }
    else if (p.kind === 'loader') { jobTabs.delete(p.jobId); post('/ext/loader', { jobId: p.jobId, raw: p.raw, message: p.message }); }
    
    // Protocol v2 messages from page.js
    if (p.type === 'MODELS_DISCOVERED' || p.type === 'MODEL_READY'
      || p.type === 'STREAM_CHUNK' || p.type === 'STREAM_DONE'
      || p.type === 'STREAM_ERROR' || p.type === 'SESSION_READY'
      || p.type === 'MODEL_UPDATED') {
      postBridge(p);
    }
    return;
  }

  // ─── Lease State Machine Messages ──────────────────────────────────────
  // Content scripts use these to participate in leader election.
  if (msg?.type === 'acquire_lease') {
    const tabId = _sender?.tab?.id;
    if (tabId != null) {
      tabCoordinator.acquireLease(tabId).then((ok) => {
        sendResponse({ ok, leader: tabCoordinator.leaderId === tabId });
      });
      return true; // async response
    }
    sendResponse({ ok: false });
    return true;
  }

  if (msg?.type === 'heartbeat') {
    const tabId = _sender?.tab?.id;
    if (tabId != null) {
      tabCoordinator.heartbeat(tabId).then((ok) => {
        sendResponse({ ok, leader: tabCoordinator.leaderId === tabId, leaseExpiry: tabCoordinator.leaseExpiry });
      });
      return true;
    }
    sendResponse({ ok: false });
    return true;
  }

  if (msg?.type === 'yield_leadership') {
    const tabId = _sender?.tab?.id;
    if (tabId != null) {
      tabCoordinator.yieldLeadership(tabId);
      sendResponse({ ok: true });
    }
    return true;
  }

  if (msg?.type === 'get_lease_state') {
    sendResponse({
      leaderId: tabCoordinator.leaderId,
      leaseExpiry: tabCoordinator.leaseExpiry,
      sessionEpoch: tabCoordinator.sessionEpoch,
      isLeader: _sender?.tab?.id === tabCoordinator.leaderId,
    });
    return true;
  }

  if (msg?.type === 'status') {
    (async () => {
      const tab = await findChatTab();
      sendResponse({
        connected,
        bridgeConnected,
        lastError,
        bridgeUrl: await bridgeUrl(),
        tab: tab ? { id: tab.id, url: tab.url } : null,
        activeJobs: jobTabs.size,
      });
    })();
    return true;
  }
  if (msg?.type === 'reconnect') { controller?.abort(); bridgeController?.abort(); connect(); connectBridge(); sendResponse({ ok: true }); return true; }
});

// The worker can still be evicted; the alarm brings it back, and the connect()
// guard makes a duplicate call harmless.
chrome.alarms.create('keepalive', { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener(() => {
  ensureOffscreenDocument();
  connect();
  connectBridge();
});

async function initDefaults() {
  try {
    const existing = await chrome.storage.local.get(['bridgeUrl', 'bridgeToken', 'userConfigured']);
    const updates = {};
    if (!existing.bridgeUrl || (!existing.userConfigured && (existing.bridgeUrl === 'http://127.0.0.1:8787' || existing.bridgeUrl === 'http://localhost:8787'))) {
      updates.bridgeUrl = DEFAULT_BRIDGE;
    }
    if (!existing.bridgeToken) {
      updates.bridgeToken = DEFAULT_REMOTE_TOKEN;
    }
    if (Object.keys(updates).length > 0) {
      await chrome.storage.local.set(updates);
    }
  } catch (err) {
    console.warn('[aipass-bg] error initializing storage defaults:', err);
  }
}

chrome.runtime.onStartup.addListener(async () => {
  await initDefaults();
  ensureOffscreenDocument();
  connect();
  connectBridge();
});

chrome.runtime.onInstalled.addListener(async () => {
  await initDefaults();
  ensureOffscreenDocument();
  connect();
  connectBridge();
});

// Initialize immediately
void initDefaults().then(() => {
  ensureOffscreenDocument();
  connect();
  connectBridge();
});
