// scripts/test-live-bridge.mjs
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { BridgeClient } from '../out/shared/bridgeClient.js';
import { runAgentLoop } from '../out/core/agent.js';

async function testThaiTask() {
  console.log('Testing live Thai task with runAgentLoop against http://127.0.0.1:8787...');
  const client = new BridgeClient('http://127.0.0.1:8787');

  await client.createNewConversation({ temporary: true, message: 'Starting fresh coding session.' });

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aipass-live-thai-'));
  console.log('Created temporary project at:', tmpDir);

  const response = await runAgentLoop(
    'ช่วยสร้างไฟล์ hello.txt เขียนข้อความ "สวัสดีจาก AiPASS VS Code Extension" แล้วอ่านไฟล์นั้นกลับมายืนยันด้วยครับ',
    {
      client,
      baseDir: tmpDir,
      maxSteps: 5,
      onProgress: (msg) => console.log('  [Progress]', msg),
      onToolCall: (name, params, res) => console.log(`  [Tool] ${name}(${JSON.stringify(params)}): ${res.split('\n')[0].slice(0, 60)}...`),
    }
  );

  console.log('\n--- Final Response ---');
  console.log(response);

  const createdFile = path.join(tmpDir, 'hello.txt');
  if (fs.existsSync(createdFile)) {
    console.log('\n✅ File hello.txt was created on disk!');
    console.log('Content:', fs.readFileSync(createdFile, 'utf8'));
  } else {
    console.log('❌ File was not created.');
  }

  fs.rmSync(tmpDir, { recursive: true, force: true });
}

testThaiTask().catch(console.error);
