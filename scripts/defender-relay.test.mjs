// The Defender report relay: accepts only what Defender sends, only from a Chrome extension,
// scrubs everything again, and forwards to the defender-extension Sentry project.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const route = require('../api/defender-report.js');
const { defenderEvent } = route;

const EXT = 'chrome-extension://' + 'a'.repeat(32);
const base = { app: 'defender', version: '0.9.2', build: 'b1a2c3', environment: 'production', platform: 'chrome-extension', kind: 'sw_error', level: 'error', message: 'tabs.query failed' };

function call(method, body, headers = {}) {
  const req = Readable.from(body ? [Buffer.from(typeof body === 'string' ? body : JSON.stringify(body))] : []);
  Object.assign(req, { method, headers: { 'x-real-ip': String(Math.random()), ...headers } });
  const res = { statusCode: 200, headers: {}, body: '', setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, end(b) { this.body = b || ''; return this; } };
  return route(req, res).then(() => res);
}

test('a real Defender report becomes a tagged Sentry event', () => {
  const e = defenderEvent(base, 0);
  assert.equal(e.release, 'defender@0.9.2+b1a2c3');
  assert.deepEqual(e.tags, { app: 'defender', version: '0.9.2', build: 'b1a2c3', platform: 'chrome-extension', kind: 'sw_error' });
  assert.equal(e.message.formatted, 'sw_error: tabs.query failed');
});

test('anything that is not a Defender report is refused', () => {
  assert.equal(defenderEvent({ ...base, app: 'caddie' }), null);
  assert.equal(defenderEvent({ ...base, kind: 'whatever' }), null);
  assert.equal(defenderEvent({ ...base, version: '1; drop' }), null);
  assert.equal(defenderEvent(null), null);
});

test('links, hosts, emails and paths never reach Sentry', () => {
  const e = defenderEvent({ ...base, message: 'agent opened https://mail.google.com/x?id=1 for tim@example.com at /Users/tim/Documents/a.pdf on bank.example.com and chase.com',
    extra: { lastErrors: [{ kind: 'page_error', message: 'see https://evil.example/path', at: '2026-11-14T10:00:00Z' }], health: { ok: false, problems: ['tabs api at https://x.y/z'], warnings: [] } } }, 0);
  const all = JSON.stringify(e);
  for (const bad of ['mail.google.com', 'tim@example.com', '/Users/tim', 'bank.example.com', 'evil.example', 'x.y/z', 'chase.com']) assert.ok(!all.includes(bad), bad);
});

test('only Chrome extensions get an answer (CORS), and only POST sends', async () => {
  const pre = await call('OPTIONS', null, { origin: EXT });
  assert.equal(pre.statusCode, 204);
  assert.equal(pre.headers['access-control-allow-origin'], EXT);
  const web = await call('POST', base, { origin: 'https://evil.example' });
  assert.equal(web.statusCode, 403);
  assert.equal(web.headers['access-control-allow-origin'], undefined);
  assert.equal((await call('GET', null, { origin: EXT })).statusCode, 405);
  assert.equal((await call('POST', 'not json', { origin: EXT })).statusCode, 400);
});

test('a valid report is forwarded once and answered ok', async () => {
  const sent = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => { sent.push({ url, body: init.body }); return { ok: true }; };
  try {
    const res = await call('POST', base, { origin: EXT });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(JSON.parse(res.body), { ok: true, sentTo: 'sentry' });
    assert.equal(sent.length, 1);
    assert.match(sent[0].url, /ingest\.us\.sentry\.io\/api\/4512420175544320\/envelope\//);
  } finally { globalThis.fetch = realFetch; }
});

test('the per-IP limit holds', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true });
  try {
    const codes = [];
    for (let i = 0; i < 7; i++) codes.push((await call('POST', base, { origin: EXT, 'x-real-ip': '9.9.9.9' })).statusCode);
    assert.deepEqual(codes, [200, 200, 200, 200, 200, 429, 429]);
  } finally { globalThis.fetch = realFetch; }
});
