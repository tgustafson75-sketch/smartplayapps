// SmartBay claims guard: the site may only say what the records show about SmartBay AI.
// Until the cage test passes (SmartManage cage-test tasks, project "bay"), no page may claim
// SmartBay runs at a facility or teaches with no staff, and every SmartBay chip uses one label.
// When the cage test passes and Tim approves new wording, update UNPROVEN below.
// Run: node --test scripts/bay-claims.test.mjs
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
    else if (e.name.endsWith('.html')) out.push(p);
  }
  return out;
}

const UNPROVEN = [
  /no staff/i,
  /without an instructor/i,
  /partner (indoor golf )?facility/i,
  /running at a partner/i,
  /around the clock/i,
  /SmartBay AI running AI golf lessons/i,
];

test('no page makes an unproven SmartBay claim', () => {
  const hits = [];
  for (const p of pages()) {
    readFileSync(p, 'utf8').split('\n').forEach((line, i) => {
      for (const re of UNPROVEN) if (re.test(line)) hits.push(`${relative(ROOT, p)}:${i + 1} ${re}`);
    });
  }
  assert.deepEqual(hits, []);
});

test('every SmartBay AI card uses the same label', () => {
  const labels = new Map();
  const re = /<h3[^>]*>SmartBay AI<\/h3>[\s\S]{0,200}?<span class="(?:chip|tag)[^"]*">([^<]+)<\/span>|<span class="(?:chip|tag)[^"]*">([^<]+)<\/span><h3[^>]*>SmartBay AI<\/h3>/g;
  for (const p of pages()) {
    for (const m of readFileSync(p, 'utf8').matchAll(re)) {
      const label = (m[1] || m[2]).trim();
      labels.set(label, [...(labels.get(label) || []), relative(ROOT, p)]);
    }
  }
  assert.ok(labels.size > 0, 'found no SmartBay AI cards');
  assert.equal(labels.size, 1, `SmartBay AI labels differ: ${JSON.stringify(Object.fromEntries(labels))}`);
});
