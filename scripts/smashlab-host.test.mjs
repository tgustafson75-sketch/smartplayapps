// playsmashlab.com shares this deployment: it has its own home, investors, contact, robots and
// sitemap, every other path there goes home, and smartplayapps.com is untouched. Run: node --test scripts/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import middleware, { SMASHLAB_HOST, SMASHLAB_PAGES } from '../middleware.js';

const rewriteOf = async (u) => {
  const res = await middleware(new Request(u));
  return res && new URL(res.headers.get('x-middleware-rewrite')).pathname;
};

test('playsmashlab.com paths rewrite to the SmashLab files, which exist', async () => {
  for (const host of ['https://playsmashlab.com', 'https://www.playsmashlab.com']) {
    for (const [path, target] of Object.entries(SMASHLAB_PAGES)) {
      assert.equal(await rewriteOf(host + path), target);
      const file = target.includes('.') ? target : target + '.html';
      assert.ok(existsSync(new URL('..' + file, import.meta.url)), file);
    }
  }
});

test('smartplayapps.com pages are left alone', async () => {
  for (const p of Object.keys(SMASHLAB_PAGES)) assert.equal(await middleware(new Request('https://www.smartplayapps.com' + p)), undefined);
  assert.equal(SMASHLAB_HOST.test('notplaysmashlab.com'), false);
});

test('every other path on the domain goes home; the pages, assets and self-heal do not', () => {
  const cfg = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url)));
  const r = cfg.redirects.find((x) => x.has?.[0]?.value?.includes('playsmashlab'));
  const re = new RegExp('^/' + r.source.match(/\(\?!.*\)\.\+/)[0] + '$');
  for (const p of ['/store', '/products', '/media', '/index.html']) assert.ok(re.test(p), p);
  for (const p of ['/smashlab', '/smashlab-investors', '/smashlab.css', '/img/smashlab/logo.svg', '/js/selfheal.js', '/api/report', '/api/health', '/investors', '/contact', '/robots.txt', '/sitemap.xml'])
    assert.ok(!re.test(p), p);
});
