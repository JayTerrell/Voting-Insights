// Merges the ballot roster, questionnaire, office descriptions, party platforms,
// and candidate research into data/guide.json, which the site serves.
//
//   node scripts/build-data.js
//
// The script also enforces the content rules: every claim must cite a source the
// candidate entry actually lists, positions must be on the -2..2 scale, and no
// em dashes or en dashes may appear anywhere in the output.

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const read = (p) => JSON.parse(readFileSync(join(root, p), 'utf8'));

const races = read('data/races.json');
const questions = read('data/questions.json');
const offices = read('data/offices.json');

// One file per county, written by scripts/import-ballot.js, listing that
// county's races in ballot order.
const ballotDir = join(root, 'data/ballots');
const ballots = {};
for (const f of existsSync(ballotDir) ? readdirSync(ballotDir) : []) {
  if (!f.endsWith('.json')) continue;
  const b = JSON.parse(readFileSync(join(ballotDir, f), 'utf8'));
  ballots[b.county] = b.race_ids;
}
const raceIds = new Set(races.map((r) => r.id));
for (const [county, ids] of Object.entries(ballots)) {
  for (const id of ids) if (!raceIds.has(id)) throw new Error(`ballot for ${county} lists unknown race ${id}`);
}

const BASES = new Set(['record', 'statement', 'questionnaire', 'reported', 'inferred', 'platform']);
const warnings = [];
const warn = (m) => warnings.push(m);

// Replace dashes the site never uses. A spaced dash becomes a comma; a dash
// between numbers becomes "to"; anything left becomes a hyphen.
function scrub(value) {
  if (typeof value === 'string') {
    return value
      .replace(/\s*[—―]\s*/g, ', ')
      .replace(/(\d)\s*–\s*(\d)/g, '$1 to $2')
      .replace(/\s+–\s+/g, ', ')
      .replace(/–/g, '-')
      .replace(/,\s*,/g, ',')
      .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '')
      .trim();
  }
  if (Array.isArray(value)) return value.map(scrub);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, scrub(v)]));
  }
  return value;
}

function cleanSources(list, who) {
  const out = [];
  const seen = new Set();
  for (const s of list || []) {
    if (!s || !s.id || !s.url || !/^https?:\/\//.test(s.url)) {
      warn(`${who}: dropped source without a valid url (${s && s.id})`);
      continue;
    }
    if (seen.has(s.id)) continue;
    seen.add(s.id);
    out.push({ id: s.id, title: s.title || s.url, publisher: s.publisher || '', url: s.url, date: s.date || null });
  }
  return out;
}

function citedItems(items, ids, who, field) {
  const out = [];
  for (const it of items || []) {
    const obj = typeof it === 'string' ? { text: it, sources: [] } : it;
    if (!obj || !obj.text) continue;
    const sources = (obj.sources || []).filter((s) => ids.has(s));
    if (!sources.length) {
      warn(`${who}: ${field} item has no valid source and was dropped: "${obj.text.slice(0, 60)}"`);
      continue;
    }
    out.push({ text: obj.text, sources });
  }
  return out;
}

function cleanStances(stances, ids, who) {
  const out = {};
  const qids = new Set(questions.map((q) => q.id));
  for (const [qid, s] of Object.entries(stances || {})) {
    if (!qids.has(qid)) {
      warn(`${who}: unknown question ${qid}`);
      continue;
    }
    const position = Number(s.position);
    if (![-2, -1, 0, 1, 2].includes(position)) {
      warn(`${who}: ${qid} position out of range`);
      continue;
    }
    if (!BASES.has(s.basis)) {
      warn(`${who}: ${qid} has unknown basis "${s.basis}"`);
      continue;
    }
    const sources = (s.sources || []).filter((x) => ids.has(x));
    if (!sources.length) {
      warn(`${who}: ${qid} stance has no valid source and was dropped`);
      continue;
    }
    out[qid] = { position, basis: s.basis, summary: s.summary || '', sources };
  }
  return out;
}

// ---- Research files ----
const researchDir = join(root, 'data/research');
const research = new Map();
let parties = [];
for (const f of existsSync(researchDir) ? readdirSync(researchDir) : []) {
  if (!f.endsWith('.json')) continue;
  const data = JSON.parse(readFileSync(join(researchDir, f), 'utf8'));
  if (data.parties) parties = data.parties;
  for (const c of data.candidates || []) {
    if (research.has(c.id)) warn(`duplicate research entry for ${c.id} in ${f}`);
    research.set(c.id, c);
  }
}

const allCandidateIds = new Set();
const builtRaces = races.map((race) => {
  const office = offices[race.office_key];
  if (!office) warn(`no office description for ${race.id}`);
  return {
    ...race,
    office: office || null,
    candidates: race.candidates.map((base) => {
      allCandidateIds.add(base.id);
      const r = research.get(base.id) || {};
      if (!research.has(base.id)) warn(`no research for ${base.id}`);
      const who = base.id;
      const sources = cleanSources(r.sources, who);
      const ids = new Set(sources.map((s) => s.id));
      return {
        ...base,
        incumbent: Boolean(r.incumbent),
        current_role: r.current_role || '',
        background: r.background || '',
        website: r.website && /^https?:\/\//.test(r.website) ? r.website : null,
        priorities: citedItems(r.priorities, ids, who, 'priority'),
        promises: citedItems(r.promises, ids, who, 'promise'),
        record: citedItems(r.record, ids, who, 'record'),
        notes: citedItems(r.notes, ids, who, 'note'),
        stances: cleanStances(r.stances, ids, who),
        issue_notes: (r.issue_notes || [])
          .map((n) => ({ topic: n.topic, summary: n.summary, sources: (n.sources || []).filter((x) => ids.has(x)) }))
          .filter((n) => n.topic && n.summary && n.sources.length),
        sources,
        research_gaps: r.research_gaps || '',
      };
    }),
  };
});

for (const id of research.keys()) if (!allCandidateIds.has(id)) warn(`research entry ${id} is not on the ballot`);

const builtParties = parties.map((p) => {
  const sources = cleanSources(p.sources, p.id);
  const ids = new Set(sources.map((s) => s.id));
  return {
    id: p.id,
    name: p.name,
    short: p.short,
    platform_title: p.platform_title,
    platform_year: p.platform_year,
    platform_url: /^https?:\/\//.test(p.platform_url || '') ? p.platform_url : null,
    summary: p.summary,
    stances: cleanStances(p.stances, ids, `party:${p.id}`),
    sources,
  };
});

const guide = scrub({
  generated_at: new Date().toISOString(),
  election: {
    name: '2026 November General Election',
    county: 'Collin County, Texas',
    date: '2026-11-03',
    early_voting: { start: '2026-10-19', end: '2026-10-30' },
    roster_source: {
      title: 'Texas Secretary of State Ballot Certification Reports, 2026 November General Election',
      url: 'https://www.sos.state.tx.us/elections/',
    },
  },
  ballots,
  questions,
  parties: builtParties,
  races: builtRaces,
});

const text = JSON.stringify(guide);
if (/[–—]/.test(text)) throw new Error('Dash characters survived scrubbing');
writeFileSync(join(root, 'data/guide.json'), JSON.stringify(guide, null, 1));

const cands = builtRaces.flatMap((r) => r.candidates);
const stanceCount = cands.reduce((n, c) => n + Object.keys(c.stances).length, 0);
const sourceCount = cands.reduce((n, c) => n + c.sources.length, 0);
console.log(
  `guide.json: ${Object.keys(ballots).length} county ballots, ${builtRaces.length} races, ${cands.length} candidates, ${stanceCount} stances, ${sourceCount} sources, ${builtParties.length} parties`
);
if (warnings.length) {
  console.log(`${warnings.length} warnings:`);
  for (const w of warnings) console.log('  ' + w);
}
