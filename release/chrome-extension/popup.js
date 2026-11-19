const $ = (id) => document.getElementById(id);

const DEFAULT_BRIDGE = 'https://aipass-web-bridge.taijustarrett417.workers.dev';
let bridge = DEFAULT_BRIDGE;
let modelSignature = '';
let currentAction = null;   // what the hero button does right now
let pollTimer = null;
let currentFilter = 'all';
let lastPages = null;
let lastSrv = null;

/* ------------------------------------------------------------------ helpers */

// Write only when the value actually changed. The popup polls, and blindly
// re-rendering fights the user mid-selection and makes the panel flicker.
function setText(el, value) {
  const v = String(value);
  if (el.textContent !== v) el.textContent = v;
}

function setClass(el, base, variant) {
  const next = `${base} ${variant}`;
  if (el.className !== next) el.className = next;
}

let toastTimer;
function toast(message) {
  const el = $('toast');
  setText(el, message);
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 1600);
}

const shortId = (id) => (id && id.length > 10 ? `${id.slice(0, 8)}…` : id || '–');

async function authHeaders() {
  const saved = await chrome.storage.local.get(['bridgeToken']);
  const token = saved?.bridgeToken || '';
  const headers = { 'content-type': 'application/json' };
  if (token) headers['x-bridge-token'] = token;
  return headers;
}

/* -------------------------------------------------------------- data access */

async function swStatus() {
  try { return await chrome.runtime.sendMessage({ type: 'status' }); }
  catch { return null; }
}

async function bridgeStatus() {
  try {
    const res = await fetch(`${bridge}/status`, { cache: 'no-store' });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

/* -------------------------------------------------------------- the 3 states */

// Everything the popup shows derives from one of these, so the guidance and the
// action button can never disagree with the indicator.
function derive(sw, srv) {
  if (!sw) {
    return { key: 'bad', label: 'Extension error', pill: 'error',
      hint: 'The extension worker is not responding. Reload it from chrome://extensions.' };
  }
  if (!srv || !sw.connected) {
    return { key: 'bad', label: 'Bridge offline', pill: 'offline',
      hint: 'Nothing is listening on the bridge URL. Start it with `npm run dev`.',
      action: { text: 'Retry connection', run: reconnect } };
  }
  if (!sw.tab) {
    return { key: 'warn', label: 'No AiPASS tab', pill: 'waiting',
      hint: 'The bridge is up, but a de.aipass.net tab must stay open for requests to run.',
      action: { text: 'Open AiPASS tab', run: openChatTab } };
  }
  if (!srv.extensions) {
    return { key: 'warn', label: 'Tab not linked', pill: 'waiting',
      hint: 'The tab is open but has not attached yet. Reloading it usually fixes this.',
      action: { text: 'Reload the tab', run: reloadChatTab } };
  }
  return { key: 'ok', label: 'Connected', pill: 'ready',
    hint: 'Ready. Point any OpenAI-compatible client at the bridge URL.' };
}

/* ----------------------------------------------------------------- actions */

async function reconnect() {
  await chrome.runtime.sendMessage({ type: 'reconnect' }).catch(() => {});
  toast('Reconnecting…');
  setTimeout(render, 400);
}

async function openChatTab() {
  await chrome.tabs.create({ url: CHAT_URL });
  window.close();
}

async function reloadChatTab() {
  const sw = await swStatus();
  if (sw?.tab) await chrome.tabs.reload(sw.tab.id).catch(() => {});
  toast('Reloading tab…');
  setTimeout(render, 600);
}

/* ------------------------------------------------------------------ render */

// The list now carries image, video and music generators alongside chat models,
// so a flat 30-entry dropdown would be unusable. Group it the way the web UI's
// tabs do — the bridge derives the kind, since the loader sends none.
const KIND_LABELS = {
  chat: 'สนทนา · Chat',
  research: 'ค้นคว้าเชิงลึก · Deep research',
  image: 'สร้างรูปภาพ · Image',
  video: 'สร้างวิดีโอ · Video',
  music: 'สร้างเพลง · Music',
};
const KIND_ORDER = ['chat', 'research', 'image', 'video', 'music'];

function renderModels(models, selected) {
  // Legacy select#model was deduplicated into usable models list
}

// Only gemini-3.1-flash-lite is free; everything else draws this pool down, and
// until now the number lived solely in the web UI.
//
// The panel stays visible whenever the bridge answers, because a section that
// vanishes reads as a missing feature rather than as a missing number — and the
// two reasons it can be missing need different fixes. A bridge predating this
// feature omits the key entirely; a current one sends null until a tab reports.
function renderCredits(srv) {
  const box = $('creditsBox');
  if (!srv) { box.hidden = true; return; }
  box.hidden = false;

  const credits = srv.credits;
  if (!credits || !credits.limit) {
    const stale = !('credits' in srv);
    $('creditsFill').style.width = '0%';
    setClass($('creditsFill'), 'meter-fill', '');
    setText($('creditsPct'), '');
    setText($('creditsLeft'), '–');
    setText($('creditsOf'), stale ? 'bridge is out of date — restart it' : 'waiting for the tab');
    setText($('creditsReset'), '');
    return;
  }

  const n = (v) => v.toLocaleString('en-US', { maximumFractionDigits: v < 100 ? 1 : 0 });
  const share = Math.max(0, Math.min(1, credits.available / credits.limit));
  const pct = Math.round(share * 100);

  const fill = $('creditsFill');
  fill.style.width = `${Math.max(share * 100, share > 0 ? 2 : 0)}%`;
  setClass(fill, 'meter-fill', pct <= 5 ? 'gone' : pct <= 20 ? 'low' : '');

  setText($('creditsPct'), `(${pct}%)`);
  setText($('creditsLeft'), n(credits.available));
  setText($('creditsOf'), `of ${n(credits.limit)} left`);
  setText($('creditsReset'), credits.periodEndsAt ? `resets ${credits.periodEndsAt.slice(5, 10)}` : '');
}

function renderPages(pages) {
  if (!pages) return;
  lastPages = pages;

  // 1. de.aipass.net
  const aipass = pages.aipass;
  const aipassOnline = Boolean(aipass?.online);
  setClass($('dotAipass'), 'page-dot', aipassOnline ? 'dot-online' : 'dot-offline');
  setClass($('badgeAipass'), 'badge-status', aipassOnline ? 'badge-online' : 'badge-offline');
  setText($('badgeAipass'), aipassOnline ? 'Online' : 'Offline');
  setText($('subAipass'), aipassOnline ? (aipass.tabUrl ? shortId(aipass.tabUrl) : 'Tab active & ready') : 'Tab offline · Click Open to connect');
  setText($('btnAipassAction'), aipassOnline ? 'Switch' : 'Open');

  const chipsAipass = $('chipsAipass');
  chipsAipass.innerHTML = '';
  const aipassModels = aipass?.models || [];
  if (aipassModels.length) {
    for (const m of aipassModels.slice(0, 5)) {
      const sp = document.createElement('span');
      sp.className = `chip ${m.free ? 'chip-free' : ''}`;
      sp.textContent = m.name || m.id;
      chipsAipass.appendChild(sp);
    }
    if (aipassModels.length > 5) {
      const extra = document.createElement('span');
      extra.className = 'chip';
      extra.textContent = `+${aipassModels.length - 5} more`;
      chipsAipass.appendChild(extra);
    }
  } else {
    const empty = document.createElement('span');
    empty.className = 'chip';
    empty.style.color = 'var(--faint)';
    empty.textContent = aipassOnline ? 'Discovering models…' : 'No tab connected';
    chipsAipass.appendChild(empty);
  }

  // 2. Vertex AI Search (Gemini Enterprise)
  const vertex = pages.vertex;
  const vertexOnline = Boolean(vertex?.online);
  setClass($('dotVertex'), 'page-dot', vertexOnline ? 'dot-online' : 'dot-offline');
  setClass($('badgeVertex'), 'badge-status', vertexOnline ? 'badge-online' : 'badge-offline');
  setText($('badgeVertex'), vertexOnline ? 'Online' : 'Offline');
  setText($('subVertex'), vertexOnline ? (vertex.tabUrl ? shortId(vertex.tabUrl) : 'Tab active & ready') : 'Tab offline · Click Open to connect');
  setText($('btnVertexAction'), vertexOnline ? 'Switch' : 'Open');

  const chipsVertex = $('chipsVertex');
  chipsVertex.innerHTML = '';
  const vertexModels = vertex?.models || [];
  if (vertexModels.length) {
    for (const m of vertexModels) {
      const sp = document.createElement('span');
      sp.className = `chip ${m.free ? 'chip-free' : ''}`;
      sp.textContent = m.name || m.id;
      chipsVertex.appendChild(sp);
    }
  } else {
    const empty = document.createElement('span');
    empty.className = 'chip';
    empty.style.color = 'var(--faint)';
    empty.textContent = vertexOnline ? 'Discovering models…' : 'No tab connected';
    chipsVertex.appendChild(empty);
  }
}

function renderUsableModels(pages, srv, savedDefault = null) {
  const container = $('usableList');
  const countEl = $('usableCount');
  if (!container) return;

  const map = new Map();

  // From Vertex if online
  if (pages?.vertex?.online) {
    for (const m of (pages.vertex.models || [])) {
      map.set(`vertex:${m.id}`, {
        id: m.id,
        name: m.name || m.id,
        source: 'vertex',
        sourceName: 'Vertex AI',
        free: Boolean(m.free || m.isFreeCredit),
        tier: 'enterprise',
      });
    }
  }

  // From AiPASS if online
  if (pages?.aipass?.online) {
    for (const m of (pages.aipass.models || [])) {
      map.set(`aipass:${m.id}`, {
        id: m.id,
        name: m.name || m.id,
        source: 'aipass',
        sourceName: 'AiPASS',
        free: Boolean(m.free || m.free_credit),
        tier: m.free ? 'free' : 'paid',
      });
    }
  }

  // From server bridge status
  if (srv?.models && Array.isArray(srv.models)) {
    for (const m of srv.models) {
      const isVertex = m.id?.includes('vertex') || m.id?.includes('enterprise');
      const srcKey = isVertex ? 'vertex' : 'aipass';
      const key = `${srcKey}:${m.id}`;
      if (!map.has(key)) {
        map.set(key, {
          id: m.id,
          name: m.name || m.id,
          source: srcKey,
          sourceName: isVertex ? 'Vertex AI' : 'AiPASS',
          free: Boolean(m.free || m.free_credit || m.id?.includes('flash-lite') || m.id === 'auto'),
          tier: (m.free || m.id?.includes('flash-lite') || m.id === 'auto') ? 'free' : 'paid',
        });
      }
    }
  }

  const allUsable = Array.from(map.values());
  setText(countEl, `(${allUsable.length})`);

  let filtered = allUsable;
  if (currentFilter === 'free') {
    filtered = allUsable.filter((m) => m.free);
  } else if (currentFilter === 'aipass') {
    filtered = allUsable.filter((m) => m.source === 'aipass');
  } else if (currentFilter === 'vertex') {
    filtered = allUsable.filter((m) => m.source === 'vertex');
  }

  container.innerHTML = '';
  if (!filtered.length) {
    const empty = document.createElement('div');
    empty.style.color = 'var(--faint)';
    empty.style.fontSize = '11px';
    empty.style.padding = '6px';
    empty.textContent = allUsable.length
      ? 'No models match current filter.'
      : 'Open a de.aipass.net or Vertex AI Search tab to load usable models.';
    container.appendChild(empty);
    return;
  }

  const defaultModel = srv?.defaultModel || savedDefault || 'gemini-3.5-flash-lite';
  const defNameEl = $('currentDefaultName');
  if (defNameEl) setText(defNameEl, defaultModel);

  for (const m of filtered) {
    const row = document.createElement('div');
    const isSelected = m.id === defaultModel || (m.source && `${m.source}:${m.id}` === defaultModel);
    row.className = `usable-row ${isSelected ? 'is-default' : ''}`;
    row.title = isSelected ? `Current default model: ${m.id}` : `Click to set ${m.id} as default model`;

    const titleWrap = document.createElement('div');
    titleWrap.className = 'usable-id';
    titleWrap.textContent = m.name || m.id;
    row.appendChild(titleWrap);

    if (isSelected) {
      const defBadge = document.createElement('span');
      defBadge.className = 'badge-tag badge-default';
      defBadge.textContent = '★ Default';
      row.appendChild(defBadge);
    }

    const srcBadge = document.createElement('span');
    srcBadge.className = 'badge-tag badge-src';
    srcBadge.textContent = m.sourceName;

    const costBadge = document.createElement('span');
    costBadge.className = `badge-tag ${m.free ? 'badge-free' : 'badge-paid'}`;
    costBadge.textContent = m.free ? 'Free' : (m.tier === 'enterprise' ? 'Enterprise' : 'Credit');

    row.appendChild(srcBadge);
    row.appendChild(costBadge);

    row.addEventListener('click', async () => {
      try {
        if (defNameEl) setText(defNameEl, m.id);
        await chrome.storage.local.set({ defaultModel: m.id });
        if (srv) srv.defaultModel = m.id;

        const res = await fetch(`${bridge}/config`, {
          method: 'POST',
          headers: await authHeaders(),
          body: JSON.stringify({ defaultModel: m.id }),
        }).catch(() => null);

        if (!res || !res.ok) {
          toast(`Default model: ${m.id} (saved locally)`);
        } else {
          toast(`Default model: ${m.id}`);
        }
        renderUsableModels(lastPages, srv, m.id);
      } catch {
        toast(`Default model: ${m.id}`);
        renderUsableModels(lastPages, srv, m.id);
      }
    });

    container.appendChild(row);
  }
}

async function render() {
  const saved = await chrome.storage.local.get(['bridgeUrl', 'bridgeToken', 'defaultModel']);
  if (saved?.bridgeUrl) {
    bridge = saved.bridgeUrl;
  } else {
    const sw = await swStatus();
    if (sw?.bridgeUrl) bridge = sw.bridgeUrl;
  }
  const sw = await swStatus();
  const srv = sw ? await bridgeStatus() : null;

  const state = derive(sw, srv);

  setClass($('dot'), 'dot', `state-${state.key}`);
  setClass($('pill'), 'pill', `pill-${state.key}`);
  setText($('state'), state.label);
  setText($('pill'), state.pill);

  // lastError is more specific than the generic hint when present.
  setText($('hint'), sw?.lastError && state.key !== 'ok' ? sw.lastError : state.hint);

  const act = $('act');
  const btn = $('actBtn');
  if (state.action) {
    setText(btn, state.action.text);
    currentAction = state.action.run;
    act.classList.add('show');
  } else {
    currentAction = null;
    act.classList.remove('show');
  }

  setText($('sJobs'), srv ? srv.activeJobs ?? 0 : '–');
  setText($('sModels'), srv ? (srv.models?.length ?? 0) : '–');
  setText($('sChat'), srv ? shortId(srv.conversation) : '–');

  if (srv) renderModels(srv.models ?? [], srv.defaultModel);
  renderCredits(srv);

  lastPages = sw?.pages || null;
  lastSrv = srv;
  if (lastPages) renderPages(lastPages);
  renderUsableModels(lastPages, srv, saved?.defaultModel);

  // Don't clobber the field while it is being edited.
  if (document.activeElement !== $('url')) {
    $('url').value = bridge || DEFAULT_BRIDGE;
  }
  if (document.activeElement !== $('token')) {
    const savedToken = saved?.bridgeToken;
    $('token').value = savedToken || '';
    $('token').placeholder = 'token injected at build time (scripts/build-extension.py)';
  }
}

/* ------------------------------------------------------------------- wiring */

$('actBtn').addEventListener('click', () => currentAction?.());

$('btnAipassAction')?.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'open_page', url: 'https://de.aipass.net/chat' });
  toast('Opening de.aipass.net…');
  setTimeout(render, 500);
});

$('btnVertexAction')?.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'open_page', url: 'https://vertexaisearch.cloud.google/' });
  toast('Opening Vertex AI Search…');
  setTimeout(render, 500);
});

$('btnScan')?.addEventListener('click', async () => {
  toast('Scanning tabs…');
  await chrome.runtime.sendMessage({ type: 'scan_pages' }).catch(() => {});
  setTimeout(render, 600);
});

document.querySelectorAll('#filterRow button').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#filterRow button').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    currentFilter = btn.dataset.filter || 'all';
    if (lastPages || lastSrv) renderUsableModels(lastPages, lastSrv);
  });
});

$('save').addEventListener('click', async () => {
  const url = $('url').value.trim().replace(/\/+$/, '') || DEFAULT_BRIDGE;
  if (!/^https?:\/\/.+/i.test(url)) return toast('Enter a full http:// or https:// URL');
  let token = $('token').value.trim();
  await chrome.storage.local.set({ bridgeUrl: url, bridgeToken: token, userConfigured: true });
  await chrome.runtime.sendMessage({ type: 'reconnect' }).catch(() => {});
  bridge = url;
  modelSignature = '';
  toast('Saved');
  setTimeout(render, 400);
});

$('refresh').addEventListener('click', async () => {
  try {
    await fetch(`${bridge}/v1/models?refresh=1`, { cache: 'no-store' });
    await fetch(`${bridge}/quota?refresh=1`, { cache: 'no-store' }).catch(() => {});
    modelSignature = '';
    toast('Refreshed');
  } catch {
    toast('Could not reach the bridge');
  }
  render();
});

// Enter in the URL field saves.
$('url').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('save').click(); });

try { setText($('ver'), `v${chrome.runtime.getManifest().version}`); } catch { /* not in an extension context */ }

render();
pollTimer = setInterval(render, 2000);
window.addEventListener('unload', () => clearInterval(pollTimer));
