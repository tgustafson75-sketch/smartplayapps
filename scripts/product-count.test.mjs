// Product count guard: every product count the site states must equal the number of product cards
// on /products. Adding or removing a card without updating the copy fails this test.
// Run: node --test scripts/product-count.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const SKIP = new Set(['.git', 'node_modules', '.vercel', 'private-media']);

function pages(dir = ROOT, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) pages(p, out);
    else if (e.name.endsWith('.html') || (p.includes('/api/') && e.name.endsWith('.js'))) out.push(p);
  }
  return out;
}

// JSON-LD blocks quote external records (the YouTube intro video's own title and description),
// so they state what that video says, not the site's current count.
const stripJsonLd = (html) => html.replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>/g, '');

// Product cards on /products: every <article class="card ..."> inside a status group.
export function countCards(productsHtml) {
  return (productsHtml.match(/<article class="card[\s"]/g) || []).length;
}

// Each phrasing the site uses to state the product count, and how to read the number from it.
const CLAIMS = [
  { re: /(\d+) apps, tools and games/g, read: (n) => n },
  { re: /See all (\d+) products/g, read: (n) => n },
  { re: /<b>(\d+)<\/b><span>apps, tools and games/g, read: (n) => n },
  { re: /Build Engine and (\d+) More/g, read: (n) => n + 2 }, // "Caddie, Build Engine and N More"
];

// Any other "<number> apps|products" phrase must be listed here with why it is not the product count.
const NOT_THE_PRODUCT_COUNT = [
  /10 apps on the first shelf/, // store.html: the first store shelf, a subset
];

export function checkSite(files /* {path: html} */) {
  const total = countCards(files['products.html']);
  const problems = [];
  const found = [];
  for (const [path, raw] of Object.entries(files)) {
    const html = stripJsonLd(raw);
    const spans = [];
    for (const c of CLAIMS) {
      for (const m of html.matchAll(c.re)) {
        const stated = c.read(Number(m[1]));
        found.push({ path, text: m[0], stated });
        spans.push([m.index, m.index + m[0].length]);
        if (stated !== total) problems.push(`${path}: "${m[0]}" states ${stated}, /products shows ${total} cards`);
      }
    }
    for (const m of html.matchAll(/\b(\d+) (apps|products)\b[^<]{0,40}/g)) {
      if (spans.some(([a, b]) => m.index >= a && m.index < b)) continue;
      if (NOT_THE_PRODUCT_COUNT.some((re) => re.test(m[0]))) continue;
      problems.push(`${path}: unrecognised count "${m[0].trim()}" — add it to CLAIMS or NOT_THE_PRODUCT_COUNT`);
    }
  }
  // Group headers ("Live · 5") must match the cards under them.
  const p = files['products.html'];
  for (const m of p.matchAll(/<div class="status" id="([^"]+)">[^<]*?&middot; (\d+)<\/div>\s*<div class="eco">([\s\S]*?)\n<\/div>/g)) {
    const n = countCards(m[3]);
    if (n !== Number(m[2])) problems.push(`products.html: group "${m[1]}" says ${m[2]}, has ${n} cards`);
  }
  return { total, found, problems };
}

function loadSite() {
  const files = {};
  for (const p of pages()) files[relative(ROOT, p)] = readFileSync(p, 'utf8');
  return files;
}

test('every stated product count equals the cards on /products', () => {
  const { total, found, problems } = checkSite(loadSite());
  assert.ok(total > 0, 'found no product cards on products.html');
  // Guard against a moved or reworded headline turning this green by checking nothing.
  assert.ok(found.some((f) => f.path === 'products.html' && /apps, tools and games/.test(f.text)), 'products.html headline count not found');
  for (const c of CLAIMS) assert.ok(found.some((f) => new RegExp(c.re.source).test(f.text)), `no page uses ${c.re}`);
  assert.deepEqual(problems, []);
});

test('adding a card without updating the count fails', () => {
  const files = loadSite();
  const extra = '<article class="card" style="--accent:#000"><h3>New</h3></article>\n';
  files['products.html'] = files['products.html'].replace(/(<div class="status" id="in-the-lab">[^<]*<\/div>\s*<div class="eco">\n)/, `$1${extra}`);
  const { total, problems } = checkSite(files);
  assert.equal(total, countCards(loadSite()['products.html']) + 1);
  assert.ok(problems.some((p) => p.startsWith('products.html: "') && p.includes('apps, tools and games')), 'headline mismatch not reported');
  assert.ok(problems.some((p) => p.includes('group "in-the-lab"')), 'group count mismatch not reported');
});

test('removing a card without updating the count fails', () => {
  const files = loadSite();
  files['products.html'] = files['products.html'].replace(/<article class="card" style="--accent:#4D8BFF" id="smartshare">[\s\S]*?<\/article>\n/, '');
  const { problems } = checkSite(files);
  assert.ok(problems.length >= 6, `expected every stated count to be flagged, got: ${problems.join(' | ')}`);
});
