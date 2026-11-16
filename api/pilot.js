// POST /api/pilot: the free 90-day store / facility pilot request (smartplayapps.com/pilot).
// Saves to pilot_requests (SmartPlay Academy project) with the server key and tells Tim the same way as
// try codes (site_requests row for the owner view, Postmark when configured). Honeypot + 10 per IP and 3 per email per day (atomic, lib/rate-slot.js).
const T = require('../lib/try.js');
const { takeSlot } = require('../lib/rate-slot.js');

const LABEL = {
  sporting_goods: 'Sporting goods store', sim_facility: 'Sim facility', batting_cage: 'Batting cage', soccer_training: 'Soccer training', other: 'Other',
  bay_golf: 'Bay for golf', smartmotion_store: 'SmartMotion store bay', both: 'Both',
  yes: 'yes', no: 'no', not_sure: 'not sure',
};

module.exports = async function pilot(req, res) {
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
  if (typeof d.website === 'string' && d.website.trim()) return T.send(res, 200, { ok: true, message: 'Thanks. Tim will be in touch.' });
  const p = T.parsePilot(d);
  if (!p.ok) return T.send(res, 400, { message: p.error });
  const v = p.value;
  const client = T.db();
  if (!client) return T.send(res, 503, { message: 'The form is down for a moment. Please email tim@smartplayapps.com.' });
  try {
    // Atomic across instances (lib/rate-slot.js); a store error fails closed into the 503 below.
    const ip_hash = T.ipHash(req);
    if (!(await takeSlot('pilot-ip', ip_hash, 10, 86400))) return T.send(res, 429, { message: 'We have your request. Tim will reply soon.' });
    if (!(await takeSlot('pilot', v.email, 3, 86400))) return T.send(res, 429, { message: 'We have your request. Tim will reply soon.' });
    const ins = await client.insert('pilot_requests', { ...v, ip_hash });
    if (!ins.ok) throw new Error(`insert ${ins.status}`);
    await T.notifyOwner(client, {
      topic: 'Pilot',
      product: LABEL[v.track],
      name: v.contact_name,
      email: v.email,
      message: `${v.business_name} (${LABEL[v.business_type]})${v.city ? `, ${v.city}` : ''}${v.phone ? ` · ${v.phone}` : ''} · space: ${LABEL[v.space_available]}${v.notes ? `\n\n${v.notes}` : ''}`,
      ip_hash,
    });
    return T.send(res, 200, { ok: true, message: 'Thanks. Your pilot request is in. Tim will reply by email.' });
  } catch (e) {
    console.error('[pilot]', e && e.message);
    return T.send(res, 503, { message: 'That did not send. Please try again, or email tim@smartplayapps.com.' });
  }
};
