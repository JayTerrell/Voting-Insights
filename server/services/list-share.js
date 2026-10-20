// Shared ballot picks and office watchlists.
//
// A person shares either the candidates they picked or the offices they are
// watching, for one county's ballot. The list is built from the plan saved to
// their account, never from what the browser sends, and stored as a copy, so
// later changes stay private until they share again. Anyone with the link sees
// the person's first name, the county, and the list. Nothing else.

import { createHash } from 'node:crypto';
import * as shares from '../db/repositories/list-shares.js';
import * as accounts from './accounts.js';
import { guide, raceTitle, raceCandidates, servedCounties } from './guide.js';
import { randomToken } from '../lib/crypto.js';
import { config } from '../config.js';

export const LIST_KINDS = ['ballot', 'watchlist'];
const raceById = new Map(guide.races.map((r) => [r.id, r]));

export const listUrl = (kind, shareId) => `${config.publicUrl}/${kind}/${shareId}`;

// Changes whenever the list does, so networks fetch a fresh preview image.
export const listVersion = (row) =>
  createHash('sha256').update(`${row.county}|${row.items_json}`).digest('base64url').slice(0, 8);

// The races on the county's ballot, in ballot order, that belong on the list.
export function buildItems(plan, kind, county) {
  const ballot = guide.ballots[county] || [];
  if (kind === 'ballot') {
    return ballot
      .filter((id) => plan.picks?.[id] && raceCandidates.get(id)?.has(plan.picks[id]))
      .map((id) => ({ race: id, pick: plan.picks[id] }));
  }
  const watched = new Set(plan.starred_races || []);
  return ballot.filter((id) => watched.has(id)).map((id) => ({ race: id }));
}

function summary(row) {
  return {
    kind: row.kind,
    share_id: row.share_id,
    url: listUrl(row.kind, row.share_id),
    version: listVersion(row),
    county: row.county,
    items: JSON.parse(row.items_json),
    updated_at: row.updated_at,
  };
}

export async function mine(user) {
  const rows = await shares.listForUser(user.id);
  const out = { ballot: null, watchlist: null };
  for (const r of rows) if (LIST_KINDS.includes(r.kind)) out[r.kind] = summary(r);
  return out;
}

export async function share(user, kind, county) {
  if (!LIST_KINDS.includes(kind)) return { error: 'Choose your picks or your watchlist to share.' };
  if (!servedCounties.includes(county)) return { error: 'Choose a county to share.' };
  const items = buildItems(await accounts.getPlan(user), kind, county);
  if (!items.length) {
    return {
      error:
        kind === 'ballot'
          ? 'Pick at least one candidate on this ballot before sharing.'
          : 'Add at least one office on this ballot to your watchlist before sharing.',
    };
  }
  const existing = await shares.find(user.id, kind);
  await shares.save(user.id, kind, existing?.share_id || randomToken(9), county, items);
  return (await mine(user))[kind];
}

export const stop = (user, kind) => shares.remove(user.id, kind);

// The list with office and candidate details filled in. Races or candidates no
// longer in the guide are left out.
export function resolve(row) {
  const items = [];
  for (const item of JSON.parse(row.items_json)) {
    const race = raceById.get(item.race);
    if (!race) continue;
    const base = { race: race.id, title: raceTitle(race), group: race.group, candidates: race.candidates.length };
    if (row.kind === 'ballot') {
      const c = race.candidates.find((x) => x.id === item.pick);
      if (!c) continue;
      items.push({ ...base, pick: { id: c.id, name: c.name, party: c.party, photo: c.photo?.url || null } });
    } else items.push(base);
  }
  return { kind: row.kind, first_name: row.first_name, county: row.county, items };
}

export function publicView(row, viewer) {
  return {
    ...resolve(row),
    share_id: row.share_id,
    updated_at: row.updated_at,
    owner: Boolean(viewer && viewer.id === row.user_id),
  };
}
