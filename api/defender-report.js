// POST /api/defender-report: the report relay for SmartPlay Defender (smartplay-cybersecurity
// src/extension/selfheal.ts). The extension never holds a Sentry key; it posts here and this relay
// forwards to the defender-extension Sentry project. Anonymous: no URLs, hosts, emails or paths are
// accepted, and every text field is scrubbed again here.
//
// Answers only Chrome extensions (CORS), so Defender needs no new host permission: adding one would
// make Chrome disable it for every user until they accept a warning.
const { parseDsn, scrub } = require('../lib/selfheal.js');
const { makeLimiter, readBody } = require('../lib/relay-http.js');

// Public key of the defender-extension Sentry project (a DSN key can only send events). SENTRY_DSN_DEFENDER overrides it.
const DEFENDER_DSN = 'https://106113ed0e3a496b4af44d2bd6ba2383@o4511297513717760.ingest.us.sentry.io/4512420175544320';
const KINDS = ['sw_error', 'unhandled_rejection', 'page_error', 'message_error', 'startup_check', 'user_report'];
const LEVELS = ['error', 'warning', 'info'];
const EXTENSION_ORIGIN = /^chrome-extension:\/\/[a-p]{32}$/;
const limited = makeLimiter(5);

// Defender's own scrub misses nothing on purpose; this one is the second lock: links, hosts, paths.
function clean(text, max = 300) {
  return scrub(String(text || ''))
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/\S+/gi, '[link]')
    .replace(/\b(?:[a-z0-9-]+\.)+(?:com|net|org|edu|gov|mil|io|ai|app|dev|co|us|uk|ca|de|fr|info|biz|me|xyz|health|bank)\b/gi, '[host]')
    .replace(/(?:\/[\w.-]+){2,}/g, '[path]')
    .slice(0, max);
}

const list = (a, n, max) => (Array.isArray(a) ? a.slice(0, n).map((x) => clean(x, max)) : []);

/** The Sentry event for one Defender report, or null when the report is not one Defender sends. */
function defenderEvent(d, now = Date.now()) {
  if (!d || d.app !== 'defender' || d.platform !== 'chrome-extension') return null;
  if (!KINDS.includes(d.kind) || !LEVELS.includes(d.level)) return null;
  if (typeof d.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(d.version)) return null;
  const build = typeof d.build === 'string' && /^[\w.-]{1,40}$/.test(d.build) ? d.build : undefined;
  const environment = d.environment === 'lab' ? 'lab' : 'production';
  const extra = {};
  const x = d.extra && typeof d.extra === 'object' ? d.extra : {};
  if (Array.isArray(x.lastErrors)) {
    extra.lastErrors = x.lastErrors.slice(0, 10).map((e) => ({
      kind: KINDS.includes(e && e.kind) ? e.kind : 'unknown',
      message: clean(e && e.message, 200),
      at: typeof (e && e.at) === 'string' && !Number.isNaN(Date.parse(e.at)) ? new Date(Date.parse(e.at)).toISOString() : null,
    }));
  }
  if (x.health && typeof x.health === 'object') {
    extra.health = { ok: x.health.ok === true, problems: list(x.health.problems, 10, 160), warnings: list(x.health.warnings, 10, 160) };
  }
  const message = clean(d.message);
  return {
    event_id: require('crypto').randomUUID().replace(/-/g, ''),
    timestamp: now / 1000,
    level: d.level === 'info' ? 'info' : d.level,
    platform: 'javascript',
    release: `defender@${d.version}${build ? `+${build}` : ''}`,
    environment,
    message: { formatted: `${d.kind}: ${message}` },
    fingerprint: [d.kind, message.slice(0, 80)],
    tags: { app: 'defender', version: d.version, build: build || 'none', platform: 'chrome-extension', kind: d.kind },
    extra,
  };
}

async function forward(event) {
  const dsn = parseDsn(process.env.SENTRY_DSN_DEFENDER || DEFENDER_DSN);
  if (!dsn) return 'log';
  try {
    const envelope = `${JSON.stringify({ event_id: event.event_id, sent_at: new Date().toISOString() })}\n${JSON.stringify({ type: 'event' })}\n${JSON.stringify(event)}`;
    const res = await fetch(`https://${dsn.host}/api/${dsn.project}/envelope/?sentry_key=${dsn.key}&sentry_version=7`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-sentry-envelope' },
      body: envelope,
    });
    if (res.ok) return 'sentry';
  } catch { /* fall through to the log */ }
  console.error(`[defender relay] ${event.message.formatted}`);
  return 'log';
}

module.exports = async function defenderReport(req, res) {
  const origin = (req.headers && req.headers.origin) || '';
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Vary', 'Origin');
  if (EXTENSION_ORIGIN.test(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Max-Age', '86400');
  }
  if (req.method === 'OPTIONS') {
    res.statusCode = EXTENSION_ORIGIN.test(origin) ? 204 : 403;
    return res.end();
  }
  res.setHeader('Content-Type', 'application/json');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS');
    res.statusCode = 405;
    return res.end('{"ok":false}');
  }
  if (!EXTENSION_ORIGIN.test(origin)) {
    res.statusCode = 403;
    return res.end('{"ok":false}');
  }
  if (limited(req, Date.now())) {
    res.statusCode = 429;
    return res.end('{"ok":false,"error":"slow down"}');
  }
  let event = null;
  try {
    event = defenderEvent(JSON.parse(await readBody(req, 8192)));
  } catch { /* bad JSON or too large */ }
  if (!event) {
    res.statusCode = 400;
    return res.end('{"ok":false}');
  }
  const sentTo = await forward(event);
  res.statusCode = 200;
  return res.end(JSON.stringify({ ok: true, sentTo }));
};
module.exports.defenderEvent = defenderEvent;
