// GET /api/pro/manage -> 302 to Stripe's customer page (env PRO_PORTAL_URL), where people sign in by email to
// cancel or change their card. One link for every app; the env var differs between test (previews) and live.
module.exports = function proManage(req, res) {
  const to = process.env.PRO_PORTAL_URL;
  res.setHeader('Cache-Control', 'no-store');
  if (!to || !/^https:\/\/billing\.stripe\.com\//.test(to)) {
    res.statusCode = 503;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.end('Subscription management is not open yet. Email tim@smartplayapps.com and we will help.');
  }
  res.statusCode = 302;
  res.setHeader('Location', to);
  res.end();
};
