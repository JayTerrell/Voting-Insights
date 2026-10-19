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

// Sites whose articles are labeled as AI-generated or AI-assisted are not
// accepted as evidence. Claims that cited only these sources are dropped.
const BLOCKED_SOURCE_DOMAINS = ['hoodline.com', 'theballotbrief.com', 'goodparty.org'];
const isBlocked = (url) => {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    return BLOCKED_SOURCE_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`));
  } catch {
    return true;
  }
};

function cleanSources(list, who) {
  const out = [];
  const seen = new Set();
  for (const s of list || []) {
    if (!s || !s.id || !s.url || !/^https?:\/\//.test(s.url)) {
      warn(`${who}: dropped source without a valid url (${s && s.id})`);
      continue;
    }
    if (isBlocked(s.url)) {
      warn(`${who}: dropped source from a blocked site (${s.url})`);
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

// Sites that summarize candidates rather than quote them. A stance supported
// only by these counts as news reporting, never as the candidate's own words.
const SECONDARY_SUMMARY_DOMAINS = ['branch.vote'];
const hostOf = (url) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
};

function cleanStances(stances, ids, who, sourceUrls = {}) {
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
    let basis = s.basis;
    const onlySummaries = sources.every((id) => SECONDARY_SUMMARY_DOMAINS.includes(hostOf(sourceUrls[id] || '')));
    if (onlySummaries && ['statement', 'questionnaire', 'record'].includes(basis)) basis = 'reported';
    out[qid] = { position, basis, summary: s.summary || '', sources };
  }
  return out;
}

// Photos are served from this site only (client/img/candidates), with credit to
// the page they came from. See docs/RESEARCH_SPEC.md.
function cleanPhoto(photo, who) {
  if (!photo) return null;
  const ok =
    /^\/img\/candidates\/[a-z0-9-]+\.(jpg|jpeg|png|webp)$/.test(photo.url || '') &&
    /^https?:\/\//.test(photo.source_url || '') &&
    existsSync(join(root, 'client', photo.url));
  if (!ok) {
    warn(`${who}: photo dropped (needs a local /img/candidates/ file and a source_url)`);
    return null;
  }
  return { url: photo.url, credit: photo.credit || '', source_url: photo.source_url };
}

// ---- Research files ----
// Primary files are read first; supplement files (pass2-*.json and later) are
// merged into the matching candidate entries. See docs/RESEARCH_SPEC.md.
const researchDir = join(root, 'data/research');
const research = new Map();
let parties = [];

const LIST_FIELDS = ['priorities', 'promises', 'record', 'notes', 'issue_notes'];
const SCALAR_FIELDS = ['website', 'current_role', 'background', 'incumbent', 'photo'];

function mergeSupplement(base, extra, file) {
  const ids = new Set((base.sources || []).map((s) => s.id));
  for (const s of extra.sources || []) {
    if (ids.has(s.id)) warn(`${extra.id}: supplement ${file} reuses source id ${s.id}; skipped`);
    else {
      (base.sources ||= []).push(s);
      ids.add(s.id);
    }
  }
  for (const field of LIST_FIELDS) {
    const existing = new Set((base[field] || []).map((i) => (i.text || i.summary || '').trim()));
    for (const item of extra[field] || []) {
      const key = (item.text || item.summary || '').trim();
      if (!existing.has(key)) (base[field] ||= []).push(item);
    }
  }
  for (const field of SCALAR_FIELDS) if (extra[field] !== undefined && extra[field] !== null) base[field] = extra[field];
  for (const [qid, stance] of Object.entries(extra.stances || {})) {
    base.stances ||= {};
    if (!base.stances[qid] || stance.replace === true) {
      const clean = { ...stance };
      delete clean.replace;
      base.stances[qid] = clean;
    } else {
      warn(`${extra.id}: ${file} has a ${qid} stance without "replace": true; kept the original`);
    }
  }
  if (extra.research_gaps) base.research_gaps = extra.research_gaps;
}

const files = (existsSync(researchDir) ? readdirSync(researchDir) : []).filter((f) => f.endsWith('.json')).sort();
// Fact-check files can list stances that their sources do not support.
const removals = [];
const isSupplement = (f) => /^pass\d+-/.test(f);
for (const f of [...files.filter((x) => !isSupplement(x)), ...files.filter(isSupplement)]) {
  const data = JSON.parse(readFileSync(join(researchDir, f), 'utf8'));
  if (data.parties) parties = data.parties;
  for (const r of data.remove_stances || []) removals.push({ ...r, file: f });
  for (const c of data.candidates || []) {
    if (!research.has(c.id)) research.set(c.id, structuredClone(c));
    else if (isSupplement(f)) mergeSupplement(research.get(c.id), c, f);
    else warn(`duplicate research entry for ${c.id} in ${f}`);
  }
}

for (const r of removals) {
  const entry = research.get(r.candidate);
  if (entry?.stances?.[r.question]) {
    delete entry.stances[r.question];
    console.log(`removed ${r.candidate} ${r.question} (${r.file}): ${r.reason || 'not supported by its source'}`);
  } else {
    warn(`${r.file}: remove_stances entry ${r.candidate} ${r.question} matched nothing`);
  }
}

const allCandidateIds = new Set();
const builtRaces = races.map((race) => {
  const office = offices[race.office_key];
  if (!office) warn(`no office description for ${race.id}`);
  return {
    ...race,
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
        photo: cleanPhoto(r.photo, who),
        priorities: citedItems(r.priorities, ids, who, 'priority'),
        promises: citedItems(r.promises, ids, who, 'promise'),
        record: citedItems(r.record, ids, who, 'record'),
        notes: citedItems(r.notes, ids, who, 'note'),
        stances: cleanStances(r.stances, ids, who, Object.fromEntries(sources.map((x) => [x.id, x.url]))),
        issue_notes: (r.issue_notes || [])
          .map((n) => ({ topic: n.topic, summary: n.summary, sources: (n.sources || []).filter((x) => ids.has(x)) }))
          .filter((n) => n.topic && n.summary && n.sources.length),
        sources,
        research_gaps: r.research_gaps || '',
        researched: research.has(base.id) && sources.length > 0,
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
  // Office descriptions are stored once; each race refers to its office_key.
  offices,
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
