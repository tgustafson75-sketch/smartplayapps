// Serves /media/private (listing) and its files from private-media/.
// Reached only through the rewrites in vercel.json. Re-checks the cookie itself,
// so it is safe even if someone calls /api/media-private directly.
const fs = require('fs');
const path = require('path');
const { isAuthed } = require('../lib/media-auth.js');

// Whitelist: only these files can ever be served. Names are fixed, no path input.
const FILES = {
  'class-deck.pdf': { type: 'application/pdf', name: 'SmartPlay-AI-101-class-deck.pdf' },
  'the-work-curve.png': { type: 'image/png', name: 'the-work-curve.png' },
  'every-rule-was-paid-for.png': { type: 'image/png', name: 'every-rule-was-paid-for.png' },
  'how-the-checks-stacked-up.png': { type: 'image/png', name: 'how-the-checks-stacked-up.png' },
  'how-tim-uses-ai.png': { type: 'image/png', name: 'how-tim-uses-ai.png' },
};

const GRAPHICS = [
  { file: 'the-work-curve.png', title: 'The work curve' },
  { file: 'every-rule-was-paid-for.png', title: 'Every rule was paid for' },
  { file: 'how-the-checks-stacked-up.png', title: 'How the checks stacked up' },
  { file: 'how-tim-uses-ai.png', title: 'How Tim Uses AI' },
];

function listingPage() {
  const graphics = GRAPHICS.map(
    (g) => `
      <figure>
        <a href="/media/private/${g.file}" target="_blank" rel="noopener"><img src="/media/private/${g.file}" alt="${g.title}" loading="lazy"></a>
        <figcaption>${g.title}</figcaption>
        <div class="row"><a class="btn ghost" href="/media/private/${g.file}" target="_blank" rel="noopener">View</a><a class="btn primary" href="/media/private/${g.file}/download">Download</a></div>
      </figure>`
  ).join('');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Private media | SmartPlay AI</title>
<meta name="robots" content="noindex, nofollow">
<meta name="theme-color" content="#0A0F1F">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Sora:wght@200;400;600&family=Inter:wght@400;500&family=JetBrains+Mono:wght@400&display=swap">
<style>
:root{--navy:#0A0F1F;--surface:#0D1327;--rule:#1E254A;--rule-soft:#161C39;--cobalt:#2563FF;--cobalt-hi:#6B93FF;--violet-hi:#A78BFA;--silver:#D1D5DB;--silver-dim:#8891A8;--off:#FAFAFC}
*{box-sizing:border-box}
body{margin:0;background:var(--navy);color:var(--off);font-family:Inter,system-ui,-apple-system,"Segoe UI",sans-serif;font-size:16px;line-height:1.6;padding:0 16px}
h1,h2{font-family:Sora,Inter,system-ui,sans-serif;font-weight:600;margin:0;letter-spacing:-.02em}
a{color:var(--cobalt-hi)}
.wrap{max-width:1120px;margin:0 auto}
header{padding-block:2rem 1rem;border-bottom:1px solid var(--rule-soft)}
.wordmark{font-family:Sora;font-weight:200;letter-spacing:.22em;font-size:.92rem}
.wordmark b{font-weight:200;color:var(--cobalt)}
.eyebrow{font-family:"JetBrains Mono",ui-monospace,monospace;font-size:.68rem;letter-spacing:.2em;text-transform:uppercase;color:var(--silver-dim);margin-top:1.4rem}
h1{font-size:clamp(2rem,6vw,3rem);margin-top:.6rem;line-height:1.1}
p{color:var(--silver)}
section{padding-block:2.5rem;border-top:1px solid var(--rule-soft)}
.grid{display:grid;gap:1.2rem;grid-template-columns:1fr}
@media(min-width:760px){.grid{grid-template-columns:repeat(2,1fr)}}
.panel{background:var(--surface);border:1px solid var(--rule-soft);border-radius:12px;padding:1.2rem;display:flex;flex-direction:column;gap:.7rem}
.panel h2{font-size:1.15rem}
.panel p{color:var(--silver-dim);font-size:.92rem;margin:0}
figure{margin:0;background:var(--surface);border:1px solid var(--rule-soft);border-radius:12px;padding:1rem;display:flex;flex-direction:column;gap:.7rem}
figure img{width:100%;height:auto;border-radius:8px;display:block}
figcaption{color:var(--silver-dim);font-size:.9rem}
.gfx{display:grid;gap:1.2rem;grid-template-columns:1fr}
@media(min-width:760px){.gfx{grid-template-columns:repeat(2,1fr)}}
.row{display:flex;flex-wrap:wrap;gap:.6rem}
.btn{display:inline-flex;align-items:center;text-decoration:none;padding:.55rem 1.1rem;border-radius:100px;font-size:.88rem;font-weight:500}
.btn.primary{background:var(--cobalt);color:#fff}
.btn.ghost{border:1px solid var(--rule);color:var(--off)}
.note{font-family:"JetBrains Mono",monospace;font-size:.7rem;letter-spacing:.14em;text-transform:uppercase;color:var(--silver-dim)}
footer{border-top:1px solid var(--rule-soft);padding-block:2rem;color:var(--silver-dim);font-size:.86rem}
footer a{color:var(--silver)}
</style>
</head>
<body>
<div class="wrap">
<header>
  <a href="/media" style="text-decoration:none"><span class="wordmark">SMARTPLAY <b>AI</b></span></a>
  <div class="eyebrow">Media · Private</div>
  <h1>Class materials and build graphics</h1>
  <p style="margin-top:.6rem">Shared for the AI 101 class and the build story. Please do not redistribute.</p>
</header>

<section>
  <div class="grid">
    <div class="panel">
      <span class="note">Class deck</span>
      <h2>AI 101: Shotgun Style</h2>
      <p>The full class deck as a PDF.</p>
      <div class="row"><a class="btn primary" href="/media/private/class-deck.pdf/download">Download PDF</a><a class="btn ghost" href="/media/private/class-deck.pdf" target="_blank" rel="noopener">View PDF</a></div>
    </div>
    <div class="panel">
      <span class="note">Videos</span>
      <h2>Build story and commercial</h2>
      <p>The build story and the SmartPlay AI commercial, on the public media page.</p>
      <div class="row"><a class="btn ghost" href="/media#start">Build story</a><a class="btn ghost" href="/media#start">Commercial</a></div>
    </div>
  </div>
</section>

<section>
  <h2 style="margin-bottom:1.2rem">Graphics</h2>
  <div class="gfx">${graphics}
  </div>
</section>

<footer>
  <div><a href="/media">Back to Media</a> · <a href="/">smartplayapps.com</a></div>
  <div style="margin-top:.5rem">SmartPlay AI · Veteran Owned and Developed</div>
</footer>
</div>
</body>
</html>`;
}

module.exports = function mediaPrivate(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');

  if (!isAuthed(req)) {
    res.writeHead(302, { Location: '/media/access', 'Cache-Control': 'no-store' });
    return res.end();
  }

  const url = new URL(req.url, 'https://www.smartplayapps.com');
  const file = url.searchParams.get('f') || '';

  if (!file) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.statusCode = 200;
    return res.end(listingPage());
  }

  const meta = FILES[file];
  if (!meta) {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.end('Not found');
  }

  let data;
  try {
    data = fs.readFileSync(path.join(__dirname, '..', 'private-media', file));
  } catch (e) {
    res.statusCode = 500;
    return res.end('Unavailable');
  }

  const download = url.searchParams.get('dl') === '1';
  res.setHeader('Content-Type', meta.type);
  res.setHeader('Content-Disposition', `${download ? 'attachment' : 'inline'}; filename="${meta.name}"`);
  res.statusCode = 200;
  return res.end(data);
};
