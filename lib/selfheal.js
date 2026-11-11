// SmartPlay Self-Heal Standard v1 (smartplay-gate docs/SELF-HEAL-STANDARD.md), server half.
// Same pattern as SmartManage (src/server/report.ts) and SmartPlay Studio (/api/report): a plain
// Sentry envelope POST, no SDK. Goes to Sentry when SENTRY_DSN is set in Vercel; until then the
// Vercel function log is the record. No personal data: no IP, email, query string or page text.

const APP = 'smartplayapps-web';
// `||` not `??`: Vercel's env vars are present-but-empty outside a deployment.
const BUILD = (process.env.VERCEL_GIT_COMMIT_SHA || '').slice(0, 7) || 'local';
const ENV = process.env.VERCEL_ENV || 'local';

function parseDsn(dsn) {
  const m = String(dsn || '').trim().match(/^https:\/\/([^@]+)@([^/]+)\/(\d+)$/);
  return m ? { key: m[1], host: m[2], project: m[3] } : null;
}

// Strip things that look like personal data before a message leaves the server.
function scrub(text) {
  return String(text || '')
    .replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g, '[email]')
    .replace(/\+?\d[\d\s().-]{7,}\d/g, '[number]')
    .slice(0, 500);
}

/** Send one report. Never throws. Returns where it went: 'sentry' or 'log'. */
async function report(kind, message, path) {
  const text = `${kind}: ${scrub(message)}`;
  const dsn = parseDsn(process.env.SENTRY_DSN);
  if (dsn) {
    try {
      const eventId = require('crypto').randomUUID().replace(/-/g, '');
      const event = {
        event_id: eventId,
        timestamp: Date.now() / 1000,
        level: kind === 'user_report' ? 'warning' : 'error',
        platform: 'javascript',
        release: `${APP}@${BUILD}`,
        environment: ENV,
        message: { formatted: text },
        // Same problem twice = one Sentry issue with a count.
        fingerprint: [kind, scrub(message).slice(0, 80)],
        tags: { app: APP, version: BUILD, build: BUILD, platform: 'web', kind, page: path || 'unknown' },
      };
      const envelope = `${JSON.stringify({ event_id: eventId, sent_at: new Date().toISOString() })}\n${JSON.stringify({ type: 'event' })}\n${JSON.stringify(event)}`;
      const res = await fetch(`https://${dsn.host}/api/${dsn.project}/envelope/?sentry_key=${dsn.key}&sentry_version=7`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-sentry-envelope' },
        body: envelope,
      });
      if (res.ok) return 'sentry';
    } catch { /* fall through to the log */ }
  }
  console.error(`[self-heal ${APP}@${BUILD}] ${text} (${path || 'unknown'})`);
  return 'log';
}

/** v1 startup health check: the config the site's server features need. Names, never values. */
function healthProblems(env) {
  const need = {
    SUPABASE_URL: 'contact and waitlist form',
    SUPABASE_SECRET_KEY: 'contact and waitlist form',
    MEDIA_ACCESS_CODE: 'private media',
    MEDIA_COOKIE_SECRET: 'private media',
    SENTRY_DSN: 'error reporting',
  };
  return Object.keys(need).filter((k) => !env[k]).map((k) => `${k} missing (${need[k]})`);
}

module.exports = { APP, BUILD, report, healthProblems, scrub };
