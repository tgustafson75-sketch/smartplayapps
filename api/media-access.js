// POST /api/media-access: checks the access code and sets the signed session cookie.
const { makeToken, codeMatches, sessionCookie } = require('../lib/media-auth.js');

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

module.exports = async function mediaAccess(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.statusCode = 405;
    return res.end('Method not allowed');
  }

  const secret = process.env.MEDIA_COOKIE_SECRET;
  if (!process.env.MEDIA_ACCESS_CODE || !secret) {
    res.statusCode = 503;
    return res.end('Private media access is not configured yet.');
  }

  let body = '';
  try {
    body = await readBody(req);
  } catch (e) {
    res.statusCode = 413;
    return res.end('Request too large');
  }

  const code = new URLSearchParams(body).get('code') || '';
  if (!codeMatches(code)) {
    res.writeHead(303, { Location: '/media/access?miss=1' });
    return res.end();
  }

  res.writeHead(303, {
    Location: '/media/private',
    'Set-Cookie': sessionCookie(makeToken(secret)),
  });
  return res.end();
};
