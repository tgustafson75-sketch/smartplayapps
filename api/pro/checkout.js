// GET /api/pro/checkout?app=<app>&key=<pro key> -> 302 to that app's Stripe checkout, tagged with the key.
// Opened by the app in a new tab. Nothing is stored here: the webhook records the purchase. See lib/pro.js.
const P = require('../../lib/pro.js');

module.exports = function proCheckout(req, res) {
  const u = new URL(req.url, 'https://www.smartplayapps.com');
  const app = u.searchParams.get('app') || '';
  const key = (u.searchParams.get('key') || '').toLowerCase();
  const to = P.checkoutUrl(app, key);
  res.setHeader('Cache-Control', 'no-store');
  if (!to) {
    res.statusCode = P.isApp(app) && P.KEY_RE.test(key) ? 503 : 400;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.end(res.statusCode === 503 ? 'Checkout is not open for this app yet.' : 'This checkout link is missing its app or key. Open it again from the app.');
  }
  res.statusCode = 302;
  res.setHeader('Location', to);
  res.end();
};
