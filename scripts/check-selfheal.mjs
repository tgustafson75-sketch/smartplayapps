// Self-Heal v1 page check: every page served by this site must load /js/selfheal.js and carry the
// "Report a problem" link in its footer. Pages = every .html file plus every api/*.js that renders
// a <footer> (the private media listing). Exits 1 naming each failing page; exits 2 if it finds no
// pages at all, so a moved folder cannot turn this green by checking nothing.
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const SKIP = new Set(['.git', 'node_modules', '.vercel', 'private-media']);

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const files = walk(ROOT);
const pages = files.filter((f) => f.endsWith('.html') ||
  (relative(ROOT, f).startsWith('api/') && f.endsWith('.js') && readFileSync(f, 'utf8').includes('<footer')));

if (pages.length === 0) {
  console.error('check-selfheal: found no pages to check');
  process.exit(2);
}

const problems = [];
for (const required of ['js/selfheal.js', 'api/report.js', 'api/health.js', 'lib/selfheal.js']) {
  if (!existsSync(join(ROOT, required))) problems.push(`${required} is missing`);
}
for (const f of pages) {
  const s = readFileSync(f, 'utf8');
  const name = relative(ROOT, f);
  if (!s.includes('<script defer src="/js/selfheal.js"></script>')) problems.push(`${name}: no /js/selfheal.js script`);
  const f0 = s.indexOf('<footer');
  const footer = f0 === -1 ? '' : s.slice(f0, s.indexOf('</footer>', f0));
  if (!footer) problems.push(`${name}: no <footer>`);
  else if (!/<a href="#" data-report-problem>Report a problem<\/a>/.test(footer)) problems.push(`${name}: no Report a problem link in the footer`);
}

if (problems.length) {
  console.error(`check-selfheal: FAIL (${problems.length})\n  ${problems.join('\n  ')}`);
  process.exit(1);
}
console.log(`check-selfheal: PASS (${pages.length} pages)`);
