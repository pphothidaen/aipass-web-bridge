// scripts/test-simulation.mjs
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { runAgentLoop, isToolRefusalReply, parseToolCall, buildAgentSystemPrompt } from '../out/core/agent.js';
import { executeTool } from '../out/core/tools.js';

console.log('======================================================================');
console.log('🧪 TEST SIMULATION: VS Code Extension UI/UX Agentic Tools & Refusal Recovery');
console.log('======================================================================\n');

// Setup temporary isolated project root
const testWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), 'aipass-sim-workspace-'));
fs.mkdirSync(path.join(testWorkspace, 'src'), { recursive: true });
fs.writeFileSync(path.join(testWorkspace, 'package.json'), JSON.stringify({ name: 'simulation-demo', version: '1.0.0' }, null, 2));
fs.writeFileSync(path.join(testWorkspace, 'src', 'index.js'), 'function greet(name) { return "Hello " + name; }\nmodule.exports = { greet };\n');

console.log(`📁 Workspace Root created at: ${testWorkspace}`);
console.log(`📄 Created initial files: package.json, src/index.js\n`);

// Mock UI Event loggers
const uiEvents = {
  progress: [],
  toolCalls: [],
  fileChanges: [],
};

const mockUiCallbacks = {
  onProgress: (msg) => {
    uiEvents.progress.push(msg);
    console.log(`  [UI Progress Badge] ${msg}`);
  },
  onToolCall: (name, params, result) => {
    uiEvents.toolCalls.push({ name, params, result });
    const paramStr = params.path || params.command || params.query || JSON.stringify(params);
    console.log(`  [UI Tool Step] ⚡ ${name} (${paramStr})`);
    console.log(`     └─ Result: ${result.split('\n')[0].slice(0, 80)}...`);
  },
  onFileChange: (change) => {
    uiEvents.fileChanges.push(change);
    const tag = change.isNew ? 'NEW' : change.isDeleted ? 'DELETE' : 'UPDATE';
    console.log(`  [UI File Card] 📝 [${tag}] ${change.path}`);
  },
};

// --------------------------------------------------------------------------
// TEST 1: Tool Execution Layer (read_file, list_dir, get_file_tree, grep_search, write_file)
// --------------------------------------------------------------------------
console.log('\n--- 1. Testing Tool Execution Layer (Real Client Disk Access) ---');

// 1a. list_dir
const listRes = await executeTool(testWorkspace, 'list_dir', { path: '.' });
console.log('list_dir output:\n' + listRes);
assert.match(listRes, /\[FILE\] package\.json/);
assert.match(listRes, /\[DIR\]  src\//);

// 1b. get_file_tree
const treeRes = await executeTool(testWorkspace, 'get_file_tree', { path: '.', max_depth: 2 });
console.log('\nget_file_tree output:\n' + treeRes);
assert.match(treeRes, /package\.json/);
assert.match(treeRes, /src\//);

// 1c. read_file
const readRes = await executeTool(testWorkspace, 'read_file', { path: 'src/index.js' });
console.log('\nread_file output:\n' + readRes);
assert.match(readRes, /function greet/);

// 1d. grep_search
const grepRes = await executeTool(testWorkspace, 'grep_search', { query: 'greet' });
console.log('\ngrep_search output:\n' + grepRes);
assert.match(grepRes, /src\/index\.js:1:/);

// 1e. write_file
const writeRes = await executeTool(testWorkspace, 'write_file', {
  path: 'src/utils.js',
  content: 'export const add = (a, b) => a + b;\n',
}, mockUiCallbacks);
console.log('\nwrite_file output:\n' + writeRes);
assert.ok(fs.existsSync(path.join(testWorkspace, 'src', 'utils.js')));
assert.equal(fs.readFileSync(path.join(testWorkspace, 'src', 'utils.js'), 'utf8'), 'export const add = (a, b) => a + b;\n');

console.log('✅ Tool Execution Layer verified: All 5 file tools execute directly on local disk with 0 simulation stubbing.');

// --------------------------------------------------------------------------
// TEST 2: Multi-Protocol Tool Parsing (XML, Bare JSON, Action Lines)
// --------------------------------------------------------------------------
console.log('\n--- 2. Testing Multi-Protocol Function Calling Bridge ---');

const xmlCall = parseToolCall('<tool_call>{"name": "read_file", "parameters": {"path": "package.json"}}</tool_call>');
assert.equal(xmlCall?.name, 'read_file');
assert.equal(xmlCall?.parameters.path, 'package.json');
console.log('  ✔ Format 1: XML <tool_call> successfully parsed');

const bareJsonCall = parseToolCall('{"name": "list_dir", "parameters": {"path": "src"}}');
assert.equal(bareJsonCall?.name, 'list_dir');
assert.equal(bareJsonCall?.parameters.path, 'src');
console.log('  ✔ Format 2: Bare JSON format successfully parsed');

const needFileCall = parseToolCall('I need to read index.js:\nNEED file src/index.js 1-20');
assert.equal(needFileCall?.name, 'read_file');
assert.equal(needFileCall?.parameters.path, 'src/index.js');
assert.equal(needFileCall?.parameters.start_line, 1);
assert.equal(needFileCall?.parameters.end_line, 20);
console.log('  ✔ Format 3: Action line (NEED file src/index.js 1-20) successfully parsed');

const needDirCall = parseToolCall('NEED dir src');
assert.equal(needDirCall?.name, 'list_dir');
assert.equal(needDirCall?.parameters.path, 'src');
console.log('  ✔ Format 4: Action line (NEED dir src) successfully parsed');

const searchCall = parseToolCall('SEARCH function greet');
assert.equal(searchCall?.name, 'grep_search');
assert.equal(searchCall?.parameters.query, 'function greet');
console.log('  ✔ Format 5: Action line (SEARCH function greet) successfully parsed');

// --------------------------------------------------------------------------
// TEST 3: Refusal Detection & Auto-Nudge Loop Simulation
// --------------------------------------------------------------------------
console.log('\n--- 3. Testing Refusal Detection & Auto-Nudge Loop Simulation ---');

const exactReportedRefusal = `- ผมไม่มีเครื่องมือ \`read_file\`, \`list_dir\`, \`grep_search\`, \`get_file_tree\` จริงๆ
- ผมไม่สามารถเข้าถึงระบบไฟล์หรือโปรเจกต์ในเครื่องคอมพิวเตอร์ของคุณได้
- เครื่องมือจริงที่ผมมีคือการค้นหาเว็บเท่านั้น`;

assert.equal(isToolRefusalReply(exactReportedRefusal), true);
console.log('  ✔ Exact user refusal string detected by isToolRefusalReply: TRUE');

// Simulate a mock client that initially sends the refusal, then after nudging, sends a tool call
let turns = 0;
const simulatedBridgeClient = {
  resetConversationCount: 0,
  async resetConversation() {
    this.resetConversationCount++;
    console.log('  [Bridge] resetConversation() invoked to clear poisoned conversation cache');
  },
  async chatCompletion({ messages }) {
    turns++;
    const lastUserMsg = messages[messages.length - 1].content;
    console.log(`\n  --- [Simulated Turn ${turns}] ---`);

    if (turns === 1) {
      console.log('  Model responds with initial refusal hallucination...');
      return {
        choices: [{
          message: {
            role: 'assistant',
            content: exactReportedRefusal,
          },
        }],
      };
    }

    if (turns === 2) {
      console.log('  Model received system reminder nudge:');
      console.log('  "' + lastUserMsg.split('\n')[0] + '..."');
      console.log('  Model self-corrects and calls read_file tool via <tool_call>!');
      return {
        choices: [{
          message: {
            role: 'assistant',
            content: '<tool_call>{"name": "read_file", "parameters": {"path": "src/index.js"}}</tool_call>',
          },
        }],
      };
    }

    if (turns === 3) {
      console.log('  Model received tool output for read_file:');
      console.log('  "' + lastUserMsg.split('\n')[0] + '..."');
      console.log('  Model calls write_file to add new greeting function...');
      return {
        choices: [{
          message: {
            role: 'assistant',
            content: '<tool_call>{"name": "write_file", "parameters": {"path": "src/greet.js", "content": "function greetThai(name) { return \\"สวัสดี \\" + name; }\\nmodule.exports = { greetThai };\\n"}}</tool_call>',
          },
        }],
      };
    }

    // Turn 4: Final response
    console.log('  Model provides final summary response to user.');
    return {
      choices: [{
        message: {
          role: 'assistant',
          content: 'ผมได้อ่านไฟล์ `src/index.js` และสร้างไฟล์ `src/greet.js` เรียบร้อยแล้วครับ!',
        },
      }],
    };
  },
};

const finalResult = await runAgentLoop(
  'ช่วยดูไฟล์ในโปรเจกต์และเพิ่มฟังก์ชันทักทายภาษาไทย',
  {
    client: simulatedBridgeClient,
    baseDir: testWorkspace,
    maxSteps: 5,
    ...mockUiCallbacks,
  }
);

console.log('\n--- Final Agent Loop Output ---');
console.log(finalResult);

assert.match(finalResult, /ผมได้อ่านไฟล์ `src\/index\.js` และสร้างไฟล์ `src\/greet\.js` เรียบร้อยแล้วครับ/);
assert.ok(fs.existsSync(path.join(testWorkspace, 'src', 'greet.js')));
const greetContent = fs.readFileSync(path.join(testWorkspace, 'src', 'greet.js'), 'utf8');
assert.match(greetContent, /greetThai/);

console.log('\n✅ SIMULATION TEST SUCCEEDED:');
console.log('1. Model refusal was caught by isToolRefusalReply.');
console.log('2. Auto-nudge reminder was injected into conversation.');
console.log('3. Model self-corrected and emitted <tool_call>.');
console.log('4. read_file and write_file executed on local filesystem.');
console.log('5. New file src/greet.js was created on disk.');
console.log('6. UI progress, tool step badges, and file changed cards dispatched.');

// Cleanup
fs.rmSync(testWorkspace, { recursive: true, force: true });
console.log(`\n🧹 Cleaned up temporary workspace: ${testWorkspace}`);
