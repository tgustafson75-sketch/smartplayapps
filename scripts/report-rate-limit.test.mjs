// /api/report must refuse a flood: 20 reports a minute per instance, then 429.
// Run: node --test scripts/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { Readable } from 'node:stream';

const require = createRequire(import.meta.url);
delete process.env.SENTRY_DSN; // never reach Sentry from a test; reports fall back to the log
const handler = require('../api/report.js');

function call() {
  const req = Readable.from([Buffer.from(JSON.stringify({ kind: 'client_error', message: 'flood test', path: '/' }))]);
  req.method = 'POST';
  return new Promise((resolve) => {
    const res = { statusCode: 0, setHeader() {}, end() { resolve(res.statusCode); } };
    handler(req, res);
  });
}

test('the 21st report inside a minute is refused', async () => {
  const quiet = console.error;
  console.error = () => {};
  try {
    const codes = [];
    for (let i = 0; i < 25; i++) codes.push(await call());
    assert.deepEqual(codes.slice(0, 20), Array(20).fill(200));
    assert.deepEqual(codes.slice(20), Array(5).fill(429));
  } finally {
    console.error = quiet;
  }
});
