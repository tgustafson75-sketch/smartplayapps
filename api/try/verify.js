// POST /api/try/verify {code, app} -> {status: valid | expired | wrong_app | not_found}. Called cross-origin by
// SmartMotion and SmartBay (lib/try.js ALLOWED_ORIGINS). The first valid check stamps redeemed_at.
// Owner bypass: {app, owner: {email, passphrase}} -> {status: owner | not_owner}. Asked of SmartPlay Caddie's
// /api/owner-verify server to server (sha256(email::passphrase) vs OWNER_IDENTITY_HASH, throttled there), so the
// owner identity has one home and no secret is copied. An email alone never passes.
const T = require('../../lib/try.js');

module.exports = async function tryVerify(req, res) {
  T.cors(req, res);
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS');
    return T.send(res, 405, { message: 'Method not allowed' });
  }
  let d;
  try {
    d = await T.readJson(req);
  } catch {
    return T.send(res, 400, { status: 'not_found' });
  }
  const app = Object.prototype.hasOwnProperty.call(T.APPS, d.app) ? d.app : null;
  if (app && d.owner && typeof d.owner === 'object') {
    const email = typeof d.owner.email === 'string' ? d.owner.email.trim().toLowerCase().slice(0, 200) : '';
    const secret = typeof d.owner.passphrase === 'string' ? d.owner.passphrase.slice(0, 300) : '';
    if (!email || !secret) return T.send(res, 400, { status: 'not_owner' });
    try {
      const r = await fetch(`${process.env.OWNER_VERIFY_URL || 'https://api.smartplaycaddie.com'}/api/owner-verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: email, secret }),
      });
      if (r.status === 429) return T.send(res, 429, { status: 'not_owner', message: 'Too many tries. Wait a minute.' });
      const j = await r.json().catch(() => ({}));
      return T.send(res, 200, { status: j && j.owner === true ? 'owner' : 'not_owner' });
    } catch (e) {
      console.error('[try owner]', e && e.message);
      return T.send(res, 503, { status: 'not_owner', message: 'Owner check is down for a moment.' });
    }
  }
  const code = T.normalizeCode(d.code);
  if (!app) return T.send(res, 400, { message: 'app must be smartmotion or bay' });
  if (!T.CODE_RE.test(code)) return T.send(res, 200, { status: 'not_found' });
  const client = T.db();
  if (!client) return T.send(res, 503, { message: 'Verification is down for a moment.' });
  try {
    const rows = await client.select('try_codes', `select=code,app,expires_at,redeemed_at&code=eq.${encodeURIComponent(code)}`);
    const row = rows[0] || null;
    const status = T.verdict(row, app);
    if (status === 'valid' && !row.redeemed_at) await client.patch('try_codes', `code=eq.${encodeURIComponent(code)}`, { redeemed_at: new Date().toISOString() });
    return T.send(res, 200, { status, code, expires_at: row && status !== 'wrong_app' ? row.expires_at : null });
  } catch (e) {
    console.error('[try verify]', e && e.message);
    return T.send(res, 503, { message: 'Verification is down for a moment.' });
  }
};
