// The browser startup health check reports what the server says, never a request that got no answer.
// Run: node scripts/health-check.test.mjs
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const src = readFileSync(new URL('../js/selfheal.js', import.meta.url), 'utf8');

async function run(healthResponse) {
  const reports = [];
  const fetch = (url, opts) => {
    if (url === '/api/report') { reports.push(JSON.parse(opts.body)); return Promise.resolve({ ok: true }); }
    return healthResponse();
  };
  const store = {};
  const ctx = {
    fetch, location: { pathname: '/', origin: 'https://x' },
    sessionStorage: { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = v; } },
    document: { readyState: 'complete', addEventListener() {} },
    window: { addEventListener() {} },
    JSON, String, Promise,
  };
  vm.runInNewContext(src, ctx);
  await new Promise((r) => setTimeout(r, 10));
  return reports.filter((r) => r.kind === 'health');
}

const json = (body, ok = true, status = 200) => () => Promise.resolve({ ok, status, json: () => (body instanceof Error ? Promise.reject(body) : Promise.resolve(body)) });

let failed = 0;
async function check(name, fn) { try { await fn(); console.log('  ✓', name); } catch (e) { failed++; console.log('  ✗', name, e.message); } }

await check('healthy server: nothing reported', async () => assert.equal((await run(json({ ok: true, problems: [] }))).length, 0));
await check('server reports a problem: reported with its words', async () => {
  const r = await run(json({ ok: false, problems: ['SENTRY_DSN missing'] }));
  assert.equal(r.length, 1); assert.equal(r[0].message, 'SENTRY_DSN missing');
});
await check('server error status: reported', async () => {
  const r = await run(json({}, false, 500)); assert.equal(r.length, 1); assert.equal(r[0].message, 'health returned 500');
});
await check('body is not JSON: reported', async () => {
  const r = await run(json(new Error('bad json'))); assert.equal(r.length, 1); assert.match(r[0].message, /not JSON/);
});
await check('no answer at all (visitor network): not reported', async () => assert.equal((await run(() => Promise.reject(new TypeError('Failed to fetch')))).length, 0));

console.log(failed ? `\n${failed} failed` : '\nall health-check scenarios pass');
process.exit(failed ? 1 : 0);
