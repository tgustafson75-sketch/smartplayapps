// playsmashlab.com shares this deployment: its home page must be the SmashLab coming-soon page,
// and smartplayapps.com's home page must be untouched. Run: node --test scripts/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import middleware, { SMASHLAB_HOST } from '../middleware.js';

const req = (u) => new Request(u);

test('playsmashlab.com home rewrites to the splash', async () => {
  for (const h of ['https://playsmashlab.com/', 'https://www.playsmashlab.com/']) {
    const res = await middleware(req(h));
    assert.equal(new URL(res.headers.get('x-middleware-rewrite')).pathname, '/smashlab');
  }
});

test('smartplayapps.com home is left alone', async () => {
  assert.equal(await middleware(req('https://www.smartplayapps.com/')), undefined);
  assert.equal(SMASHLAB_HOST.test('notplaysmashlab.com'), false);
});

test('the splash and its logo exist, and every other path on the domain goes home', () => {
  assert.ok(existsSync(new URL('../smashlab.html', import.meta.url)));
  assert.ok(existsSync(new URL('../img/smashlab/logo.svg', import.meta.url)));
  const cfg = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url)));
  const r = cfg.redirects.find((x) => x.has?.[0]?.value?.includes('playsmashlab'));
  const re = new RegExp('^/' + r.source.match(/\(\?!.*\)\.\+/)[0] + '$');
  assert.ok(re.test('/store'));
  assert.ok(!re.test('/smashlab'));
  assert.ok(!re.test('/img/smashlab/logo.svg'));
  assert.ok(!re.test('/js/selfheal.js'));
  assert.ok(!re.test('/api/report'));
  assert.ok(!re.test('/api/health'));
});
