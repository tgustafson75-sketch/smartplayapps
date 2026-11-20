// POST /api/pro/webhook: Stripe tells us about Pro purchases and subscription changes. The signature
// (STRIPE_WEBHOOK_SECRET) is checked against the raw body before anything is read. Only checkout.session.completed
// and customer.subscription.created/updated/deleted are acted on; everything else gets 200 and is ignored.
// A 500 makes Stripe retry, so a store outage loses nothing. See lib/pro.js.
const P = require('../../lib/pro.js');

function rawBody(req, limit = 512 * 1024) {
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

async function proWebhook(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return P.send(res, 405, { message: 'Method not allowed' });
  }
  let event;
  try {
    event = P.verifyEvent(await rawBody(req), req.headers['stripe-signature'], process.env.STRIPE_WEBHOOK_SECRET);
  } catch (e) {
    console.error('[pro webhook] rejected:', e && e.message);
    return P.send(res, 400, { message: 'Bad signature' });
  }
  const plan = P.planEvent(event);
  if (!plan) return P.send(res, 200, { received: true, ignored: event.type });
  try {
    await P.rpc(plan.fn, plan.args);
  } catch (e) {
    console.error('[pro webhook] store:', e && e.message);
    return P.send(res, 500, { message: 'Store unavailable' });
  }
  return P.send(res, 200, { received: true });
}

module.exports = proWebhook;
// Stripe signs the exact bytes it sent, so Vercel must not parse the body first.
module.exports.config = { api: { bodyParser: false } };
