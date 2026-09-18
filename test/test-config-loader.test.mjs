// Unit tests for the unified config loader (Doppler → Cloudflare → .env).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveValue, parseWranglerVars } from '../packages/core/aipass-bridge/bridge/config.mjs';

const ctx = (over = {}) => ({
  doppler: {}, cloudflare: {}, dotenv: {}, env: {}, ...over,
});

test('doppler layer wins over cloudflare, .env and defaults', async () => {
  const v = await resolveValue('MODEL', { env: 'AIPASS_MODEL', default: 'fallback' }, ctx({
    doppler: { AIPASS_MODEL: 'from-doppler' },
    cloudflare: { AIPASS_MODEL: 'from-cloudflare' },
    dotenv: { AIPASS_MODEL: 'from-dotenv' },
  }));
  assert.equal(v, 'from-doppler');
});

test('cloudflare layer wins over .env and defaults', async () => {
  const v = await resolveValue('MODEL', { env: 'AIPASS_MODEL', default: 'fallback' }, ctx({
    cloudflare: { AIPASS_MODEL: 'from-cloudflare' },
    dotenv: { AIPASS_MODEL: 'from-dotenv' },
  }));
  assert.equal(v, 'from-cloudflare');
});

test('.env layer wins over defaults but not over doppler/cloudflare', async () => {
  const v = await resolveValue('MODEL', { env: 'AIPASS_MODEL', default: 'fallback' }, ctx({
    dotenv: { AIPASS_MODEL: 'from-dotenv' },
  }));
  assert.equal(v, 'from-dotenv');
});

test('default applies when every layer is empty', async () => {
  const v = await resolveValue('MODEL', { env: 'AIPASS_MODEL', default: 'fallback' }, ctx());
  assert.equal(v, 'fallback');
});

test('number and boolean coercion', async () => {
  const n = await resolveValue('PORT', { type: 'number', default: 8787 }, ctx({
    dotenv: { AIPASS_PORT: '9000' },
  }));
  assert.equal(n, 9000);
  const b = await resolveValue('ADMIN', { type: 'boolean', default: false }, ctx({
    doppler: { AIPASS_ADMIN: '1' },
  }));
  assert.equal(b, true);
  const bad = await resolveValue('PORT', { type: 'number', default: 8787 }, ctx({
    doppler: { AIPASS_PORT: 'not-a-number' },
  }));
  assert.equal(bad, 8787);
});

test('missing required value stays undefined (fail fast, no fabrication)', async () => {
  const v = await resolveValue('SECRET', { env: 'BRIDGE_SECRET' }, ctx());
  assert.equal(v, undefined);
});

test('parseWranglerVars reads only the [vars] block, ignoring comments', () => {
  const toml = `
name = "aipass-web-bridge"
[vars]
AIPASS_MODEL = "gemini-3.1-flash-lite"
# AIPASS_IGNORED = "no"
AIPASS_PORT = 9000
[other]
AIPASS_NOT_VAR = "x"
`;
  const vars = parseWranglerVars(toml);
  assert.equal(vars.AIPASS_MODEL, 'gemini-3.1-flash-lite');
  assert.equal(vars.AIPASS_PORT, '9000');
  assert.equal(vars.AIPASS_IGNORED, undefined);
  assert.equal(vars.AIPASS_NOT_VAR, undefined);
});
