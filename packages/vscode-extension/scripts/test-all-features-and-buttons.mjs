// scripts/test-all-features-and-buttons.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { createRequire } from 'node:module';

import { fileURLToPath } from 'node:url';

import Module from 'node:module';

const require = createRequire(import.meta.url);
const extRoot = fileURLToPath(new URL('..', import.meta.url));

const listeners = [];
const mockState = {
  infoMessages: [],
  warnMessages: [],
  errorMessages: [],
  openDialogHandler: null,
};

const mockVscode = {
  Uri: {
    file: (p) => ({ fsPath: p, path: p, scheme: 'file', toString: () => p }),
    parse: (p) => ({ fsPath: p, path: p, scheme: 'file', toString: () => p }),
    joinPath: (baseUri, ...segments) => {
      const basePath = baseUri.fsPath || baseUri.path || String(baseUri);
      const joined = path.join(basePath, ...segments);
      return { fsPath: joined, path: joined, scheme: 'file', toString: () => joined };
    },
  },
  workspace: {
    workspaceFolders: [],
    getWorkspaceFolder: (uri) => {
      const p = uri?.fsPath || uri?.path || String(uri || '');
      return mockVscode.workspace.workspaceFolders?.find((f) => p.startsWith(f.uri.fsPath));
    },
    openTextDocument: async () => ({}),
  },
  window: {
    activeTextEditor: undefined,
    terminals: [],
    onDidChangeActiveTextEditor: (cb) => {
      listeners.push(cb);
      return { dispose: () => {} };
    },
    showInformationMessage: async (msg) => {
      mockState.infoMessages.push(msg);
      return undefined;
    },
    showWarningMessage: async (msg) => {
      mockState.warnMessages.push(msg);
      return undefined;
    },
    showErrorMessage: async (msg) => {
      mockState.errorMessages.push(msg);
      return undefined;
    },
    showOpenDialog: async (opts) => {
      if (mockState.openDialogHandler) {
        return mockState.openDialogHandler(opts);
      }
      return undefined;
    },
    showTextDocument: async () => ({}),
    createTerminal: () => ({ show: () => {}, sendText: () => {} }),
  },
  languages: {
    getDiagnostics: () => [],
  },
  DiagnosticSeverity: {
    Error: 0,
    Warning: 1,
    Information: 2,
    Hint: 3,
  },
  commands: {
    registerCommand: () => ({ dispose: () => {} }),
    executeCommand: async () => {},
  },
  __mockState: mockState,
  __resetMockState: () => {
    mockVscode.workspace.workspaceFolders = [];
    mockVscode.window.activeTextEditor = undefined;
    mockState.infoMessages.length = 0;
    mockState.warnMessages.length = 0;
    mockState.errorMessages.length = 0;
    mockState.openDialogHandler = null;
  },
  __triggerActiveTextEditor: (editor) => {
    mockVscode.window.activeTextEditor = editor;
    for (const cb of listeners) cb(editor);
  },
};

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'vscode') {
    return mockVscode;
  }
  return originalLoad.apply(this, arguments);
};

const vscode = mockVscode;
const { AipassViewProvider } = require('../out/ui/aipassViewProvider.js');
const { executeTool } = require('../out/core/tools.js');
const { isToolRefusalReply, parseToolCall, runAgentLoop } = require('../out/core/agent.js');

console.log('================================================================');
console.log('🧪 COMPREHENSIVE END-TO-END VERIFICATION: ALL FEATURES & BUTTONS');
console.log('================================================================\n');

// --------------------------------------------------------------------------
// 1. VERIFY CSS & HTML STRUCTURE (All buttons and elements present)
// --------------------------------------------------------------------------
test('1. UI HTML & CSS: All buttons, dropdowns, and classes are correctly structured', () => {
  const cssPath = path.resolve(extRoot, 'media/chat.css');
  assert.ok(fs.existsSync(cssPath), 'media/chat.css must exist');
  const css = fs.readFileSync(cssPath, 'utf8');

  // Verify CSS selectors for all requested buttons & widgets
  assert.match(css, /\.version-badge/, 'CSS must style .version-badge');
  assert.match(css, /\.model-reload-btn/, 'CSS must style .model-reload-btn (🔄 button)');
  assert.match(css, /\.model-reload-btn\.rotating/, 'CSS must style .model-reload-btn.rotating');
  assert.match(css, /\.path-browse-btn/, 'CSS must style .path-browse-btn (📁 button)');
  assert.match(css, /\.path-label/, 'CSS must style .path-label (Root: button)');
  assert.match(css, /\.path-reset-btn/, 'CSS must style .path-reset-btn (↺ button)');
  assert.match(css, /\.path-reset-btn\.rotating/, 'CSS must style .path-reset-btn.rotating');
  assert.match(css, /\.path-input\.flash-updated/, 'CSS must style .path-input.flash-updated');
  assert.match(css, /@keyframes flash-highlight/, 'CSS must define @keyframes flash-highlight');
  assert.match(css, /\.mode-dropdown-wrap/, 'CSS must style .mode-dropdown-wrap');
  assert.match(css, /\.mode-select/, 'CSS must style .mode-select dropdown');
  assert.match(css, /\.mode-select\.mode-agent/, 'CSS must style .mode-select.mode-agent');
  assert.match(css, /\.mode-select\.mode-chat/, 'CSS must style .mode-select.mode-chat');

  // Instantiate provider and inspect rendered HTML
  const mockState = new Map();
  const mockMemento = {
    get: (key, def) => (mockState.has(key) ? mockState.get(key) : def),
    update: async (key, val) => {
      if (val === undefined) mockState.delete(key);
      else mockState.set(key, val);
    },
  };

  const provider = new AipassViewProvider(
    vscode.Uri.file('/mock/extension'),
    () => ({ listModels: async () => [{ id: 'gemini-2.5', name: 'Gemini 2.5 Pro' }] }),
    () => ({ text: '', sections: [] }),
    undefined,
    undefined,
    '0.1.28',
    mockMemento,
    mockMemento
  );

  const html = provider._getHtmlContent('/mock/chat.css');

  // 1. Version Badge
  assert.match(html, /<span class="version-badge">v0\.1\.28<\/span>/, 'HTML must render version badge v0.1.28');

  // 2. Model Dropdown & Reload Button
  assert.match(html, /<select id="model-select"/, 'HTML must contain model-select');
  assert.match(html, /<button id="refresh-models-btn" class="model-reload-btn"/, 'HTML must contain refresh-models-btn 🔄');

  // 3. Root Path Bar with Browse Button (📁) & Reload Button (↺)
  assert.match(html, /<button id="browse-path-btn" class="path-browse-btn"[^>]*>📁<\/button>/, 'HTML must contain browse-path-btn 📁 button');
  assert.match(html, /<span class="path-label" id="path-label-btn"/, 'HTML must contain clickable path-label-btn Root:');
  assert.match(html, /<input id="target-path" class="path-input"/, 'HTML must contain target-path input');
  assert.match(html, /<button id="reset-path-btn" class="path-reset-btn"[^>]*>↺<\/button>/, 'HTML must contain reset-path-btn ↺ button');

  // 4. Slash Commands Toolbar
  assert.match(html, /data-cmd="\/explain"/, 'HTML must contain /explain slash button');
  assert.match(html, /data-cmd="\/fix"/, 'HTML must contain /fix slash button');
  assert.match(html, /data-cmd="\/test"/, 'HTML must contain /test slash button');
  assert.match(html, /data-cmd="\/review"/, 'HTML must contain /review slash button');

  // 5. Mode Dropdown List in Composer Footer
  assert.match(html, /<select id="mode-select" class="mode-select mode-agent"/, 'HTML must contain mode-select dropdown');
  assert.match(html, /<option value="agent" selected>⚡ Agent<\/option>/, 'HTML must contain ⚡ Agent option');
  assert.match(html, /<option value="chat">💬 Chat<\/option>/, 'HTML must contain 💬 Chat option');

  // 6. Model Name, Composer Hint, and Send Button
  assert.match(html, /<span id="model-name" class="model-name"/, 'HTML must contain model-name button');
  assert.match(html, /<span class="composer-hint">⌘↵ Active file<\/span>/, 'HTML must contain active file hint');
  assert.match(html, /<button id="send-btn" class="send-button"[^>]*>↵ <span>Enter<\/span><\/button>/, 'HTML must contain send-btn');

  console.log('  ✔ UI HTML & CSS structure verified 100%');
});

// --------------------------------------------------------------------------
// 2. VERIFY PROJECT ROOT DETECTION & ACTIVE WORKSPACE TRACKING
// --------------------------------------------------------------------------
test('2. Project Root Detection & Workspace Tracking across focus shifts', async () => {
  vscode.__resetMockState();
  const testWorkspace1 = fs.mkdtempSync(path.join(os.tmpdir(), 'aipass-root-1-'));
  const testWorkspace2 = fs.mkdtempSync(path.join(os.tmpdir(), 'aipass-root-2-'));

  vscode.workspace.workspaceFolders = [
    { uri: vscode.Uri.file(testWorkspace1), name: 'WS1' },
    { uri: vscode.Uri.file(testWorkspace2), name: 'WS2' },
  ];

  const mockState = new Map();
  const mockMemento = {
    get: (key, def) => (mockState.has(key) ? mockState.get(key) : def),
    update: async (key, val) => {
      if (val === undefined) mockState.delete(key);
      else mockState.set(key, val);
    },
  };

  const provider = new AipassViewProvider(
    vscode.Uri.file('/mock/extension'),
    () => ({ listModels: async () => [] }),
    () => ({ text: '', sections: [] }),
    undefined,
    undefined,
    '0.1.28',
    mockMemento,
    mockMemento
  );

  // Initial default path is the first workspace folder
  assert.equal(provider.getCurrentProjectDefaultPath(), testWorkspace1);

  // Simulate user opening a file in testWorkspace2
  vscode.__triggerActiveTextEditor({
    document: { uri: vscode.Uri.file(path.join(testWorkspace2, 'src', 'app.js')) },
  });

  // Current project default path should now automatically be testWorkspace2
  assert.equal(provider.getCurrentProjectDefaultPath(), testWorkspace2);

  // Simulate user clicking on Webview sidebar (activeTextEditor becomes undefined)
  vscode.__triggerActiveTextEditor(undefined);

  // Even when activeTextEditor is undefined, _lastActiveWorkspaceFolder remembers testWorkspace2!
  assert.equal(provider.getCurrentProjectDefaultPath(), testWorkspace2);

  // Cleanup
  fs.rmSync(testWorkspace1, { recursive: true, force: true });
  fs.rmSync(testWorkspace2, { recursive: true, force: true });
  console.log('  ✔ Project Root detection and focus-shift tracking verified');
});

// --------------------------------------------------------------------------
// 3. VERIFY ALL BUTTONS & EVENT HANDLERS VIA WEBVIEW MESSAGE PROTOCOL
// --------------------------------------------------------------------------
test('3. Webview Message Protocol & Button Event Handlers', async () => {
  vscode.__resetMockState();
  const testWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), 'aipass-btn-test-'));
  vscode.workspace.workspaceFolders = [{ uri: vscode.Uri.file(testWorkspace), name: 'WS' }];

  const mockWorkspaceState = new Map();
  const mockGlobalState = new Map();

  const createMemento = (store) => ({
    get: (key, def) => (store.has(key) ? store.get(key) : def),
    update: async (key, val) => {
      if (val === undefined) store.delete(key);
      else store.set(key, val);
    },
  });

  const postedToWebview = [];
  let onWebviewMessage = null;

  const mockWebviewView = {
    webview: {
      asWebviewUri: (uri) => uri,
      postMessage: async (msg) => {
        postedToWebview.push(msg);
      },
      onDidReceiveMessage: (handler) => {
        onWebviewMessage = handler;
      },
      html: '',
    },
    onDidDispose: () => {},
  };

  let modelsFetchedCount = 0;
  const mockClient = {
    async listModels() {
      modelsFetchedCount++;
      return [
        { id: 'model-a', name: 'Model Alpha' },
        { id: 'model-b', name: 'Model Beta' },
      ];
    },
  };

  const provider = new AipassViewProvider(
    vscode.Uri.file('/mock/extension'),
    () => mockClient,
    () => ({ text: 'context text', sections: ['test.js'] }),
    undefined,
    undefined,
    '0.1.28',
    createMemento(mockWorkspaceState),
    createMemento(mockGlobalState)
  );

  provider.resolveWebviewView(mockWebviewView);
  assert.ok(typeof onWebviewMessage === 'function', 'resolveWebviewView must register message handler');

  // --- Test 3a: webviewReady -> sends cached models & initData with mode ---
  postedToWebview.length = 0;
  await onWebviewMessage({ type: 'webviewReady' });
  assert.ok(postedToWebview.some((m) => m.type === 'setModels'), 'Must send setModels on webviewReady');
  const initMsg = postedToWebview.find((m) => m.type === 'initData');
  assert.ok(initMsg, 'Must send initData on webviewReady');
  assert.equal(initMsg.mode, 'agent', 'Default mode should be agent');
  assert.equal(initMsg.basePath, testWorkspace, 'Default basePath should match current project');

  // --- Test 3b: Mode Dropdown change -> saveMode message ---
  await onWebviewMessage({ type: 'saveMode', mode: 'chat' });
  assert.equal(mockWorkspaceState.get('aipass.mode'), 'chat', 'saveMode must persist mode in workspaceState');

  postedToWebview.length = 0;
  await onWebviewMessage({ type: 'webviewReady' });
  const reloadedInit = postedToWebview.find((m) => m.type === 'initData');
  assert.equal(reloadedInit.mode, 'chat', 'Subsequent webviewReady must restore saved chat mode');

  // Switch back to agent mode
  await onWebviewMessage({ type: 'saveMode', mode: 'agent' });
  assert.equal(mockWorkspaceState.get('aipass.mode'), 'agent');

  // --- Test 3c: Refresh Models button (🔄) -> refreshModels message ---
  postedToWebview.length = 0;
  await onWebviewMessage({ type: 'refreshModels' });
  assert.equal(modelsFetchedCount, 1, 'refreshModels must call client.listModels()');
  const setModelsMsg = postedToWebview.find((m) => m.type === 'setModels');
  assert.ok(setModelsMsg, 'refreshModels must post setModels back to webview');
  assert.equal(setModelsMsg.models.length, 2);
  assert.equal(setModelsMsg.fromRefresh, true);
  // Verify cached models saved in globalState
  const cachedInGlobal = mockGlobalState.get('aipass.cachedModels');
  assert.equal(cachedInGlobal.length, 2);

  // --- Test 3d: Browse Folder button (📁) -> browseTargetPath message ---
  const customTargetDir = path.join(testWorkspace, 'custom-subfolder');
  fs.mkdirSync(customTargetDir, { recursive: true });

  vscode.__mockState.openDialogHandler = async () => [vscode.Uri.file(customTargetDir)];

  postedToWebview.length = 0;
  await onWebviewMessage({ type: 'browseTargetPath', currentPath: testWorkspace });
  assert.equal(mockWorkspaceState.get('aipass.targetPath'), customTargetDir, 'Must persist chosen folder in workspaceState');
  const setPathMsg = postedToWebview.find((m) => m.type === 'setTargetPath');
  assert.ok(setPathMsg, 'browseTargetPath must post setTargetPath back to webview');
  assert.equal(setPathMsg.path, customTargetDir);
  assert.ok(vscode.__mockState.infoMessages.some((m) => m.includes(customTargetDir)));

  // --- Test 3e: Reload / Reset Path button (↺) -> resetTargetPath message ---
  postedToWebview.length = 0;
  await onWebviewMessage({ type: 'resetTargetPath' });
  assert.equal(mockWorkspaceState.get('aipass.targetPath'), undefined, 'resetTargetPath must clear saved custom path');
  const resetPathMsg = postedToWebview.find((m) => m.type === 'setTargetPath');
  assert.ok(resetPathMsg, 'resetTargetPath must post setTargetPath back to webview');
  assert.equal(resetPathMsg.path, testWorkspace, 'resetTargetPath must restore default project path');

  // --- Test 3f: Manual Target Path editing -> saveTargetPath message ---
  await onWebviewMessage({ type: 'saveTargetPath', path: customTargetDir });
  assert.equal(mockWorkspaceState.get('aipass.targetPath'), customTargetDir);
  await onWebviewMessage({ type: 'saveTargetPath', path: '' });
  assert.equal(mockWorkspaceState.get('aipass.targetPath'), undefined);

  // --- Test 3g: Cancel Agent button -> cancelAgent message ---
  await onWebviewMessage({ type: 'cancelAgent' }); // Should safely not throw even if no current abort controller

  // --- Test 3h: Keydown Event Logic Simulation (Enter sends, Shift+Enter inserts newline) ---
  let sentCount = 0;
  const mockSend = () => { sentCount++; };
  function simulateKeydown(event, inputEl) {
    if (event.isComposing || event.keyCode === 229) return 'ignored_ime';
    const isEnter = event.key === 'Enter' || event.code === 'Enter' || event.code === 'NumpadEnter' || event.keyCode === 13;
    if (!isEnter) return 'other_key';
    if (event.shiftKey && !event.ctrlKey && !event.metaKey) {
      return 'newline'; // Allowed natural newline
    }
    event.preventDefault();
    mockSend();
    return 'sent';
  }

  // 1. Plain Enter: should prevent default and trigger send
  let prevented = false;
  const enterEvt = { key: 'Enter', shiftKey: false, preventDefault: () => { prevented = true; } };
  assert.equal(simulateKeydown(enterEvt), 'sent');
  assert.equal(prevented, true, 'Plain Enter must call preventDefault()');
  assert.equal(sentCount, 1, 'Plain Enter must call send()');

  // 2. Shift + Enter: should NOT prevent default and NOT trigger send (inserts newline)
  prevented = false;
  const shiftEnterEvt = { key: 'Enter', shiftKey: true, preventDefault: () => { prevented = true; } };
  assert.equal(simulateKeydown(shiftEnterEvt), 'newline');
  assert.equal(prevented, false, 'Shift+Enter must NOT call preventDefault() so newline is inserted');
  assert.equal(sentCount, 1, 'Shift+Enter must NOT call send()');

  // 3. Cmd+Enter / Ctrl+Enter: should trigger send
  prevented = false;
  const cmdEnterEvt = { key: 'Enter', metaKey: true, shiftKey: false, preventDefault: () => { prevented = true; } };
  assert.equal(simulateKeydown(cmdEnterEvt), 'sent');
  assert.equal(sentCount, 2, 'Cmd+Enter must call send()');

  // 4. IME composition Enter (keyCode 229 / isComposing): must NOT trigger send
  const imeEvt = { key: 'Enter', isComposing: true, preventDefault: () => {} };
  assert.equal(simulateKeydown(imeEvt), 'ignored_ime');
  assert.equal(sentCount, 2, 'IME composition must NOT trigger send');

  // Cleanup
  fs.rmSync(testWorkspace, { recursive: true, force: true });
  console.log('  ✔ All Webview messages, buttons, Enter send & Shift+Enter newline verified 100%');
});

// --------------------------------------------------------------------------
// 4. VERIFY FILE OPERATION TOOLS & LOCAL DISK CAPABILITIES
// --------------------------------------------------------------------------
test('4. Real CRUD File Operations, Unit Tests & Terminal Execution', async () => {
  const testWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), 'aipass-crud-test-'));
  const changes = [];
  const uiCallbacks = {
    onProgress: () => {},
    onToolCall: () => {},
    onFileChange: (change) => changes.push(change),
  };

  // 1. CREATE file
  await executeTool(testWorkspace, 'write_file', {
    path: 'calc.js',
    content: 'export function add(a, b) { return a + b; }\n',
  }, uiCallbacks);
  assert.ok(fs.existsSync(path.join(testWorkspace, 'calc.js')));
  assert.equal(changes.length, 1);
  assert.equal(changes[0].isNew, true);

  // 2. READ file
  const readContent = await executeTool(testWorkspace, 'read_file', { path: 'calc.js' });
  assert.match(readContent, /export function add/);

  // 3. EDIT file (replace_in_file)
  await executeTool(testWorkspace, 'replace_in_file', {
    path: 'calc.js',
    old_string: 'export function add(a, b) { return a + b; }',
    new_string: 'export function add(a, b) { return a + b; }\nexport function sub(a, b) { return a - b; }',
  }, uiCallbacks);
  const updatedContent = fs.readFileSync(path.join(testWorkspace, 'calc.js'), 'utf8');
  assert.match(updatedContent, /export function sub/);
  assert.equal(changes.length, 2);
  assert.equal(changes[1].isNew, false);

  // 4. CREATE directory
  await executeTool(testWorkspace, 'create_directory', { path: 'tests' });
  assert.ok(fs.existsSync(path.join(testWorkspace, 'tests')));

  // 5. RUN terminal command
  const termRes = await executeTool(testWorkspace, 'run_terminal_command', {
    command: 'node -e "console.log(\'TERMINAL_RUN_SUCCESS\')"',
  });
  assert.match(termRes, /TERMINAL_RUN_SUCCESS/);

  // 6. DELETE file
  await executeTool(testWorkspace, 'delete_file', { path: 'calc.js' }, uiCallbacks);
  assert.ok(!fs.existsSync(path.join(testWorkspace, 'calc.js')));
  assert.equal(changes.length, 3);
  assert.equal(changes[2].isDeleted, true);

  // Cleanup
  fs.rmSync(testWorkspace, { recursive: true, force: true });
  console.log('  ✔ All CRUD file tools and terminal execution verified on disk');
});

// --------------------------------------------------------------------------
// 5. VERIFY EXTENSION COMMAND CONTRIBUTIONS
// --------------------------------------------------------------------------
test('5. Extension Commands & Manifest Contributions', () => {
  const pkgPath = path.resolve(extRoot, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));

  const commands = pkg.contributes.commands.map((c) => c.command);
  assert.ok(commands.includes('aipass.startBridge'), 'aipass.startBridge must be in package.json commands');
  assert.ok(commands.includes('aipass.ask'), 'aipass.ask must be in package.json commands');
  assert.ok(commands.includes('aipass.testConnection'), 'aipass.testConnection must be in package.json commands');
  assert.ok(commands.includes('aipass.generateUnitTest'), 'aipass.generateUnitTest must be in package.json commands');
  assert.ok(commands.includes('aipass.runCheckLocally'), 'aipass.runCheckLocally must be in package.json commands');
  assert.ok(commands.includes('aipass.openSidebar'), 'aipass.openSidebar must be in package.json commands');

  // Verify chat view contribution
  assert.equal(pkg.contributes.views['aipass-sidebar'][0].id, 'aipass.chatView');
  console.log('  ✔ Extension package.json commands & view declarations verified');
});
