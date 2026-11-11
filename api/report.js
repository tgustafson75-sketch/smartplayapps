// POST /api/report: browser errors, Report a problem and failed health checks from /selfheal.js.
// Tags every report with the deployed commit (lib/selfheal.js). Anonymous: page path only.
const { report } = require('../lib/selfheal.js');

const KINDS = ['client_error', 'unhandled_rejection', 'user_report', 'health'];

// Public, unauthenticated endpoint: a scripted flood could burn the Sentry quota, so cap it per instance.
// Same window as SmartManage's /api/report (src/app/api/report/route.ts).
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 20;
let windowStart = 0;
let inWindow = 0;

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > 4096) {
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

module.exports = async function reportRoute(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.statusCode = 405;
    return res.end('{"ok":false}');
  }
  const now = Date.now();
  if (now - windowStart > WINDOW_MS) {
    windowStart = now;
    inWindow = 0;
  }
  if (++inWindow > MAX_PER_WINDOW) {
    res.statusCode = 429;
    return res.end('{"ok":false,"error":"slow down"}');
  }
  let d;
  try {
    d = JSON.parse(await readBody(req));
  } catch {
    res.statusCode = 400;
    return res.end('{"ok":false}');
  }
  const kind = KINDS.includes(d && d.kind) ? d.kind : null;
  if (!kind) {
    res.statusCode = 400;
    return res.end('{"ok":false}');
  }
  const path = typeof d.path === 'string' && d.path.startsWith('/') ? d.path.split(/[?#]/)[0].slice(0, 200) : 'unknown';
  const sentTo = await report(kind, typeof d.message === 'string' ? d.message : kind, path);
  res.statusCode = 200;
  return res.end(JSON.stringify({ ok: true, sentTo }));
};
