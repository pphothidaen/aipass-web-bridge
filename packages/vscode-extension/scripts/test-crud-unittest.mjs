// scripts/test-crud-unittest.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { executeTool } from '../out/core/tools.js';

test('Verification of CRUD (Create unit test, Read, Write, Update, Delete) & Terminal Execution', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aipass-crud-test-'));
  const fileEvents = [];

  const options = {
    onFileChange: (event) => {
      fileEvents.push(event);
      console.log(`  [File Event] ${event.isNew ? 'NEW' : event.isDeleted ? 'DELETE' : 'UPDATE'}: ${event.path}`);
    },
  };

  try {
    console.log('\n--- 1. WRITE: Create source file & unit test file ---');
    // 1. Write source file
    const srcCode = `function add(a, b) {
  return a + b;
}

function multiply(a, b) {
  return a * b;
}

module.exports = { add, multiply };
`;
    const writeSrcRes = await executeTool(tmpDir, 'write_file', {
      path: 'src/math.js',
      content: srcCode,
    }, options);
    assert.match(writeSrcRes, /Successfully wrote \d+ bytes/);
    assert.ok(fs.existsSync(path.join(tmpDir, 'src/math.js')));

    // 2. Write unit test file
    const testCode = `const test = require('node:test');
const assert = require('node:assert/strict');
const { add, multiply } = require('./math.js');

test('add() should correctly sum two numbers', () => {
  assert.equal(add(2, 3), 5);
  assert.equal(add(-1, 1), 0);
});

test('multiply() should correctly multiply two numbers', () => {
  assert.equal(multiply(3, 4), 12);
  assert.equal(multiply(0, 5), 0);
});
`;
    const writeTestRes = await executeTool(tmpDir, 'write_file', {
      path: 'src/math.test.js',
      content: testCode,
    }, options);
    assert.match(writeTestRes, /Successfully wrote \d+ bytes/);
    assert.ok(fs.existsSync(path.join(tmpDir, 'src/math.test.js')));

    console.log('\n--- 2. READ: Read files back with read_file ---');
    const readSrcRes = await executeTool(tmpDir, 'read_file', { path: 'src/math.js' });
    assert.match(readSrcRes, /function add\(a, b\)/);
    assert.match(readSrcRes, /module\/\* \*\/.\s*exports/); // Verified WAF sanitization active

    const readTestRes = await executeTool(tmpDir, 'read_file', { path: 'src/math.test.js' });
    assert.match(readTestRes, /require\/\* \*\/\('\.\/math\.js'\)/);

    console.log('\n--- 3. TERMINAL: Run unit test via run_terminal_command ---');
    const termTest1 = await executeTool(tmpDir, 'run_terminal_command', {
      command: 'node --test src/math.test.js',
    });
    console.log(termTest1);
    assert.match(termTest1, /Exit Code: 0/);
    assert.match(termTest1, /pass 2/);

    console.log('\n--- 4. UPDATE: Modify function and update unit test with replace_in_file ---');
    // Add a new function power(base, exp)
    const updateSrcRes = await executeTool(tmpDir, 'replace_in_file', {
      path: 'src/math.js',
      target_content: 'module.exports = { add, multiply };',
      replacement_content: `function power(base, exp) {
  return Math.pow(base, exp);
}

module.exports = { add, multiply, power };`,
    }, options);
    assert.match(updateSrcRes, /Successfully replaced/);

    // Update unit test file to add test for power()
    const updateTestRes = await executeTool(tmpDir, 'replace_in_file', {
      path: 'src/math.test.js',
      target_content: 'const { add, multiply } = require(\'./math.js\');',
      replacement_content: 'const { add, multiply, power } = require(\'./math.js\');',
    }, options);
    assert.match(updateTestRes, /Successfully replaced/);

    const appendTestRes = await executeTool(tmpDir, 'replace_in_file', {
      path: 'src/math.test.js',
      target_content: `test('multiply() should correctly multiply two numbers', () => {
  assert.equal(multiply(3, 4), 12);
  assert.equal(multiply(0, 5), 0);
});`,
      replacement_content: `test('multiply() should correctly multiply two numbers', () => {
  assert.equal(multiply(3, 4), 12);
  assert.equal(multiply(0, 5), 0);
});

test('power() should calculate exponentiation', () => {
  assert.equal(power(2, 3), 8);
  assert.equal(power(5, 2), 25);
});`,
    }, options);
    assert.match(appendTestRes, /Successfully replaced/);

    console.log('\n--- 5. TERMINAL: Re-run unit test with updated cases ---');
    const termTest2 = await executeTool(tmpDir, 'run_terminal_command', {
      command: 'node --test src/math.test.js',
    });
    console.log(termTest2);
    assert.match(termTest2, /Exit Code: 0/);
    assert.match(termTest2, /pass 3/);

    console.log('\n--- 6. DELETE: Delete unit test and source files ---');
    const delTestRes = await executeTool(tmpDir, 'delete_file', { path: 'src/math.test.js' }, options);
    assert.match(delTestRes, /Successfully deleted file/);
    assert.ok(!fs.existsSync(path.join(tmpDir, 'src/math.test.js')));

    const delSrcRes = await executeTool(tmpDir, 'delete_file', { path: 'src/math.js' }, options);
    assert.match(delSrcRes, /Successfully deleted file/);
    assert.ok(!fs.existsSync(path.join(tmpDir, 'src/math.js')));

    const delDirRes = await executeTool(tmpDir, 'delete_directory', { path: 'src' });
    assert.match(delDirRes, /Successfully deleted directory/);
    assert.ok(!fs.existsSync(path.join(tmpDir, 'src')));

    console.log('\n--- 7. Verify all File Event Hooks were dispatched ---');
    assert.equal(fileEvents.length, 7);
    assert.equal(fileEvents[0].isNew, true); // write_file math.js
    assert.equal(fileEvents[1].isNew, true); // write_file math.test.js
    assert.equal(fileEvents[2].isNew, false); // replace_in_file math.js
    assert.equal(fileEvents[3].isNew, false); // replace_in_file math.test.js
    assert.equal(fileEvents[4].isNew, false); // replace_in_file math.test.js
    assert.equal(fileEvents[5].isDeleted, true); // delete_file math.test.js
    assert.equal(fileEvents[6].isDeleted, true); // delete_file math.js
    console.log('✅ All 7 CRUD & terminal test phases passed seamlessly!\n');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
