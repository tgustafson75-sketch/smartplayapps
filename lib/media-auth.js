// Server-side access helpers for the code-protected /media/private section.
// Secrets come only from environment variables (MEDIA_ACCESS_CODE, MEDIA_COOKIE_SECRET).
// Nothing here logs the submitted code or any secret.
const crypto = require('crypto');

const COOKIE_NAME = 'sp_media';
const MAX_AGE_SECONDS = 30 * 24 * 60 * 60; // 30 days

function signExpiry(exp, secret) {
  return crypto.createHmac('sha256', secret).update('media-access:' + exp).digest('hex');
}

// Token format: "<exp-unix-seconds>.<hex HMAC-SHA256>"
function makeToken(secret, nowMs = Date.now()) {
  const exp = Math.floor(nowMs / 1000) + MAX_AGE_SECONDS;
  return exp + '.' + signExpiry(exp, secret);
}

function verifyToken(token, secret) {
  if (!secret || typeof token !== 'string') return false;
  const parts = token.split('.');
  if (parts.length !== 2) return false;
  const exp = Number(parts[0]);
  if (!Number.isInteger(exp) || exp * 1000 <= Date.now()) return false;
  const given = Buffer.from(parts[1], 'hex');
  const expected = Buffer.from(signExpiry(exp, secret), 'hex');
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

function readCookie(req) {
  const header = req.headers.cookie || '';
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > -1 && part.slice(0, i).trim() === COOKIE_NAME) return part.slice(i + 1).trim();
  }
  return '';
}

function sessionCookie(value) {
  return `${COOKIE_NAME}=${value}; Max-Age=${MAX_AGE_SECONDS}; Path=/; HttpOnly; Secure; SameSite=Lax`;
}

function isAuthed(req) {
  return verifyToken(readCookie(req), process.env.MEDIA_COOKIE_SECRET);
}

// Constant-time compare: hash both sides to equal length, then timingSafeEqual.
function codeMatches(submitted) {
  const expected = process.env.MEDIA_ACCESS_CODE;
  if (!expected || typeof submitted !== 'string') return false;
  const a = crypto.createHash('sha256').update(submitted).digest();
  const b = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

module.exports = { makeToken, verifyToken, isAuthed, sessionCookie, codeMatches, COOKIE_NAME };
