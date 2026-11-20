// Unit tests for the shared Pro checkout (lib/pro.js). Run: node --test scripts/pro.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
const P = createRequire(import.meta.url)('../lib/pro.js');

const KEY = 'a'.repeat(32);
const SECRET = 'whsec_test_secret';
const sign = (body, t, secret = SECRET) => `t=${t},v1=${crypto.createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')}`;

test('checkoutUrl tags the app link with app_key, and refuses anything else', () => {
  const env = { PRO_LINK_DEFENDER: 'https://buy.stripe.com/test_abc' };
  assert.equal(P.checkoutUrl('defender', KEY, env), `https://buy.stripe.com/test_abc?client_reference_id=defender_${KEY}`);
  assert.equal(P.checkoutUrl('defender', 'short', env), null, 'bad key');
  assert.equal(P.checkoutUrl('defender', KEY.toUpperCase(), env), null, 'keys are lowercase hex');
  assert.equal(P.checkoutUrl('smartpump', KEY, env), null, 'app not selling');
  assert.equal(P.checkoutUrl('defender', KEY, {}), null, 'no link configured');
  assert.equal(P.checkoutUrl('defender', KEY, { PRO_LINK_DEFENDER: 'https://evil.example/pay' }), null, 'only Stripe hosts');
});

test('parseReference reads back only our own references', () => {
  assert.deepEqual(P.parseReference(`defender_${KEY}`), { app: 'defender', key: KEY });
  assert.equal(P.parseReference(`nope_${KEY}`), null);
  assert.equal(P.parseReference('defender_xyz'), null);
  assert.equal(P.parseReference(null), null);
});

test('verifyEvent accepts a good signature and rejects tampering, wrong secret, old or missing', () => {
  const body = JSON.stringify({ id: 'evt_1', type: 'ping' });
  const t = 1_800_000_000;
  assert.equal(P.verifyEvent(body, sign(body, t), SECRET, t).id, 'evt_1');
  assert.equal(P.verifyEvent(body, `t=${t},v1=deadbeef,${sign(body, t).split(',')[1]}`, SECRET, t).id, 'evt_1', 'any v1 may match');
  assert.throws(() => P.verifyEvent(body + ' ', sign(body, t), SECRET, t), /mismatch/);
  assert.throws(() => P.verifyEvent(body, sign(body, t, 'whsec_other'), SECRET, t), /mismatch/);
  assert.throws(() => P.verifyEvent(body, sign(body, t), SECRET, t + 301), /too old/);
  assert.throws(() => P.verifyEvent(body, '', SECRET, t), /header/);
  assert.throws(() => P.verifyEvent(body, sign(body, t), '', t), /secret/);
});

test('planEvent: checkout links the key (hashed, never stored raw)', () => {
  const plan = P.planEvent({
    type: 'checkout.session.completed', livemode: false,
    data: { object: { mode: 'subscription', subscription: 'sub_1', customer: 'cus_1', client_reference_id: `defender_${KEY}`, payment_status: 'paid' } },
  });
  assert.equal(plan.fn, 'pro_link');
  assert.equal(plan.args.p_app, 'defender');
  assert.equal(plan.args.p_key_hash, P.keyHash(KEY));
  assert.ok(!JSON.stringify(plan).includes(KEY), 'the raw key never reaches the store');
  assert.equal(plan.args.p_paid, true);
  assert.equal(plan.args.p_livemode, false);
});

test('planEvent: ignores one-time payments, foreign references and unknown events', () => {
  const base = { mode: 'subscription', subscription: 'sub_1', client_reference_id: `defender_${KEY}`, payment_status: 'paid' };
  assert.equal(P.planEvent({ type: 'checkout.session.completed', data: { object: { ...base, mode: 'payment' } } }), null);
  assert.equal(P.planEvent({ type: 'checkout.session.completed', data: { object: { ...base, client_reference_id: 'someone_else' } } }), null);
  assert.equal(P.planEvent({ type: 'invoice.paid', data: { object: {} } }), null);
  assert.equal(P.planEvent({ type: 'customer.subscription.updated', data: { object: { id: 'sub_1', status: 'active', metadata: { app: 'other' } } } }), null);
});

test('planEvent: subscription events set status, period end (top level or item), cancel flag', () => {
  const sub = { id: 'sub_1', customer: 'cus_1', status: 'active', cancel_at_period_end: true, metadata: { app: 'defender' }, items: { data: [{ current_period_end: 1_800_000_000 }] } };
  const plan = P.planEvent({ type: 'customer.subscription.updated', created: 1_799_000_000, livemode: true, data: { object: sub } });
  assert.equal(plan.fn, 'pro_set_status');
  assert.equal(plan.args.p_status, 'active');
  assert.equal(plan.args.p_period_end, new Date(1_800_000_000 * 1000).toISOString());
  assert.equal(plan.args.p_cancel_at_period_end, true);
  assert.equal(plan.args.p_event_at, new Date(1_799_000_000 * 1000).toISOString());
  const del = P.planEvent({ type: 'customer.subscription.deleted', created: 1, data: { object: { ...sub, status: 'active' } } });
  assert.equal(del.args.p_status, 'canceled', 'deleted always means canceled');
});

test('verdict: only the matching mode counts, and only paying statuses within the period', () => {
  const now = Date.parse('2026-12-01T00:00:00Z');
  const future = '2026-12-20T00:00:00Z';
  assert.equal(P.verdict([{ status: 'active', current_period_end: future, livemode: false }], true, now).pro, false, 'test purchase never counts on live');
  assert.equal(P.verdict([{ status: 'active', current_period_end: future, livemode: true }], true, now).pro, true);
  assert.equal(P.verdict([{ status: 'past_due', current_period_end: future, livemode: false }], false, now).pro, true);
  assert.equal(P.verdict([{ status: 'canceled', current_period_end: future, livemode: false }], false, now).pro, false);
  assert.equal(P.verdict([{ status: 'active', current_period_end: '2026-11-20T00:00:00Z', livemode: false }], false, now).pro, false, 'stale period');
  assert.equal(P.verdict([{ status: 'active', current_period_end: null, livemode: false }], false, now).pro, true, 'paid at checkout, period not seen yet');
  assert.deepEqual(P.verdict([], false, now), { pro: false, status: 'none', until: null });
  assert.equal(P.verdict([{ status: null, livemode: false }], false, now).status, 'pending');
});

test('checkout says "not open yet" while the app has no live Stripe link; refuses a bad key', async () => {
  const handler = createRequire(import.meta.url)('../api/pro/checkout.js');
  const call = (url) => new Promise((resolve) => {
    const res = { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, end(b) { resolve({ status: this.statusCode, headers: this.headers, body: String(b || '') }); } };
    handler({ url, headers: {} }, res);
  });
  const saved = process.env.PRO_LINK_DEFENDER;
  delete process.env.PRO_LINK_DEFENDER;
  try {
    const closed = await call(`/api/pro/checkout?app=defender&key=${KEY}`);
    assert.equal(closed.status, 503);
    assert.equal(closed.body, 'Checkout is not open for this app yet.');
    assert.equal((await call('/api/pro/checkout?app=defender&key=nope')).status, 400);
    process.env.PRO_LINK_DEFENDER = 'https://buy.stripe.com/test_abc';
    const open = await call(`/api/pro/checkout?app=defender&key=${KEY}`);
    assert.equal(open.status, 302);
    assert.equal(open.headers.location, `https://buy.stripe.com/test_abc?client_reference_id=defender_${KEY}`);
  } finally {
    if (saved === undefined) delete process.env.PRO_LINK_DEFENDER; else process.env.PRO_LINK_DEFENDER = saved;
  }
});
