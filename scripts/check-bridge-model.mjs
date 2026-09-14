#!/usr/bin/env node
// Check if bridge is switching models due to credit issues
// Usage: node scripts/check-bridge-model.mjs [model_id]

const MODEL = process.argv[2] || 'claude-sonnet-5@default';
const BRIDGE = 'http://127.0.0.1:8787';

async function check() {
  const res = await fetch(`${BRIDGE}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: 'user', content: 'Say hello in one word' }],
    }),
  });
  const data = await res.json();
  const used = data.model;
  const rc = data.choices?.[0]?.message?.reasoning_content || '';
  const switched = rc.includes('data-model_switched');
  
  console.log(`Requested: ${MODEL}`);
  console.log(`Actual:    ${used}`);
  
  if (switched) {
    const match = rc.match(/data-model_switched.*?(\{.*?\})/);
    if (match) {
      try {
        const info = JSON.parse(match[1]);
        console.log(`⚠️  SWITCHED: ${info.data?.fromModelId} → ${info.data?.toModelId}`);
        console.log(`Reason: ${info.data?.reason}`);
      } catch {
        console.log(`⚠️  SWITCHED: ${rc.slice(0, 200)}`);
      }
    }
    process.exit(1);
  } else {
    console.log(`✅ Model stable (${used})`);
    process.exit(0);
  }
}

check().catch(e => { console.error(e); process.exit(2); });
