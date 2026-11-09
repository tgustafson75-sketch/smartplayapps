// POST /api/contact: the one request form (beta access, custom builds, classes, investors, other).
// Saves to Supabase (SmartPlay Academy project, table site_requests) with the server key; the owner reads
// them in the Build Engine owner view. Guards: honeypot field, size limits, 5 requests per IP per hour.
const crypto = require('crypto');

const TOPICS = ['Beta access', 'Build with us', 'Veteran seat', 'Bring a class', 'Investors', 'Store waitlist', 'Other'];
// /build form extras, folded into the message so the table needs no new columns.
const SERVICES = ['Custom app', 'AI in our workflow', 'Consulting', 'Implementation & support', 'Not sure yet'];
const DEALS = ['Client owns the IP', 'Shared IP', 'Flat fee', 'Not sure yet'];
const PRODUCTS = ['SmartBay AI', 'SmartManage', 'SmartPump', 'SmartMotion', 'Gridiron Life', 'Mayor of the Lake', 'Save the AMX', 'Defender', 'SmartPlay Studio', 'Rondo', 'PlaySmart'];

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > 8192) {
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

function send(res, status, message) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ message }));
}

const clip = (v, n) => (typeof v === 'string' ? v.trim().slice(0, n) : '');

module.exports = async function contact(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return send(res, 405, 'Method not allowed');
  }
  let d;
  try {
    d = JSON.parse(await readBody(req));
  } catch {
    return send(res, 400, 'That did not send. Please try again.');
  }
  // Bots fill every field; people never see this one.
  if (clip(d.website, 200)) return send(res, 200, 'Thanks. We will reply by email.');

  const topic = TOPICS.includes(d.topic) ? d.topic : 'Other';
  const product = topic === 'Beta access' && PRODUCTS.includes(d.product) ? d.product : null;
  const name = clip(d.name, 120);
  const email = clip(d.email, 200);
  const service = topic === 'Build with us' && SERVICES.includes(d.service) ? d.service : null;
  const deal = topic === 'Build with us' && DEALS.includes(d.deal) ? d.deal : null;
  const extras = [service && `Service: ${service}`, deal && `Deal: ${deal}`].filter(Boolean).join('\n');
  const body = clip(d.message, 3000);
  const message = extras ? `${extras}${body ? `\n\n${body}` : ''}` : body;
  if (!name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return send(res, 400, 'Please add your name and a valid email.');

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) {
    console.error('[contact] server_config_missing: SUPABASE_URL or SUPABASE_SECRET_KEY');
    return send(res, 503, 'The form is down for a moment. Please try again later.');
  }
  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  const ipHash = crypto.createHash('sha256').update(`smartplayapps:${ip}`).digest('hex');
  const headers = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
  try {
    const since = new Date(Date.now() - 3600 * 1000).toISOString();
    const recent = await fetch(`${url}/rest/v1/site_requests?select=id&ip_hash=eq.${ipHash}&created_at=gt.${encodeURIComponent(since)}`, { headers });
    if (recent.ok && (await recent.json()).length >= 5) return send(res, 429, 'We have your requests. Please wait an hour before sending more.');
    const ins = await fetch(`${url}/rest/v1/site_requests`, {
      method: 'POST',
      headers: { ...headers, Prefer: 'return=minimal' },
      body: JSON.stringify({ topic, product, name, email, message: message || null, ip_hash: ipHash }),
    });
    if (!ins.ok) throw new Error(`insert ${ins.status}`);
    // Email Tim (dormant until POSTMARK_SERVER_TOKEN is set). Never fails the request: it's already saved.
    if (process.env.POSTMARK_SERVER_TOKEN) {
      const subject = `smartplayapps.com: ${topic}${product ? `: ${product}` : ''} from ${name}`;
      await fetch('https://api.postmarkapp.com/email', {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-Postmark-Server-Token': process.env.POSTMARK_SERVER_TOKEN },
        body: JSON.stringify({ From: 'SmartPlay AI <no-reply@smartplayapps.com>', To: process.env.OWNER_EMAIL || 'tim@smartplayapps.com', ReplyTo: email, Subject: subject.slice(0, 200), TextBody: `${name} <${email}>\nTopic: ${topic}${product ? `\nProduct: ${product}` : ''}\n\n${message || '(no message)'}\n\nAll requests: https://build.smartplayapps.com/owner`, MessageStream: 'outbound' }),
      }).catch((e) => console.error('[contact] notify', e && e.message));
    }
    return send(res, 200, product ? `Thanks. Your ${product} beta request is in; we will reply by email.` : 'Thanks. We will reply by email.');
  } catch (e) {
    console.error('[contact]', e && e.message);
    return send(res, 503, 'That did not send. Please try again in a minute.');
  }
};
