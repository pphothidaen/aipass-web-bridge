import assert from 'node:assert/strict';
import test from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { extractCodeBlocksWithPaths, parseToolCall, isToolRefusalReply, buildAgentSystemPrompt } from '../out/core/agent.js';
import { executeTool, sanitizeWafPayload, normalizeWafPayload } from '../out/core/tools.js';

test('extractCodeBlocksWithPaths: detects path from first line comment', () => {
  const markdown = `
การเขียน Unit Test สำหรับไฟล์ \`run-check.js\`:

\`\`\`javascript
// packages/checks-runner/run-check.test.js
const test = require('node:test');
const assert = require('node:assert/strict');

test('run check passes', () => {
  assert.equal(1, 1);
});
\`\`\`
`;

  const blocks = extractCodeBlocksWithPaths(markdown);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].path, 'packages/checks-runner/run-check.test.js');
  assert.equal(blocks[0].language, 'javascript');
  assert.match(blocks[0].code, /assert\.equal\(1, 1\)/);
});

test('extractCodeBlocksWithPaths: detects path from preceding heading', () => {
  const markdown = `
### 1. packages/checks-runner/run-check.test.js
นี่คือโค้ด unit test:

\`\`\`js
const test = require('node:test');
\`\`\`
`;

  const blocks = extractCodeBlocksWithPaths(markdown);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].path, 'packages/checks-runner/run-check.test.js');
});

test('extractCodeBlocksWithPaths: detects path from lang tag', () => {
  const markdown = `
\`\`\`javascript:packages/checks-runner/run-check.test.js
const test = require('node:test');
\`\`\`
`;

  const blocks = extractCodeBlocksWithPaths(markdown);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].path, 'packages/checks-runner/run-check.test.js');
});

test('extractCodeBlocksWithPaths: ignores conceptual code snippets without file paths', () => {
  const markdown = `
นี่คือตัวอย่างการใช้ Array.map ใน JS:

\`\`\`javascript
const arr = [1, 2, 3];
const doubled = arr.map(x => x * 2);
\`\`\`
`;

  const blocks = extractCodeBlocksWithPaths(markdown);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].path, undefined);
});

test('parseToolCall: parses XML tool_call tag correctly', () => {
  const text = `
<tool_call>
{"name": "write_file", "parameters": {"path": "test.js", "content": "hello"}}
</tool_call>
`;
  const call = parseToolCall(text);
  assert.ok(call);
  assert.equal(call.name, 'write_file');
  assert.equal(call.parameters.path, 'test.js');
  assert.equal(call.parameters.content, 'hello');
});

test('executeTool: CRUD file & directory operations and terminal command execution', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aipass-test-'));

  try {
    // 1. Create directory
    const dirResult = await executeTool(tmpDir, 'create_directory', { path: 'src/sub' });
    assert.match(dirResult, /Successfully created directory/);
    assert.ok(fs.existsSync(path.join(tmpDir, 'src/sub')));

    // 2. Write file
    const fileChanges = [];
    const writeResult = await executeTool(tmpDir, 'write_file', {
      path: 'src/sub/sample.js',
      content: 'function test() { return 42; }\nmodule.exports = { test };',
    }, {
      onFileChange: (c) => fileChanges.push(c),
    });
    assert.match(writeResult, /Successfully wrote/);
    assert.equal(fileChanges.length, 1);
    assert.equal(fileChanges[0].isNew, true);

    // 3. Update file (replace_in_file)
    const replaceResult = await executeTool(tmpDir, 'replace_in_file', {
      path: 'src/sub/sample.js',
      target_content: 'return 42;',
      replacement_content: 'return 100;',
    }, {
      onFileChange: (c) => fileChanges.push(c),
    });
    assert.match(replaceResult, /Successfully replaced/);
    const updatedContent = fs.readFileSync(path.join(tmpDir, 'src/sub/sample.js'), 'utf8');
    assert.match(updatedContent, /return 100;/);

    // 4. Run terminal command
    const termResult = await executeTool(tmpDir, 'run_terminal_command', {
      command: 'node -e "const { test } = require(\'./src/sub/sample.js\'); console.log(\'Result:\' + test());"',
    });
    assert.match(termResult, /Result:100/);
    assert.match(termResult, /Exit Code: 0/);

    // 5. Delete file
    const deleteFileResult = await executeTool(tmpDir, 'delete_file', {
      path: 'src/sub/sample.js',
    }, {
      onFileChange: (c) => fileChanges.push(c),
    });
    assert.match(deleteFileResult, /Successfully deleted file/);
    assert.ok(!fs.existsSync(path.join(tmpDir, 'src/sub/sample.js')));
    assert.equal(fileChanges[fileChanges.length - 1].isDeleted, true);

    // 6. Delete directory
    const deleteDirResult = await executeTool(tmpDir, 'delete_directory', {
      path: 'src',
    });
    assert.match(deleteDirResult, /Successfully deleted directory/);
    assert.ok(!fs.existsSync(path.join(tmpDir, 'src')));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('sanitizeWafPayload and normalizeWafPayload: neutralizes and restores WAF signatures', () => {
  const sample = `
const { execSync } = require('child_process');
const fs = require('fs');

if (require.main === module) {
  eval('console.log("hello")');
  process.exit(0);
}

module.exports = { run };
`;

  const sanitized = sanitizeWafPayload(sample);

  // WAF rules must be neutralized with standard JS block comments:
  assert.ok(!sanitized.includes('if ('));
  assert.ok(sanitized.includes('if/* */ ('));
  assert.ok(!sanitized.includes('require('));
  assert.ok(sanitized.includes('require/* */('));
  assert.ok(!sanitized.includes('require.main'));
  assert.ok(sanitized.includes('require/* */.main'));
  assert.ok(!sanitized.includes('module.exports'));
  assert.ok(sanitized.includes('module/* */.exports'));
  assert.ok(!sanitized.includes("require('child_process')"));
  assert.ok(!sanitized.includes('eval('));
  assert.ok(sanitized.includes('eval/* */('));
  assert.ok(!sanitized.includes('console.log('));
  assert.ok(sanitized.includes('console.log/* */('));
  assert.ok(!sanitized.includes('process.exit('));
  assert.ok(sanitized.includes('process.exit/* */('));

  // Reversible back to verbatim original:
  const normalized = normalizeWafPayload(sanitized);
  assert.equal(normalized, sample);
});

test('isToolRefusalReply: detects Thai tool refusal messages accurately', () => {
  const userQuotedError = `- ผมไม่มีเครื่องมือ \`read_file\`, \`list_dir\`, \`grep_search\`, \`get_file_tree\` จริงๆ
- ผมไม่สามารถเข้าถึงระบบไฟล์หรือโปรเจกต์ในเครื่องคอมพิวเตอร์ของคุณได้
- เครื่องมือจริงที่ผมมีคือการค้นหาเว็บเท่านั้น`;

  const readOnlyRefusal = `ตอนนี้เครื่องมือที่มีให้ผมในบทสนทนานี้เป็นเครื่องมือสำหรับ**อ่าน/ค้นหา**โค้ดในโปรเจกต์เท่านั้น (read_file, list_dir, get_file_tree, grep_search) ไม่มีเครื่องมือสำหรับ**เขียนไฟล์**ใหม่ครับ เลยไม่สามารถสร้างไฟล์ให้อัตโนมัติได้ในตอนนี้`;

  assert.equal(isToolRefusalReply(userQuotedError), true);
  assert.equal(isToolRefusalReply(readOnlyRefusal), true);
  assert.equal(isToolRefusalReply('ขออภัยครับ ผมไม่มีสิทธิ์เข้าถึงไฟล์ในเครื่องของคุณ'), true);
  assert.equal(isToolRefusalReply('ระบบของผมมีเพียงการค้นหาเว็บเท่านั้นครับ'), true);
});

test('isToolRefusalReply: detects English tool refusal messages accurately', () => {
  assert.equal(isToolRefusalReply("I don't have access to your local files or computer."), true);
  assert.equal(isToolRefusalReply("The only tool I have is web search."), true);
  assert.equal(isToolRefusalReply("I cannot view your files because I lack tools to inspect them."), true);
});

test('isToolRefusalReply: returns false for normal answers or tool calls', () => {
  assert.equal(isToolRefusalReply('นี่คือโค้ดสำหรับสร้างเซิร์ฟเวอร์ Express:'), false);
  assert.equal(isToolRefusalReply('<tool_call>{"name": "read_file", "parameters": {"path": "test.js"}}</tool_call>'), false);
  assert.equal(isToolRefusalReply('NEED file package.json'), false);
});

test('parseToolCall: parses action lines (NEED file, NEED dir, SEARCH, TREE, EDIT, CREATE, RUN)', () => {
  // NEED file with line range
  const callFile = parseToolCall('I need to inspect the code:\nNEED file src/app.ts 10-50\nPlease check.');
  assert.ok(callFile);
  assert.equal(callFile.name, 'read_file');
  assert.equal(callFile.parameters.path, 'src/app.ts');
  assert.equal(callFile.parameters.start_line, 10);
  assert.equal(callFile.parameters.end_line, 50);

  // NEED dir
  const callDir = parseToolCall('NEED dir packages/core');
  assert.ok(callDir);
  assert.equal(callDir.name, 'list_dir');
  assert.equal(callDir.parameters.path, 'packages/core');

  // SEARCH
  const callSearch = parseToolCall('SEARCH executeTool');
  assert.ok(callSearch);
  assert.equal(callSearch.name, 'grep_search');
  assert.equal(callSearch.parameters.query, 'executeTool');

  // TREE
  const callTree = parseToolCall('TREE packages');
  assert.ok(callTree);
  assert.equal(callTree.name, 'get_file_tree');
  assert.equal(callTree.parameters.path, 'packages');

  // EDIT
  const editBlock = `EDIT src/index.ts
FIND
const a = 1;
NEW
const a = 2;
END`;
  const callEdit = parseToolCall(editBlock);
  assert.ok(callEdit);
  assert.equal(callEdit.name, 'replace_in_file');
  assert.equal(callEdit.parameters.path, 'src/index.ts');
  assert.equal(callEdit.parameters.target_content.trim(), 'const a = 1;');
  assert.equal(callEdit.parameters.replacement_content.trim(), 'const a = 2;');

  // CREATE
  const createBlock = `CREATE notes.txt
Hello World
Second line
END`;
  const callCreate = parseToolCall(createBlock);
  assert.ok(callCreate);
  assert.equal(callCreate.name, 'write_file');
  assert.equal(callCreate.parameters.path, 'notes.txt');
  assert.match(callCreate.parameters.content, /Hello World/);

  // RUN
  const runBlock = `RUN
npm test
END`;
  const callRun = parseToolCall(runBlock);
  assert.ok(callRun);
  assert.equal(callRun.name, 'run_terminal_command');
  assert.equal(callRun.parameters.command, 'npm test');

  // Single-line RUN
  const callSingleRun = parseToolCall('RUN node --test packages/checks-runner/run-check.test.js');
  assert.ok(callSingleRun);
  assert.equal(callSingleRun.name, 'run_terminal_command');
  assert.equal(callSingleRun.parameters.command, 'node --test packages/checks-runner/run-check.test.js');

  // DELETE file
  const callDelFile = parseToolCall('DELETE file src/temp.js');
  assert.ok(callDelFile);
  assert.equal(callDelFile.name, 'delete_file');
  assert.equal(callDelFile.parameters.path, 'src/temp.js');

  // DELETE dir
  const callDelDir = parseToolCall('DELETE dir src/temp');
  assert.ok(callDelDir);
  assert.equal(callDelDir.name, 'delete_directory');
  assert.equal(callDelDir.parameters.path, 'src/temp');

  // MKDIR
  const callMkdir = parseToolCall('MKDIR src/components');
  assert.ok(callMkdir);
  assert.equal(callMkdir.name, 'create_directory');
  assert.equal(callMkdir.parameters.path, 'src/components');
});

test('parseToolCall: parses bare JSON without fences and function tags', () => {
  const bare = parseToolCall('Here is the tool call:\n{"name": "read_file", "parameters": {"path": "package.json"}}');
  assert.ok(bare);
  assert.equal(bare.name, 'read_file');
  assert.equal(bare.parameters.path, 'package.json');

  const funcTag = parseToolCall('<function=read_file>{"path": "package.json"}</function>');
  assert.ok(funcTag);
  assert.equal(funcTag.name, 'read_file');
  assert.equal(funcTag.parameters.path, 'package.json');
});

test('buildAgentSystemPrompt: includes division of responsibility, anti-refusal rules, and initial project listing', () => {
  const promptWithListing = buildAgentSystemPrompt('/test/dir', '[DIR] packages/\n[FILE] package.json');
  assert.match(promptWithListing, /The user has this project open in VS Code on their local computer/);
  assert.match(promptWithListing, /VS Code extension acts as your hands/);
  assert.match(promptWithListing, /Never claim that you lack tools/);
  assert.match(promptWithListing, /never say you cannot access local files/);
  assert.match(promptWithListing, /never state that your only tool is web search/);
  assert.match(promptWithListing, /Top-level project files and folders right now:/);
  assert.match(promptWithListing, /\[FILE\] package\.json/);
  assert.match(promptWithListing, /NEED dir/);
  assert.match(promptWithListing, /NEED file/);
});

test('parseToolCall: parses WRITE and APPEND markers', () => {
  const writeText = `WRITE app.py
print("hello world")
END`;
  const callWrite = parseToolCall(writeText);
  assert.ok(callWrite);
  assert.equal(callWrite.name, 'write_file');
  assert.equal(callWrite.parameters.path, 'app.py');
  assert.match(callWrite.parameters.content, /print\("hello world"\)/);

  const appendText = `APPEND app.py
print("second line")
END`;
  const callAppend = parseToolCall(appendText);
  assert.ok(callAppend);
  assert.equal(callAppend.name, 'append_to_file');
  assert.equal(callAppend.parameters.path, 'app.py');
  assert.match(callAppend.parameters.content, /print\("second line"\)/);
});

test('executeTool: supports write/append/edit aliases and parameter normalization', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aipass-alias-test-'));
  try {
    // 1. create_file alias with TargetFile & CodeContent
    const createRes = await executeTool(tmpDir, 'create_file', {
      TargetFile: 'sub/test.txt',
      CodeContent: 'Initial Line\n',
    });
    assert.match(createRes, /Successfully wrote/);
    assert.equal(fs.readFileSync(path.join(tmpDir, 'sub/test.txt'), 'utf8'), 'Initial Line\n');

    // 2. append_to_file with filePath & text
    const appendRes = await executeTool(tmpDir, 'append_to_file', {
      filePath: 'sub/test.txt',
      text: 'Appended Line\n',
    });
    assert.match(appendRes, /Successfully appended/);
    assert.equal(fs.readFileSync(path.join(tmpDir, 'sub/test.txt'), 'utf8'), 'Initial Line\nAppended Line\n');

    // 3. edit_file alias with targetContent and replacementContent
    const editRes = await executeTool(tmpDir, 'edit_file', {
      file: 'sub/test.txt',
      targetContent: 'Initial Line\n',
      replacementContent: 'Modified Line\n',
    });
    assert.match(editRes, /Successfully replaced/);
    assert.equal(fs.readFileSync(path.join(tmpDir, 'sub/test.txt'), 'utf8'), 'Modified Line\nAppended Line\n');

    // 4. read_file with TargetFile
    const readRes = await executeTool(tmpDir, 'view_file', {
      TargetFile: 'sub/test.txt',
    });
    assert.match(readRes, /Modified Line/);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('DEFAULT_FALLBACK_MODELS: provides valid models with chat capabilities', async () => {
  const { DEFAULT_FALLBACK_MODELS } = await import('../out/core/tools.js');
  assert.ok(Array.isArray(DEFAULT_FALLBACK_MODELS));
  assert.ok(DEFAULT_FALLBACK_MODELS.length >= 3);
  const gemini = DEFAULT_FALLBACK_MODELS.find(m => m.id.includes('gemini'));
  assert.ok(gemini);
  assert.equal(gemini.kind, 'chat');
});



