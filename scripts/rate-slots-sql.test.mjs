// supabase/20261115_rate_slots.sql: take_rate_slot must touch only its own bucket (an indexed, bounded
// delete), never sweep the whole table per request; table-wide cleanup is a separate batched job.
// Run: node --test scripts/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sql = readFileSync(new URL('../supabase/20261115_rate_slots.sql', import.meta.url), 'utf8').replace(/--[^\n]*/g, '');
const fn = (name) => {
  const m = sql.match(new RegExp(`create or replace function public\\.${name}\\b[\\s\\S]*?\\$\\$([\\s\\S]*?)\\$\\$`, 'i'));
  assert.ok(m, `${name} defined`);
  return m[1];
};

test('take_rate_slot has no table-wide delete: every delete is scoped to p_bucket', () => {
  const body = fn('take_rate_slot');
  const deletes = body.match(/delete\s+from[\s\S]*?;/gi) || [];
  for (const d of deletes) assert.match(d, /bucket\s*=\s*p_bucket/i, `unscoped delete: ${d}`);
});

test('take_rate_slot computes its cutoff once, not clock_timestamp() inside a WHERE', () => {
  const body = fn('take_rate_slot');
  for (const w of body.match(/where[\s\S]*?;/gi) || []) assert.doesNotMatch(w, /clock_timestamp\(\)|now\(\)/i, w);
});

test('cleanup is a separate, batched job on a stable cutoff, scheduled daily', () => {
  const body = fn('prune_rate_slots');
  assert.match(body, /limit\s+p_batch/i);
  assert.match(body, /taken_at\s*<\s*cutoff/i);
  assert.match(sql, /cron\.schedule\(\s*'prune-rate-slots'/i);
  assert.match(sql, /create index if not exists rate_slots_bucket_time on public\.rate_slots \(bucket, taken_at/i);
  assert.match(sql, /create index if not exists rate_slots_time on public\.rate_slots \(taken_at\)/i);
});
