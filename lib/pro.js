// SmartPlay Pro checkout: ONE shared system for every app's Pro (Tim, 2026-11-19). Apps hold no Stripe key and
// no card code. They send people to GET /api/pro/checkout?app=<app>&key=<pro key>, and ask
// GET /api/pro/status?app=<app>&key=<pro key> whether that key is Pro.
//
// - The Pro key is a random id the app makes and keeps (e.g. Defender's chrome.storage). Paying ties the key to
//   the subscription; entering the same key on another computer makes that one Pro too. Only sha256(key) is stored.
// - Checkout is a Stripe Payment Link per app (env PRO_LINK_<APP>), opened with client_reference_id=<app>_<key>.
// - Stripe tells us what happened through the webhook (api/pro/webhook.js), checked with STRIPE_WEBHOOK_SECRET.
//   This site holds no Stripe API key at all: it never calls Stripe, Stripe only calls it.
// - PRO_LIVEMODE=1 on production: only live-mode subscriptions count there, so a test purchase can never make
//   anyone Pro on the real site. Previews leave it unset and count only test-mode ones.
// - Cancel and card changes: Stripe's own customer page (env PRO_PORTAL_URL), which signs people in by email.
const crypto = require('crypto');

/** Apps that can sell Pro. A new app is one line here plus its PRO_LINK_<APP> env var. */
const APPS = { defender: { name: 'Defender Pro' } };
const KEY_RE = /^[a-f0-9]{32}$/; // 128 random bits, hex. Fits client_reference_id (alphanumerics, -, _; max 200).
const PRO_STATUSES = ['active', 'trialing', 'past_due'];
const TOLERANCE_S = 300; // Stripe's recommended signature age limit

const isApp = (a) => Object.prototype.hasOwnProperty.call(APPS, a);
const keyHash = (key) => crypto.createHash('sha256').update(`smartplay-pro:${key}`).digest('hex');
const linkEnv = (app) => `PRO_LINK_${app.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;

/** The Stripe Payment Link URL for this app and key, or null when the app cannot sell here. */
function checkoutUrl(app, key, env = process.env) {
  if (!isApp(app) || !KEY_RE.test(key)) return null;
  const base = env[linkEnv(app)];
  if (!base || !/^https:\/\/(buy\.stripe\.com|checkout\.stripe\.com)\//.test(base)) return null;
  const u = new URL(base);
  u.searchParams.set('client_reference_id', `${app}_${key}`);
  return u.toString();
}

/** Split client_reference_id back into { app, key }, or null if it is not ours. */
function parseReference(ref) {
  const m = /^([a-z][a-z-]*)_([a-f0-9]{32})$/.exec(String(ref || ''));
  if (!m || !isApp(m[1])) return null;
  return { app: m[1], key: m[2] };
}

/**
 * Verify a Stripe-Signature header against the raw body (Stripe's scheme: HMAC-SHA256 of "<t>.<body>", any v1
 * may match, timestamp within tolerance). Returns the parsed event or throws.
 */
function verifyEvent(rawBody, header, secret, nowS = Math.floor(Date.now() / 1000)) {
  if (!secret) throw new Error('webhook secret not set');
  const parts = String(header || '').split(',').map((p) => p.split('='));
  const t = Number((parts.find(([k]) => k === 't') || [])[1]);
  const sigs = parts.filter(([k]) => k === 'v1').map(([, v]) => v);
  if (!t || !sigs.length) throw new Error('bad signature header');
  if (Math.abs(nowS - t) > TOLERANCE_S) throw new Error('signature too old');
  const expected = crypto.createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex');
  const ok = sigs.some((s) => s.length === expected.length && crypto.timingSafeEqual(Buffer.from(s), Buffer.from(expected)));
  if (!ok) throw new Error('signature mismatch');
  return JSON.parse(rawBody);
}

const iso = (s) => (typeof s === 'number' ? new Date(s * 1000).toISOString() : null);

/**
 * What a Stripe event means for us: { fn, args } for one of the two database functions, or null to ignore it.
 * Subscriptions carry app in metadata (set on each app's Payment Link). Period end moved onto the item in newer
 * API versions, so both places are read.
 */
function planEvent(event) {
  const o = event && event.data && event.data.object;
  if (!o) return null;
  if (event.type === 'checkout.session.completed') {
    if (o.mode !== 'subscription' || !o.subscription) return null;
    const ref = parseReference(o.client_reference_id);
    if (!ref) return null;
    return {
      fn: 'pro_link',
      args: {
        p_subscription: String(o.subscription),
        p_app: ref.app,
        p_key_hash: keyHash(ref.key),
        p_customer: o.customer ? String(o.customer) : null,
        p_livemode: !!event.livemode,
        p_paid: o.payment_status === 'paid' || o.payment_status === 'no_payment_required',
      },
    };
  }
  if (/^customer\.subscription\.(created|updated|deleted)$/.test(event.type)) {
    const app = o.metadata && o.metadata.app;
    if (!isApp(app)) return null;
    const item = o.items && o.items.data && o.items.data[0];
    const periodEnd = o.current_period_end || (item && item.current_period_end);
    return {
      fn: 'pro_set_status',
      args: {
        p_subscription: String(o.id),
        p_app: app,
        p_customer: o.customer ? String(o.customer) : null,
        p_status: event.type === 'customer.subscription.deleted' ? 'canceled' : String(o.status),
        p_period_end: iso(periodEnd),
        p_cancel_at_period_end: !!o.cancel_at_period_end,
        p_event_at: iso(event.created) || new Date().toISOString(),
        p_livemode: !!event.livemode,
      },
    };
  }
  return null;
}

/** From the key's subscription rows: is it Pro, and until when? */
function verdict(rows, livemode, now = Date.now()) {
  const live = (rows || []).filter((r) => !!r.livemode === !!livemode);
  const good = live.filter((r) => PRO_STATUSES.includes(r.status) && (!r.current_period_end || Date.parse(r.current_period_end) + 3 * 86_400_000 > now));
  if (!good.length) return { pro: false, status: live.length ? live[0].status || 'pending' : 'none', until: null };
  const best = good.sort((a, b) => Date.parse(b.current_period_end || 0) - Date.parse(a.current_period_end || 0))[0];
  return { pro: true, status: best.status, until: best.current_period_end || null, cancels: !!best.cancel_at_period_end };
}

async function rpc(fn, args, env = process.env) {
  const url = env.SUPABASE_URL;
  const key = env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error('store not configured');
  const r = await fetch(`${url}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  if (!r.ok) throw new Error(`${fn} ${r.status}`);
}

async function rowsFor(app, key, env = process.env) {
  const url = env.SUPABASE_URL;
  const sk = env.SUPABASE_SECRET_KEY;
  if (!url || !sk) throw new Error('store not configured');
  const q = `select=status,current_period_end,cancel_at_period_end,livemode&app=eq.${encodeURIComponent(app)}&key_hash=eq.${keyHash(key)}`;
  const r = await fetch(`${url}/rest/v1/pro_subscriptions?${q}`, { headers: { apikey: sk, Authorization: `Bearer ${sk}` } });
  if (!r.ok) throw new Error(`select pro_subscriptions ${r.status}`);
  return r.json();
}

function send(res, status, obj) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(obj));
}

module.exports = { APPS, KEY_RE, isApp, keyHash, linkEnv, checkoutUrl, parseReference, verifyEvent, planEvent, verdict, rpc, rowsFor, send };
