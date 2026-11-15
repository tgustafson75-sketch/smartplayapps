// Shared try codes for SmartMotion and SmartBay, and the /pilot request form.
// ONE system for both apps: the codes live in the SmartPlay Academy Supabase project (tables try_codes and
// pilot_requests, RLS on, no grants to anon), written and read only here with the server key. The apps
// call POST /api/try/verify cross-origin; nothing else holds a key. Tim is told about each request the
// same way as every other site form: a site_requests row, which his Build Engine owner view lists, plus
// the dormant Postmark email in api/contact.js once POSTMARK_SERVER_TOKEN is set.
const crypto = require('crypto');

const APPS = { smartmotion: { prefix: 'SM', label: 'SmartMotion' }, bay: { prefix: 'BAY', label: 'SmartBay AI' } };
const USE_CASES = ['home', 'store', 'facility', 'coach', 'other'];
const BUSINESS_TYPES = ['sporting_goods', 'sim_facility', 'batting_cage', 'soccer_training', 'other'];
const TRACKS = ['bay_golf', 'smartmotion_store', 'both'];
const SPACE = ['yes', 'no', 'not_sure'];
// No look-alikes: no 0/O, 1/I/L, 5/S, 2/Z, 8/B.
const ALPHABET = '34679ACDEFGHJKMNPQRTUVWXY';
const CODE_LEN = 4;
const PER_EMAIL_PER_DAY = 3;
const CODE_RE = /^(SM|BAY)-[34679ACDEFGHJKMNPQRTUVWXY]{4}$/;

// Origins allowed to call verify from the browser.
const ALLOWED_ORIGINS = [
  'https://smartmotionai.vercel.app',
  'https://smartbayai.com',
  'https://www.smartbayai.com',
  'https://smartbay-ai.vercel.app',
  'https://smartplayapps.com',
  'https://www.smartplayapps.com',
];

function makeCode(app, rand = crypto.randomInt) {
  let s = '';
  for (let i = 0; i < CODE_LEN; i++) s += ALPHABET[rand(ALPHABET.length)];
  return `${APPS[app].prefix}-${s}`;
}

function normalizeCode(v) {
  return String(v || '').trim().toUpperCase().replace(/\s+/g, '').replace(/^(SM|BAY)(?=[^-])/, '$1-');
}

const clip = (v, n) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
const isEmail = (e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e);

/** Validate a try-code request body. Returns { ok, value } or { ok:false, error }. */
function parseTryRequest(d) {
  const app = Object.prototype.hasOwnProperty.call(APPS, d.app) ? d.app : null;
  const name = clip(d.name, 120);
  const email = clip(d.email, 200).toLowerCase();
  const use_case = USE_CASES.includes(d.use_case) ? d.use_case : null;
  const is_veteran = d.is_veteran === true || d.is_veteran === 'yes' || d.is_veteran === 'true';
  if (!app) return { ok: false, error: 'Pick SmartMotion or SmartBay.' };
  if (!name || !isEmail(email)) return { ok: false, error: 'Please add your name and a valid email.' };
  if (!use_case) return { ok: false, error: 'Tell us how you will use it.' };
  const source = clip(d.source, 60) || null;
  return { ok: true, value: { app, name, email, use_case, is_veteran, source } };
}

function parsePilot(d) {
  const v = {
    business_name: clip(d.business_name, 160),
    contact_name: clip(d.contact_name, 120),
    email: clip(d.email, 200).toLowerCase(),
    phone: clip(d.phone, 40) || null,
    city: clip(d.city, 120) || null,
    business_type: BUSINESS_TYPES.includes(d.business_type) ? d.business_type : null,
    track: TRACKS.includes(d.track) ? d.track : null,
    space_available: SPACE.includes(d.space_available) ? d.space_available : null,
    notes: clip(d.notes, 3000) || null,
  };
  if (!v.business_name || !v.contact_name || !isEmail(v.email)) return { ok: false, error: 'Please add the business, your name and a valid email.' };
  if (!v.business_type || !v.track || !v.space_available) return { ok: false, error: 'Please answer the three choices.' };
  return { ok: true, value: v };
}

/** valid / expired / wrong_app / not_found, from a stored row (or null). */
function verdict(row, app, now = Date.now()) {
  if (!row) return 'not_found';
  if (row.app !== app) return 'wrong_app';
  if (new Date(row.expires_at).getTime() <= now) return 'expired';
  return 'valid';
}

function readBody(req, limit = 8192) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function readJson(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  return JSON.parse((await readBody(req)) || '{}');
}

function send(res, status, obj) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(obj));
}

function cors(req, res) {
  const origin = req.headers.origin;
  if (origin && (ALLOWED_ORIGINS.includes(origin) || /^http:\/\/localhost:\d+$/.test(origin))) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Max-Age', '86400');
  }
}

function db() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) return null;
  const headers = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
  return {
    async select(table, query) {
      const r = await fetch(`${url}/rest/v1/${table}?${query}`, { headers });
      if (!r.ok) throw new Error(`select ${table} ${r.status}`);
      return r.json();
    },
    async insert(table, row) {
      const r = await fetch(`${url}/rest/v1/${table}`, { method: 'POST', headers: { ...headers, Prefer: 'return=minimal' }, body: JSON.stringify(row) });
      return r;
    },
    async patch(table, query, row) {
      const r = await fetch(`${url}/rest/v1/${table}?${query}`, { method: 'PATCH', headers: { ...headers, Prefer: 'return=minimal' }, body: JSON.stringify(row) });
      return r.ok;
    },
  };
}

function ipHash(req) {
  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  return crypto.createHash('sha256').update(`smartplayapps:${ip}`).digest('hex');
}

/** Tell Tim: a site_requests row (owner view) and, when configured, the Postmark email. Never throws. */
async function notifyOwner(client, { topic, product, name, email, message, ip_hash }) {
  try {
    await client.insert('site_requests', { topic, product, name, email, message, ip_hash });
  } catch (e) {
    console.error('[try] owner row', e && e.message);
  }
  if (process.env.POSTMARK_SERVER_TOKEN) {
    await fetch('https://api.postmarkapp.com/email', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-Postmark-Server-Token': process.env.POSTMARK_SERVER_TOKEN },
      body: JSON.stringify({ From: 'SmartPlay AI <no-reply@smartplayapps.com>', To: process.env.OWNER_EMAIL || 'tim@smartplayapps.com', ReplyTo: email, Subject: `smartplayapps.com: ${topic}${product ? `: ${product}` : ''} from ${name}`.slice(0, 200), TextBody: `${name} <${email}>\n${message}\n\nAll requests: https://build.smartplayapps.com/owner`, MessageStream: 'outbound' }),
    }).catch((e) => console.error('[try] notify', e && e.message));
  }
}

module.exports = {
  APPS, USE_CASES, BUSINESS_TYPES, TRACKS, SPACE, ALPHABET, CODE_RE, PER_EMAIL_PER_DAY,
  makeCode, normalizeCode, parseTryRequest, parsePilot, verdict, readJson, send, cors, db, ipHash, notifyOwner,
};
