// Fixed-window request counters kept in the database, so limits hold across
// serverless instances. Bucket keys contain a hash of the client IP, never the IP.

import { getDb } from '../index.js';

export async function hit(bucket, windowMs) {
  const db = await getDb();
  const now = Date.now();
  const row = await db.get(
    `INSERT INTO rate_limits (bucket, hits, reset_at) VALUES (?, 1, ?)
     ON CONFLICT (bucket) DO UPDATE SET
       hits = CASE WHEN rate_limits.reset_at <= ? THEN 1 ELSE rate_limits.hits + 1 END,
       reset_at = CASE WHEN rate_limits.reset_at <= ? THEN ? ELSE rate_limits.reset_at END
     RETURNING hits`,
    [bucket, now + windowMs, now, now, now + windowMs]
  );
  // Occasionally clear expired buckets so the table stays small.
  if (Math.random() < 0.02) await db.run('DELETE FROM rate_limits WHERE reset_at <= ?', [now]);
  return row.hits;
}
