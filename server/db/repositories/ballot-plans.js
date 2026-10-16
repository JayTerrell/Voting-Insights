import { getDb } from '../index.js';

export async function find(userId) {
  const db = await getDb();
  const row = await db.get('SELECT plan_json, updated_at FROM ballot_plans WHERE user_id = ?', [userId]);
  return row ? { ...JSON.parse(row.plan_json), updated_at: row.updated_at } : null;
}

export async function save(userId, plan) {
  const db = await getDb();
  const ts = new Date().toISOString();
  await db.run(
    `INSERT INTO ballot_plans (user_id, plan_json, updated_at) VALUES (?, ?, ?)
     ON CONFLICT (user_id) DO UPDATE SET plan_json = excluded.plan_json, updated_at = excluded.updated_at`,
    [userId, JSON.stringify(plan), ts]
  );
  return { ...plan, updated_at: ts };
}
