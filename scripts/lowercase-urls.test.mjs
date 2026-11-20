// A capitalized page address (a phone autocapitalized smartplayapps.com/Veterans) must reach the page,
// not a 404: the middleware sends it to the lowercase address, and its matcher must actually route it there.
// Run: node --test scripts/lowercase-urls.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import middleware, { config, lowercaseRedirect } from '../middleware.js';

test('capitalized page addresses redirect (308) to an existing lowercase page, query kept', async () => {
  for (const [typed, page] of [['/Veterans', '/veterans'], ['/PILOT', '/pilot'], ['/Products', '/products'], ['/Media/Access', '/media/access']]) {
    const res = await middleware(new Request('https://www.smartplayapps.com' + typed + '?from=text'));
    assert.equal(res.status, 308, typed);
    assert.equal(new URL(res.headers.get('location')).pathname + new URL(res.headers.get('location')).search, page + '?from=text');
    assert.ok(existsSync(new URL('..' + page + '.html', import.meta.url)), page);
  }
});

test('lowercase pages and files with capitals are left alone', () => {
  for (const p of ['/', '/veterans', '/pilot', '/SmartPlay-AI-Investor-Deck.pdf', '/img/Caddie.webp']) assert.equal(lowercaseRedirect(p), null, p);
});

test('the middleware matcher routes capitalized pages (and only pages) to the middleware', () => {
  const m = config.matcher.find((x) => x.startsWith('/:page('));
  assert.ok(m, 'capital-letter matcher present');
  const re = new RegExp('^/' + m.slice('/:page('.length, -1) + '$');
  for (const p of ['/Veterans', '/media/Access']) assert.ok(re.test(p), p);
  for (const p of ['/veterans', '/SmartPlay-AI-Investor-Deck.pdf']) assert.ok(!re.test(p), p);
});
