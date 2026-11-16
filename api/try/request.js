// POST /api/try/request: a free 30-day try code for SmartMotion or SmartBay (shared system, lib/try.js).
// Guards: honeypot field, 10 requests per IP per day, 3 per email per day (both atomic, lib/rate-slot.js). The code is shown on screen; email delivery is not
// wired (no live transport on this site yet), so the response says so honestly.
const T = require('../../lib/try.js');
const { takeSlot } = require('../../lib/rate-slot.js');

module.exports = async function tryRequest(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return T.send(res, 405, { message: 'Method not allowed' });
  }
  let d;
  try {
    d = await T.readJson(req);
  } catch {
    return T.send(res, 400, { message: 'That did not send. Please try again.' });
  }
  // Bots fill every field; people never see this one. Answer like a success, store nothing.
  if (typeof d.website === 'string' && d.website.trim()) return T.send(res, 200, { ok: true, code: null, message: 'Thanks. We will be in touch.' });

  const p = T.parseTryRequest(d);
  if (!p.ok) return T.send(res, 400, { message: p.error });
  const v = p.value;
  const client = T.db();
  if (!client) {
    console.error('[try] server_config_missing: SUPABASE_URL or SUPABASE_SECRET_KEY');
    return T.send(res, 503, { message: 'Codes are down for a moment. Please try again later.' });
  }
  try {
    // Atomic across instances (lib/rate-slot.js); a store error fails closed into the 503 below.
    // Per IP first, so a run of fresh emails from one sender stops at 10 a day.
    if (!(await takeSlot('try-ip', T.ipHash(req), T.PER_IP_PER_DAY, 86400))) return T.send(res, 429, { message: 'Too many code requests today. Please try again tomorrow.' });
    if (!(await takeSlot('try', v.email, T.PER_EMAIL_PER_DAY, 86400))) return T.send(res, 429, { message: 'That email has asked for 3 codes today. Please try again tomorrow.' });

    let code = null;
    let row = null;
    for (let i = 0; i < 6 && !code; i++) {
      const c = T.makeCode(v.app);
      const created = new Date();
      const r = { code: c, ...v, created_at: created.toISOString(), expires_at: new Date(created.getTime() + 30 * 86400000).toISOString() };
      const ins = await client.insert('try_codes', r);
      if (ins.ok) { code = c; row = r; }
      else if (ins.status !== 409) throw new Error(`insert ${ins.status}`);
    }
    if (!code) throw new Error('no free code after 6 tries');

    await T.notifyOwner(client, {
      topic: 'Try code',
      product: T.APPS[v.app].label,
      name: v.name,
      email: v.email,
      message: `Code ${code} · use: ${v.use_case} · veteran: ${v.is_veteran ? 'yes' : 'no'}${v.source ? ` · from: ${v.source}` : ''}`,
      ip_hash: T.ipHash(req),
    });
    return T.send(res, 200, { ok: true, code, app: v.app, expires_at: row.expires_at, emailed: false });
  } catch (e) {
    console.error('[try]', e && e.message);
    return T.send(res, 503, { message: 'That did not send. Please try again in a minute.' });
  }
};
