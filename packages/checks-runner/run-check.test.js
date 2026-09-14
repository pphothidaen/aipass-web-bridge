const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { run } = require('./run-check');

describe('run-check unit tests', () => {
  test('ควรประมวลผล prompt และส่ง parameters ไปยัง npm run chat ได้ถูกต้อง', () => {
    const executedCommands = [];

    const mockReadFile = (filePath, encoding) => {
      assert.equal(encoding, 'utf-8');
      return 'Header\n---\n---\nMy Prompt for check';
    };

    const mockExecSync = (cmd, opts) => {
      executedCommands.push({ cmd, opts });
      if (cmd.startsWith('git diff')) {
        return 'diff --git a/test b/test\n+added code';
      }
      if (cmd.startsWith('npm run chat')) {
        return 'PASS: All checks passed';
      }
      return '';
    };

    const result = run('dummy-check.md', {
      readFile: mockReadFile,
      execSync: mockExecSync,
    });

    assert.equal(result, 'PASS: All checks passed');
    assert.equal(executedCommands.length, 2);

    // ตรวจสอบคำสั่งแรก: git diff
    assert.equal(executedCommands[0].cmd, 'git diff origin/main...HEAD');

    // ตรวจสอบคำสั่งที่สอง: npm run chat พร้อม prompt และ diff
    assert.match(executedCommands[1].cmd, /^npm run chat -- --message/);
    assert.ok(executedCommands[1].cmd.includes('My Prompt for check'));
    assert.ok(executedCommands[1].cmd.includes('--- DIFF ---'));
    assert.ok(executedCommands[1].cmd.includes('+added code'));
  });

  test('ควรตัดทอน prompt และ diff หากยาวเกิน 4000 ตัวอักษร', () => {
    const executedCommands = [];

    const mockReadFile = () => 'Header\n---\n---\nShort prompt';
    const mockExecSync = (cmd, opts) => {
      executedCommands.push({ cmd, opts });
      if (cmd.startsWith('git diff')) {
        return 'X'.repeat(6000); // Diff ยาวเกิน
      }
      return 'SUCCESS';
    };

    const result = run('large-file.md', {
      readFile: mockReadFile,
      execSync: mockExecSync,
    });

    assert.equal(result, 'SUCCESS');
    assert.equal(executedCommands.length, 2);

    // ตรวจสอบว่า parameter message มีความยาวไม่เกินลิมิต 4000 ตัวอักษร
    const chatCmd = executedCommands[1].cmd;
    const match = chatCmd.match(/--message "([\s\S]*)"$/);
    assert.ok(match, 'command should have escaped message flag');
    assert.ok(match[1].length <= 4000);
  });

  test('ควร escape เครื่องหมาย double quote ใน prompt และ diff ได้ถูกต้อง', () => {
    const executedCommands = [];

    const mockReadFile = () => 'Title\n---\n---\nPrompt with "quotes" and "more quotes"';
    const mockExecSync = (cmd, opts) => {
      executedCommands.push({ cmd, opts });
      if (cmd.startsWith('git diff')) {
        return 'diff --git a/file b/file\n+const msg = "hello world";';
      }
      return 'PASS';
    };

    const result = run('quotes-check.md', {
      readFile: mockReadFile,
      execSync: mockExecSync,
    });

    assert.equal(result, 'PASS');
    const chatCmd = executedCommands[1].cmd;
    assert.ok(chatCmd.includes('\\"quotes\\"'));
    assert.ok(chatCmd.includes('\\"hello world\\"'));
  });

  test('ควรจัดการไฟล์ที่ไม่มี frontmatter หรือมีรูปแบบ frontmatter ไม่ครบถ้วน', () => {
    const executedCommands = [];

    const mockReadFile = () => 'Just plain prompt without delimiters';
    const mockExecSync = (cmd, opts) => {
      executedCommands.push({ cmd, opts });
      if (cmd.startsWith('git diff')) {
        return '';
      }
      return 'DONE';
    };

    const result = run('plain.md', {
      readFile: mockReadFile,
      execSync: mockExecSync,
    });

    assert.equal(result, 'DONE');
    assert.equal(executedCommands.length, 2);
    // กรณีไม่มี delimiter --- slice(2) จะได้ empty string
    assert.match(executedCommands[1].cmd, /^npm run chat -- --message/);
  });
});
