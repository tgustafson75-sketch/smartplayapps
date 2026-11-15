// Shared by the public report endpoints (api/report.js, api/defender-report.js): a per-IP limit and a
// small-body reader. A scripted flood could burn the Sentry quota, so each client IP gets a few
// reports a minute; the global cap is the Sentry DSN key rate limit.
const WINDOW_MS = 60_000;

function makeLimiter(maxPerIp) {
  const seen = new Map(); // ip -> { start, count }
  return function limited(req, now) {
    const h = req.headers || {};
    const ip = h['x-real-ip'] || String(h['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
    for (const [k, v] of seen) if (now - v.start > WINDOW_MS) seen.delete(k);
    const e = seen.get(ip) || { start: now, count: 0 };
    seen.set(ip, e);
    return ++e.count > maxPerIp;
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
