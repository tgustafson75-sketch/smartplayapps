// One shared, atomic rate limit for every public endpoint on this site. Serverless instances share no
// memory, so a count kept in a Map, or a "select the recent rows, then insert" pair, lets parallel
// requests all see the same old count and all pass. Instead each request asks Postgres (SmartPlay
// Academy Supabase project, the store the forms already use) for ONE slot: take_rate_slot locks the
// bucket, counts the window and inserts in a single transaction, so N concurrent calls get exactly
// `max` trues. SQL: supabase/20261115_rate_slots.sql. Buckets are hashed: no email or IP is stored.
const crypto = require('crypto');

const bucketKey = (scope, value) => `${scope}:${crypto.createHash('sha256').update(`smartplayapps:${scope}:${String(value)}`).digest('hex')}`;

/** True when a slot was taken, false when the window is full. Throws when the store is missing or errors. */
async function takeSlot(scope, value, max, windowSeconds) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error('rate store not configured');
  const r = await fetch(`${url}/rest/v1/rpc/take_rate_slot`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_bucket: bucketKey(scope, value), p_max: max, p_window_seconds: windowSeconds }),
  });
  if (!r.ok) throw new Error(`take_rate_slot ${r.status}`);
  const v = await r.json();
  if (typeof v !== 'boolean') throw new Error('take_rate_slot bad answer');
  return v;
}

module.exports = { takeSlot, bucketKey };
