// Unit tests for the shared try-code system (lib/try.js). Run: node --test scripts/try-codes.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const T = createRequire(import.meta.url)('../lib/try.js');

test('codes use the app prefix and no look-alike characters', () => {
  for (let i = 0; i < 2000; i++) {
    const sm = T.makeCode('smartmotion');
    const bay = T.makeCode('bay');
    assert.match(sm, /^SM-[A-Z0-9]{4}$/);
    assert.match(bay, /^BAY-[A-Z0-9]{4}$/);
    assert.ok(T.CODE_RE.test(sm) && T.CODE_RE.test(bay));
    for (const c of sm.split('-')[1] + bay.split('-')[1]) assert.ok(!'01OILSZ2B58'.includes(c), `look-alike ${c}`);
  }
});

test('normalizeCode forgives case, spaces and a missing dash', () => {
  assert.equal(T.normalizeCode(' sm-7f3k '), 'SM-7F3K');
  assert.equal(T.normalizeCode('bay9q2d'), 'BAY-9Q2D');
  assert.equal(T.normalizeCode('SM 7F3K'), 'SM-7F3K');
});

test('verdict: valid, expired, wrong app, not found', () => {
  const now = Date.parse('2026-11-15T00:00:00Z');
  const row = { app: 'bay', expires_at: '2026-12-15T00:00:00Z' };
  assert.equal(T.verdict(row, 'bay', now), 'valid');
  assert.equal(T.verdict(row, 'smartmotion', now), 'wrong_app');
  assert.equal(T.verdict({ ...row, expires_at: '2026-11-14T00:00:00Z' }, 'bay', now), 'expired');
  assert.equal(T.verdict(null, 'bay', now), 'not_found');
});

test('request form takes exactly the five fields and rejects bad input', () => {
  const ok = T.parseTryRequest({ name: 'A', email: 'A@B.co', app: 'smartmotion', use_case: 'coach', is_veteran: 'yes', extra: 'x' });
  assert.deepEqual(ok, { ok: true, value: { app: 'smartmotion', name: 'A', email: 'a@b.co', use_case: 'coach', is_veteran: true, source: null } });
  assert.equal(T.parseTryRequest({ name: 'A', email: 'a@b.co', app: 'caddie', use_case: 'home' }).ok, false);
  assert.equal(T.parseTryRequest({ name: 'A', email: 'nope', app: 'bay', use_case: 'home' }).ok, false);
  assert.equal(T.parseTryRequest({ name: 'A', email: 'a@b.co', app: 'bay', use_case: 'gym' }).ok, false);
});

test('pilot form requires business, contact, email and the three choices', () => {
  const base = { business_name: 'Shop', contact_name: 'Pat', email: 'p@s.co', business_type: 'sporting_goods', track: 'both', space_available: 'not_sure' };
  assert.equal(T.parsePilot(base).ok, true);
  assert.equal(T.parsePilot({ ...base, track: 'golf' }).ok, false);
  assert.equal(T.parsePilot({ ...base, business_name: '' }).ok, false);
});
