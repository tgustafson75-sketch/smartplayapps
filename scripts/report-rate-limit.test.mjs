// /api/report must refuse a flood per sender: 5 reports a minute per client IP, then 429,
// without cutting off anyone else. Run: node --test scripts/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { Readable } from 'node:stream';

const require = createRequire(import.meta.url);
delete process.env.SENTRY_DSN; // never reach Sentry from a test; reports fall back to the log
const handler = require('../api/report.js');

function call(ip) {
  const req = Readable.from([Buffer.from(JSON.stringify({ kind: 'client_error', message: 'flood test', path: '/' }))]);
  req.method = 'POST';
  req.headers = { 'x-real-ip': ip };
  return new Promise((resolve) => {
    const res = { statusCode: 0, setHeader() {}, end() { resolve(res.statusCode); } };
    handler(req, res);
  });
}

async function quietly(fn) {
  const quiet = console.error;
  console.error = () => {};
  try { return await fn(); } finally { console.error = quiet; }
}

test('one IP sending 25 reports is cut off after 5', () => quietly(async () => {
  const codes = [];
  for (let i = 0; i < 25; i++) codes.push(await call('203.0.113.1'));
  assert.deepEqual(codes.slice(0, 5), Array(5).fill(200));
  assert.deepEqual(codes.slice(5), Array(20).fill(429));
}));

test('a second IP still gets through while the first is cut off', () => quietly(async () => {
  assert.equal(await call('203.0.113.1'), 429);
  assert.equal(await call('198.51.100.7'), 200);
}));
