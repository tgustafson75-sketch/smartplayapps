// Runs on Vercel before static files are served.
// 1. /private-media/* (the source folder for private files) is never served directly.
// 2. /media/private and everything under it needs a valid signed cookie, or it goes to /media/access.
// The cookie check here mirrors lib/media-auth.js (HMAC-SHA256 over "media-access:<exp>").

export const config = {
  matcher: ['/private-media/:path*', '/media/private', '/media/private/:path*'],
};

const enc = new TextEncoder();

function hex(buf) {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function readCookie(header, name) {
  for (const part of (header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > -1 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return '';
}

async function validCookie(header, secret) {
  if (!secret) return false;
  const token = readCookie(header, 'sp_media');
  const parts = token.split('.');
  if (parts.length !== 2) return false;
  const exp = Number(parts[0]);
  if (!Number.isInteger(exp) || exp * 1000 <= Date.now()) return false;
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = hex(await crypto.subtle.sign('HMAC', key, enc.encode('media-access:' + exp)));
  // Compare hex strings in constant time.
  if (sig.length !== parts[1].length) return false;
  let diff = 0;
  for (let i = 0; i < sig.length; i++) diff |= sig.charCodeAt(i) ^ parts[1].charCodeAt(i);
  return diff === 0;
}

export default async function middleware(request) {
  const url = new URL(request.url);
  const noStore = { 'Cache-Control': 'no-store' };

  if (url.pathname.startsWith('/private-media')) {
    return new Response('Not found', { status: 404, headers: noStore });
  }

  const ok = await validCookie(request.headers.get('cookie'), process.env.MEDIA_COOKIE_SECRET);
  if (ok) return; // continue to the rewrite that serves the private section

  return new Response(null, {
    status: 302,
    headers: { ...noStore, Location: new URL('/media/access', request.url).toString() },
  });
}
