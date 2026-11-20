// GET /api/pro/status?app=<app>&key=<pro key> -> { pro, status, until, cancels? }. Called cross-origin by the
// apps (a Chrome extension's origin is chrome-extension://<id>, so any origin may read it; the answer holds no
// personal data, and a key is 128 random bits). Rate limited per IP. See lib/pro.js.
const P = require('../../lib/pro.js');
const { makeLimiter } = require('../../lib/relay-http.js');

const limited = makeLimiter('pro-status', 30);

module.exports = async function proStatus(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET, OPTIONS');
    return P.send(res, 405, { message: 'Method not allowed' });
  }
  const u = new URL(req.url, 'https://www.smartplayapps.com');
  const app = u.searchParams.get('app') || '';
  const key = (u.searchParams.get('key') || '').toLowerCase();
  if (!P.isApp(app) || !P.KEY_RE.test(key)) return P.send(res, 400, { message: 'app and key are required' });
  if (await limited(req, Date.now())) return P.send(res, 429, { message: 'Too many checks. Try again in a minute.' });
  try {
    const rows = await P.rowsFor(app, key);
    return P.send(res, 200, P.verdict(rows, process.env.PRO_LIVEMODE === '1'));
  } catch (e) {
    console.error('[pro status]', e && e.message);
    return P.send(res, 503, { message: 'Pro check is down for a moment.' });
  }
};
