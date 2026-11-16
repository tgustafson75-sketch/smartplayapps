// Shared by the public report endpoints (api/report.js, api/defender-report.js): a per-IP limit and a
// small-body reader. A scripted flood could burn the Sentry quota, so each client IP gets a few
// reports a minute; the global cap is the Sentry DSN key rate limit.
//
// The count lives in the shared store (lib/rate-slot.js), one atomic reserve per report, so it holds
// across every serverless instance. Only when the store is unreachable (not configured, or the SQL not
// applied yet) does the per-instance Map stand in, so the Self-Heal relay can still report that outage.
const { takeSlot } = require('./rate-slot.js');

const WINDOW_MS = 60_000;

function makeLimiter(scope, maxPerIp) {
  const seen = new Map(); // ip -> { start, count }
  function localLimited(ip, now) {
    for (const [k, v] of seen) if (now - v.start > WINDOW_MS) seen.delete(k);
    const e = seen.get(ip) || { start: now, count: 0 };
    seen.set(ip, e);
    return ++e.count > maxPerIp;
  }
  return async function limited(req, now) {
    const h = req.headers || {};
    const ip = h['x-real-ip'] || String(h['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
    try {
      return !(await takeSlot(scope, ip, maxPerIp, WINDOW_MS / 1000));
    } catch {
      return localLimited(ip, now);
    }
  };
}

function readBody(req, maxBytes = 4096) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > maxBytes) {
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

module.exports = { makeLimiter, readBody };
