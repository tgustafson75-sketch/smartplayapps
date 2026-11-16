// Rate limits must hold when requests arrive together and land on different serverless instances.
// A fake Supabase stands in for the real one: plain table reads and writes take a moment (so a
// "count, then insert" pair races exactly like it does in production), while the take_rate_slot RPC
// is atomic, like the Postgres function in supabase/20261115_rate_slots.sql. Run: node --test scripts/
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { Readable } from 'node:stream';

const require = createRequire(import.meta.url);
const BASE = 'https://fake-store.test';
const tick = () => new Promise((r) => setTimeout(r, 5));

let tables;
let slots;
let storeUp;
let realFetch;

function fakeFetch(url, init = {}) {
  const u = new URL(url);
  if (u.origin !== BASE) return Promise.resolve({ ok: true, status: 200, json: async () => ({}) }); // Sentry, Postmark
  if (!storeUp) return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
  const name = u.pathname.replace('/rest/v1/', '');
  if (name === 'rpc/take_rate_slot') {
    const { p_bucket, p_max, p_window_seconds } = JSON.parse(init.body);
    const now = Date.now();
    const live = (slots.get(p_bucket) || []).filter((t) => now - t < p_window_seconds * 1000);
    const ok = live.length < p_max; // decided and recorded in one step: atomic
    if (ok) live.push(now);
    slots.set(p_bucket, live);
    return tick().then(() => ({ ok: true, status: 200, json: async () => ok }));
  }
  const rows = (tables[name] ||= []);
  if (!init.method || init.method === 'GET') {
    const snapshot = rows.slice(); // read now, answer later: the race window
    return tick().then(() => ({ ok: true, status: 200, json: async () => snapshot }));
  }
  if (init.method === 'POST') {
    const row = JSON.parse(init.body);
    return tick().then(() => { rows.push(row); return { ok: true, status: 201, json: async () => ({}) }; });
  }
  return tick().then(() => ({ ok: true, status: 204, json: async () => ({}) }));
}

function fresh(path) {
  for (const k of Object.keys(require.cache)) if (/[\\/](api|lib)[\\/]/.test(k)) delete require.cache[k];
  return require(path);
}

function call(handler, body, headers) {
  const req = Readable.from([Buffer.from(JSON.stringify(body))]);
  req.method = 'POST';
  req.headers = headers;
  return new Promise((resolve) => {
    const res = { statusCode: 0, setHeader() {}, end() { resolve(res.statusCode); } };
    Promise.resolve(handler(req, res)).catch(() => resolve(-1));
  });
}

const count = (codes, c) => codes.filter((x) => x === c).length;

beforeEach(() => {
  tables = {};
  slots = new Map();
  storeUp = true;
  realFetch = globalThis.fetch;
  globalThis.fetch = fakeFetch;
  process.env.SUPABASE_URL = BASE;
  process.env.SUPABASE_SECRET_KEY = 'test-key';
  delete process.env.POSTMARK_SERVER_TOKEN;
  delete process.env.SENTRY_DSN;
  console.error = () => {};
});
const quiet = console.error;
afterEach(() => {
  globalThis.fetch = realFetch;
  console.error = quiet;
});

const tryBody = { app: 'bay', name: 'Pat', email: 'pat@example.com', use_case: 'home' };
const pilotBody = { business_name: 'Shop', contact_name: 'Pat', email: 'pat@example.com', business_type: 'sporting_goods', track: 'both', space_available: 'yes' };
const contactBody = { name: 'Pat', email: 'pat@example.com', topic: 'Other', message: 'hi' };

test('10 concurrent try-code requests for one email mint exactly 3 codes', async () => {
  const h = fresh('../api/try/request.js');
  const codes = await Promise.all(Array.from({ length: 10 }, () => call(h, tryBody, { 'x-forwarded-for': '203.0.113.9' })));
  assert.equal(count(codes, 200), 3, `statuses ${codes}`);
  assert.equal(count(codes, 429), 7);
  assert.equal(tables.try_codes.length, 3);
});

test('15 concurrent try-code requests from one IP with 15 different emails mint exactly 10 codes', async () => {
  const h = fresh('../api/try/request.js');
  const codes = await Promise.all(Array.from({ length: 15 }, (_, i) => call(h, { ...tryBody, email: `pat${i}@example.com` }, { 'x-forwarded-for': '203.0.113.10' })));
  assert.equal(count(codes, 200), 10, `statuses ${codes}`);
  assert.equal(count(codes, 429), 5);
  assert.equal(tables.try_codes.length, 10);
  // A different sender is not caught by the first one's cap.
  assert.equal(await call(h, { ...tryBody, email: 'other@example.com' }, { 'x-forwarded-for': '198.51.100.20' }), 200);
});

test('10 concurrent pilot requests for one email store exactly 3', async () => {
  const h = fresh('../api/pilot.js');
  const codes = await Promise.all(Array.from({ length: 10 }, () => call(h, pilotBody, { 'x-forwarded-for': '203.0.113.9' })));
  assert.equal(count(codes, 200), 3, `statuses ${codes}`);
  assert.equal(tables.pilot_requests.length, 3);
});

test('12 concurrent contact sends from one IP store exactly 5', async () => {
  const h = fresh('../api/contact.js');
  const codes = await Promise.all(Array.from({ length: 12 }, () => call(h, contactBody, { 'x-forwarded-for': '203.0.113.9' })));
  assert.equal(count(codes, 200), 5, `statuses ${codes}`);
  assert.equal(count(codes, 429), 7);
  assert.equal(tables.site_requests.length, 5);
});

test('/api/report: 20 reports from one IP spread over two instances pass only 5', async () => {
  const a = fresh('../api/report.js');
  const b = fresh('../api/report.js');
  assert.notEqual(a, b, 'two separate instances');
  const body = { kind: 'client_error', message: 'flood', path: '/' };
  const codes = await Promise.all(Array.from({ length: 20 }, (_, i) => call(i % 2 ? a : b, body, { 'x-real-ip': '203.0.113.1' })));
  assert.equal(count(codes, 200), 5, `statuses ${codes}`);
  assert.equal(count(codes, 429), 15);
});

test('/api/defender-report: the same limit holds across two instances', async () => {
  const a = fresh('../api/defender-report.js');
  const b = fresh('../api/defender-report.js');
  const body = { app: 'defender', version: '0.9.2', platform: 'chrome-extension', kind: 'sw_error', level: 'error', message: 'x' };
  const headers = { 'x-real-ip': '203.0.113.2', origin: `chrome-extension://${'a'.repeat(32)}` };
  const codes = await Promise.all(Array.from({ length: 20 }, (_, i) => call(i % 2 ? a : b, body, headers)));
  assert.equal(count(codes, 200), 5, `statuses ${codes}`);
});

test('store down: forms refuse with their existing 503 and save nothing; reports fall back to a per-instance cap', async () => {
  storeUp = false;
  for (const [path, body] of [['../api/try/request.js', tryBody], ['../api/pilot.js', pilotBody], ['../api/contact.js', contactBody]]) {
    const h = fresh(path);
    assert.equal(await call(h, body, { 'x-forwarded-for': '203.0.113.9' }), 503, path);
  }
  assert.deepEqual(Object.values(tables).flat(), []);
  const r = fresh('../api/report.js');
  const codes = [];
  for (let i = 0; i < 7; i++) codes.push(await call(r, { kind: 'health', message: 'down', path: '/' }, { 'x-real-ip': '203.0.113.3' }));
  assert.deepEqual(codes, [200, 200, 200, 200, 200, 429, 429]);
});
