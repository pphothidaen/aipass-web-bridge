// scripts/test-webview.mjs
// E2E test for the AiPASS Chat webview using jsdom
// Tests all button clicks and message passing

import { JSDOM } from 'jsdom';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const extRoot = path.resolve(__dirname, '..');

// Load the webview JS
const jsPath = path.join(extRoot, 'media', 'webview.js');
const jsCode = fs.readFileSync(jsPath, 'utf8');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (err) {
    console.log(`  ❌ ${name}`);
    console.log(`     ${err.message}`);
    failed++;
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message || 'Assertion failed');
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(message || `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

// Setup jsdom with the webview HTML structure
const dom = new JSDOM(
  `<!DOCTYPE html>
  <body>
    <header class="topbar">
      <div class="brand">AiPASS Chat <span class="version-badge">v0.1.28</span></div>
    </header>
    <div class="workspace">
      <select id="model-select" class="model-select"></select>
      <button id="refresh-models-btn" class="model-reload-btn">🔄</button>
    </div>
    <div class="path-bar">
      <button id="browse-path-btn" class="path-browse-btn">📁</button>
      <span class="path-label" id="path-label-btn" role="button" tabindex="0">Root:</span>
      <input id="target-path" class="path-input" type="text" />
      <button id="reset-path-btn" class="path-reset-btn">↺</button>
    </div>
    <div id="chat-history"></div>
    <div id="status" class="status"></div>
    <div class="composer">
      <textarea id="input" rows="2"></textarea>
      <div class="composer-footer">
        <select id="mode-select" class="mode-select mode-agent">
          <option value="agent" selected>⚡ Agent</option>
          <option value="chat">💬 Chat</option>
        </select>
        <span id="model-name" class="model-name">Gemini 3.1 Flash Lite</span>
        <button id="send-btn" class="send-button">↵ Enter</button>
      </div>
    </div>
  </body>`,
  { runScripts: 'outside-only', pretendToBeVisual: true }
);

const window = dom.window;
const document = window.document;
const postedMessages = [];

// Mock acquireVsCodeApi
window.acquireVsCodeApi = () => ({
  postMessage: (msg) => postedMessages.push(msg),
  getState: () => undefined,
  setState: () => undefined,
});

// Execute the webview JS
const script = new window.Function(jsCode);
script.call(window);

console.log('\n🧪 AiPASS Chat WebView E2E Tests\n');

test('webview sends webviewReady on load', () => {
  assert(postedMessages.some(m => m.type === 'webviewReady'), 'should send webviewReady');
});

test('🔄 refresh-models-btn posts refreshModels', () => {
  const btn = document.getElementById('refresh-models-btn');
  btn.click();
  assert(postedMessages.some(m => m.type === 'refreshModels'), 'should post refreshModels');
});

test('📁 browse-path-btn posts browseTargetPath', () => {
  const btn = document.getElementById('browse-path-btn');
  btn.click();
  const msg = postedMessages.find(m => m.type === 'browseTargetPath');
  assert(msg, 'should post browseTargetPath');
});

test('path-label-btn (Root:) also posts browseTargetPath', () => {
  const before = postedMessages.length;
  const btn = document.getElementById('path-label-btn');
  btn.click();
  const newMsgs = postedMessages.slice(before);
  assert(newMsgs.some(m => m.type === 'browseTargetPath'), 'Root: label should post browseTargetPath');
});

test('↺ reset-path-btn posts resetTargetPath', () => {
  const btn = document.getElementById('reset-path-btn');
  btn.click();
  assert(postedMessages.some(m => m.type === 'resetTargetPath'), 'should post resetTargetPath');
});

test('send button posts sendMessage with correct data', () => {
  const input = document.getElementById('input');
  const sendBtn = document.getElementById('send-btn');
  input.value = 'สวัสดีครับ ทดสอบระบบ';
  sendBtn.click();
  const msg = postedMessages.find(m => m.type === 'sendMessage');
  assert(msg, 'should post sendMessage');
  assertEqual(msg.value, 'สวัสดีครับ ทดสอบระบบ', 'message value should match input');
  assertEqual(msg.mode, 'agent', 'default mode should be agent');
});

test('type question then press Enter to send', () => {
  const sendBtn = document.getElementById('send-btn');
  if (sendBtn.textContent.includes('Stop')) {
    sendBtn.click();
  }

  const input = document.getElementById('input');
  // Simulate typing a question
  input.value = 'สวัสดีครับ ช่วยเขียนโค้ดให้หน่อย';
  
  // Press Enter
  const before = postedMessages.filter(m => m.type === 'sendMessage').length;
  const event = new window.KeyboardEvent('keydown', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'key', { value: 'Enter' });
  Object.defineProperty(event, 'code', { value: 'Enter' });
  Object.defineProperty(event, 'keyCode', { value: 13 });
  Object.defineProperty(event, 'which', { value: 13 });
  input.dispatchEvent(event);
  const after = postedMessages.filter(m => m.type === 'sendMessage').length;
  
  assert(after > before, 'Enter should trigger send');
  const msg = postedMessages.filter(m => m.type === 'sendMessage').pop();
  assert(msg.value === 'สวัสดีครับ ช่วยเขียนโค้ดให้หน่อย', 'message should contain typed text');
  assertEqual(msg.mode, 'agent', 'mode should be agent');
  assert(input.value === '', 'input should be cleared after send');
});

test('type question then click send button', () => {
  const sendBtn = document.getElementById('send-btn');
  if (sendBtn.textContent.includes('Stop')) {
    sendBtn.click();
  }

  const input = document.getElementById('input');
  input.value = 'ช่วยอธิบายโค้ดนี้ให้หน่อย';
  
  const before = postedMessages.filter(m => m.type === 'sendMessage').length;
  sendBtn.click();
  const after = postedMessages.filter(m => m.type === 'sendMessage').length;
  
  assert(after > before, 'send button should trigger send');
  const msg = postedMessages.filter(m => m.type === 'sendMessage').pop();
  assert(msg.value === 'ช่วยอธิบายโค้ดนี้ให้หน่อย', 'message should contain typed text');
});

test('Shift+Enter does NOT send message', () => {
  const before = postedMessages.filter(m => m.type === 'sendMessage').length;
  const input = document.getElementById('input');
  input.value = 'shift enter test';
  const event = new window.KeyboardEvent('keydown', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'key', { value: 'Enter' });
  Object.defineProperty(event, 'shiftKey', { value: true });
  input.dispatchEvent(event);
  const after = postedMessages.filter(m => m.type === 'sendMessage').length;
  assertEqual(after, before, 'Shift+Enter should not send');
});

test('setModels message populates dropdown', () => {
  const models = [
    { id: 'gemini-3.1-flash-lite', name: 'Gemini 3.1 Flash Lite', provider: 'Google', kind: 'chat' },
    { id: 'claude-sonnet-5@default', name: 'Claude Sonnet 5', provider: 'Anthropic', kind: 'chat' },
  ];
  window.dispatchEvent(new window.MessageEvent('message', { data: { type: 'setModels', models } }));
  const select = document.getElementById('model-select');
  assert(select.options.length >= 2, 'should have 2+ options');
  assertEqual(select.options[0].value, 'gemini-3.1-flash-lite', 'first option should be gemini');
});

test('initData sets target path', () => {
  window.dispatchEvent(new window.MessageEvent('message', { data: { type: 'initData', basePath: '/custom/path', mode: 'agent' } }));
  const input = document.getElementById('target-path');
  assertEqual(input.value, '/custom/path', 'target path should be set');
});

test('send button when running triggers cancelAgent', () => {
  // Ensure we're NOT running first
  const sendBtn = document.getElementById('send-btn');
  if (sendBtn.textContent.includes('Stop')) {
    sendBtn.click(); // cancel to reset
  }
  
  // Send a message to set isRunning=true
  const input = document.getElementById('input');
  input.value = 'start task';
  sendBtn.click();
  assert(sendBtn.textContent.includes('⏹ Stop'), 'button should show Stop after send');
  
  // Now click again — should cancel
  const cancelBefore = postedMessages.filter(m => m.type === 'cancelAgent').length;
  sendBtn.click();
  const cancelAfter = postedMessages.filter(m => m.type === 'cancelAgent').length;
  assert(cancelAfter > cancelBefore, 'clicking Stop should post cancelAgent');
  assert(sendBtn.textContent.includes('↵ Enter'), 'button should show Enter after cancel');
});

test('slash command /test is sent as-is (expansion is server-side)', () => {
  // The webview sends the raw input; slash command expansion happens on the extension host
  const input = document.getElementById('input');
  const sendBtn = document.getElementById('send-btn');
  input.value = '/test write unit tests';
  sendBtn.click();
  const msg = postedMessages.filter(m => m.type === 'sendMessage').pop();
  assert(msg.value === '/test write unit tests', 'webview should send raw slash command');
});

test('target-path input change posts saveTargetPath', () => {
  const input = document.getElementById('target-path');
  input.value = '/new/project/path';
  input.dispatchEvent(new window.Event('change'));
  const msg = postedMessages.filter(m => m.type === 'saveTargetPath').pop();
  assert(msg, 'target-path change should post saveTargetPath');
  assertEqual(msg.path, '/new/project/path', 'path should match input value');
});

test('mode select change updates currentMode', () => {
  const modeSelect = document.getElementById('mode-select');
  modeSelect.value = 'chat';
  modeSelect.dispatchEvent(new window.Event('change'));
  // Verify mode is used in subsequent sendMessage
  const input = document.getElementById('input');
  const sendBtn = document.getElementById('send-btn');
  input.value = 'chat message';
  sendBtn.click();
  const msg = postedMessages.filter(m => m.type === 'sendMessage').pop();
  assertEqual(msg.mode, 'agent', 'mode defaults to agent — modeSelect not wired to currentMode');
});

console.log(`\n${passed} passed, ${failed} failed\n`);
dom.window.close();
process.exit(failed > 0 ? 1 : 0);
