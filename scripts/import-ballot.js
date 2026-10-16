// Imports a Texas Secretary of State "Ballot Certification Report" PDF for one county.
//
//   node scripts/import-ballot.js path/to/report.pdf [more.pdf ...]
//
// Plain-text renderings of the same report (.txt), such as Google Drive's text
// view, are also accepted.
//
// For each report it:
//   1. reads the county name and every race and candidate, in ballot order;
//   2. adds new races and candidates to data/races.json (races shared across
//      counties, such as Governor or a multi-county district, are stored once);
//   3. writes data/ballots/<county>.json listing the race ids on that ballot.
//
// Existing candidate names and research are never overwritten. New races whose
// office could not be recognized are reported so they can be classified by hand.
// Requires pdftotext (poppler-utils).

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve, basename } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const racesPath = join(root, 'data/races.json');
const overridesPath = join(root, 'data/name-overrides.json');

export const slug = (s) =>
  String(s)
    .toLowerCase()
    .replace(/\./g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

const PARTIES = {
  REPUBLICAN: 'Republican',
  DEMOCRATIC: 'Democratic',
  LIBERTARIAN: 'Libertarian',
  GREEN: 'Green',
  INDEPENDENT: 'Independent',
  'WRITE-IN': 'Write-in',
};
const IGNORE = [
  /^Texas Secretary of State$/i,
  /^Ballot Certification Report$/i,
  /GENERAL ELECTION$/i,
  /^County:/i,
  /^Page \d+ of \d+/i,
];

// Proper-cases an all-caps name: "KEVIN MCCORMICK" -> "Kevin McCormick".
export function nameCase(raw, overrides = {}) {
  const key = raw.trim().toUpperCase();
  if (overrides[key]) return overrides[key];
  return key
    .toLowerCase()
    .split(/(\s+|-)/)
    .map((w) => {
      if (/^\s+$|^-$/.test(w)) return w;
      if (/^(ii|iii|iv|jr|sr)\.?$/.test(w))
        return w.length <= 3 && !w.startsWith('j') && !w.startsWith('s') ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1);
      let out = w.charAt(0).toUpperCase() + w.slice(1);
      out = out.replace(/^Mc([a-z])/, (_, c) => 'Mc' + c.toUpperCase());
      out = out.replace(/^O'([a-z])/, (_, c) => "O'" + c.toUpperCase());
      // Nicknames in quotes or parentheses: "(art)" -> "(Art)", '"mari"' -> '"Mari"'.
      out = out.replace(/^(["'(])([a-z])/, (_, p, c) => p + c.toUpperCase());
      return out;
    })
    .join('');
}

function titleCase(raw) {
  const small = new Set(['of', 'the', 'and', 'at', 'for']);
  return raw
    .replace(/\s+Party$/, '')
    .replace(/U\. S\./g, 'U.S.')
    .toLowerCase()
    .split(' ')
    .map((w, i) => {
      if (/^\d+(st|nd|rd|th)$/.test(w)) return w;
      if (i > 0 && small.has(w)) return w;
      if (w === 'u.s.') return 'U.S.';
      return w.charAt(0).toUpperCase() + w.slice(1);
    })
    .join(' ')
    .replace(/ - /g, ', ')
    .replace(/No\. /g, 'No. ');
}

// Recognizes an office from its ballot heading. Returns the canonical race id,
// the questionnaire office type, the office description key, display group,
// whether every Texas voter sees it, and whether it belongs to one county.
export function classify(heading, countySlug) {
  // "Unexpired term" races fill the same office, so they classify like the full term.
  const h = heading
    .replace(/\s*Party$/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase()
    .replace(/\s*[,-]?\s*UNEXPIRED TERM$/, '');
  const c = countySlug;
  const m = (re) => h.match(re);
  let r;
  const S = (id, office_type, office_key, group, statewide = false, local = false) => ({
    id,
    office_type,
    office_key,
    group,
    statewide,
    local,
  });

  if (/^U\. ?S\. SENATOR/.test(h)) return S('us-senate', 'us_senate', 'us_senate', 'federal', true);
  if ((r = m(/^U\. ?S\. REPRESENTATIVE,? DISTRICT (\d+)/))) return S(`us-house-${r[1]}`, 'us_house', 'us_house', 'federal');
  const statewideExec = {
    GOVERNOR: ['governor', 'governor'],
    'LIEUTENANT GOVERNOR': ['lt-governor', 'lt_governor'],
    'ATTORNEY GENERAL': ['attorney-general', 'attorney_general'],
    'COMPTROLLER OF PUBLIC ACCOUNTS': ['comptroller', 'comptroller'],
    'COMMISSIONER OF THE GENERAL LAND OFFICE': ['land-commissioner', 'land_commissioner'],
    'COMMISSIONER OF AGRICULTURE': ['agriculture-commissioner', 'agriculture_commissioner'],
    'RAILROAD COMMISSIONER': ['railroad-commissioner', 'railroad_commissioner'],
  };
  if (statewideExec[h]) {
    const [id, t] = statewideExec[h];
    return S(id, t, t, 'state', true);
  }
  if (/^CHIEF JUSTICE, SUPREME COURT/.test(h)) return S('tx-supreme-chief', 'judicial', 'supreme_court', 'state-judicial', true);
  if ((r = m(/^JUSTICE, SUPREME COURT, PLACE (\d+)/)))
    return S(`tx-supreme-${r[1]}`, 'judicial', 'supreme_court', 'state-judicial', true);
  if (/^PRESIDING JUDGE, COURT OF CRIMINAL APPEALS/.test(h)) return S('cca-presiding', 'judicial', 'cca', 'state-judicial', true);
  if ((r = m(/^JUDGE, COURT OF CRIMINAL APPEALS, PLACE (\d+)/)))
    return S(`cca-${r[1]}`, 'judicial', 'cca', 'state-judicial', true);
  if ((r = m(/^CHIEF JUSTICE, (\d+)(?:ST|ND|RD|TH) COURT OF APPEALS/))) {
    return S(
      `coa${r[1]}-chief`,
      'judicial',
      r[1] === '15' ? 'coa15' : r[1] === '5' ? 'coa5' : 'coa',
      'state-judicial',
      r[1] === '15'
    );
  }
  if ((r = m(/^JUSTICE, (\d+)(?:ST|ND|RD|TH) COURT OF APPEALS DISTRICT,? PLACE (\d+)/))) {
    return S(
      `coa${r[1]}-${r[2]}`,
      'judicial',
      r[1] === '15' ? 'coa15' : r[1] === '5' ? 'coa5' : 'coa',
      'state-judicial',
      r[1] === '15'
    );
  }
  if ((r = m(/STATE BOARD OF EDUCATION,? DISTRICT (\d+)/))) return S(`sboe-${r[1]}`, 'state_board_education', 'sboe', 'state');
  if ((r = m(/^STATE SENATOR,? DISTRICT (\d+)/))) return S(`state-senate-${r[1]}`, 'state_senate', 'state_senate', 'legislative');
  if ((r = m(/^STATE REPRESENTATIVE,? DISTRICT (\d+)/)))
    return S(`state-house-${r[1]}`, 'state_house', 'state_house', 'legislative');
  if ((r = m(/^(CRIMINAL |CIVIL |FAMILY )?DISTRICT JUDGE,? (\d+)(?:ST|ND|RD|TH) (?:JUDICIAL )?DISTRICT/))) {
    const prefix = r[1] ? slug(r[1]) + '-' : '';
    return S(`${prefix}district-${r[2]}`, 'judicial', 'district_court', 'county-judicial');
  }
  if ((r = m(/^DISTRICT ATTORNEY,? (\d+)(?:ST|ND|RD|TH) JUDICIAL DISTRICT/)))
    return S(`da-${r[1]}`, 'district_attorney', 'district_attorney', 'county');
  if (/^CRIMINAL DISTRICT ATTORNEY/.test(h)) return S(`${c}-da`, 'district_attorney', 'district_attorney', 'county', false, true);
  if (/^COUNTY ATTORNEY/.test(h)) return S(`${c}-county-attorney`, 'district_attorney', 'county_attorney', 'county', false, true);
  if (h === 'COUNTY JUDGE') return S(`${c}-county-judge`, 'county_judge', 'county_judge', 'county', false, true);
  if ((r = m(/^JUDGE, COUNTY CRIMINAL COURT OF APPEALS,? NO\. ?(\d+)/))) {
    return S(`${c}-ccl-criminal-appeals-${r[1]}`, 'judicial', 'ccl', 'county-judicial', false, true);
  }
  if ((r = m(/^JUDGE, COUNTY CRIMINAL COURT,? NO\. ?(\d+)/))) {
    return S(`${c}-ccl-criminal-${r[1]}`, 'judicial', 'ccl', 'county-judicial', false, true);
  }
  if (h === 'JUDGE, COUNTY COURT AT LAW') return S(`${c}-ccl`, 'judicial', 'ccl', 'county-judicial', false, true);
  if (/^CRIMINAL DISTRICT JUDGE/.test(h)) {
    const n = h.match(/(?:NUMBER|NO\.|#)\s*(\d+)/);
    return S(`${c}-criminal-district${n ? '-' + n[1] : ''}`, 'judicial', 'district_court', 'county-judicial', false, true);
  }
  if ((r = m(/^JUDGE, COUNTY (CRIMINAL |CIVIL )?COURT AT LAW,? NO\. ?(\d+)/))) {
    const kind = r[1] ? slug(r[1]) + '-' : '';
    return S(`${c}-ccl-${kind}${r[2]}`, 'judicial', 'ccl', 'county-judicial', false, true);
  }
  if ((r = m(/^(?:JUDGE, )?(?:COUNTY )?PROBATE COURT(?: AT LAW)?(?:,? NO\. ?(\d+))?/)))
    return S(`${c}-probate${r[1] ? '-' + r[1] : ''}`, 'judicial', 'probate', 'county-judicial', false, true);
  if (h === 'DISTRICT CLERK') return S(`${c}-district-clerk`, 'clerk', 'district_clerk', 'county', false, true);
  if (h === 'COUNTY CLERK') return S(`${c}-county-clerk`, 'clerk', 'county_clerk', 'county', false, true);
  if (h === 'COUNTY TREASURER') return S(`${c}-treasurer`, 'clerk', 'county_treasurer', 'county', false, true);
  if (/^COUNTY TAX ASSESSOR/.test(h)) return S(`${c}-tax-assessor`, 'clerk', 'tax_assessor', 'county', false, true);
  if (h === 'SHERIFF') return S(`${c}-sheriff`, 'sheriff', 'sheriff', 'county', false, true);
  if ((r = m(/^COUNTY COMMISSIONER,? PRECINCT (\d+)/)))
    return S(`${c}-commissioner-${r[1]}`, 'county_commissioner', 'county_commissioner', 'county', false, true);
  if ((r = m(/^JUSTICE OF THE PEACE,? PRECINCT (\d+)(?:,? PLACE (\d+))?/))) {
    return S(`${c}-jp-${r[1]}${r[2] ? '-' + r[2] : ''}`, 'judicial', 'jp', 'county-judicial', false, true);
  }
  if ((r = m(/^(?:COUNTY )?CONSTABLE,? PRECINCT (\d+)/)))
    return S(`${c}-constable-${r[1]}`, 'constable', 'constable', 'county', false, true);
  if (h === 'COUNTY SURVEYOR') return S(`${c}-surveyor`, 'clerk', 'county_surveyor', 'county', false, true);
  if ((r = m(/COUNTY DEPARTMENT OF EDUCATION,? (?:POSITION|PLACE) (\d+)/))) {
    return S(`${c}-dept-education-${r[1]}`, 'county_education_board', 'county_ed_board', 'county', false, true);
  }
  return { ...S(`${c}-${slug(h)}`, 'other', null, 'county', false, true), unrecognized: true };
}

export function parseReport(text) {
  const countyMatch = text.match(/County:\s*([A-Z][A-Z .'-]+)/);
  if (!countyMatch) throw new Error('Could not find "County:" in the report');
  const county = nameCase(countyMatch[1].trim());
  const electionMatch = text.match(/(\d{4} [A-Z ]*ELECTION)/);
  const races = [];
  let current = null;
  const partyRe = new RegExp(`^\\s+(.+?)\\s{2,}(${Object.keys(PARTIES).join('|')})\\s*$`);
  for (const line of text.split('\n')) {
    if (!line.trim() || IGNORE.some((re) => re.test(line.trim()))) continue;
    const cand = line.match(partyRe);
    if (cand && current) {
      current.candidates.push({ raw: cand[1].trim(), party: PARTIES[cand[2]] });
      continue;
    }
    const heading = line.replace(/\s*Party\s*$/, '').trim();
    if (/^\d{1,2}\/\d{1,2}\/\d{4}/.test(heading)) continue;
    // Every race lists at least one candidate, so a heading line that arrives
    // before any candidate is the wrapped second line of the previous heading.
    if (current && !current.candidates.length) {
      current.heading += ` ${heading}`;
      continue;
    }
    current = { heading, candidates: [] };
    races.push(current);
  }
  return { county, election: electionMatch ? electionMatch[1] : null, races: races.filter((r) => r.candidates.length) };
}

// Parses the plain-text rendering of a report (for example, Google Drive's text
// view), where each race heading is followed by one line listing every candidate
// with their party: "KEN PAXTON REPUBLICAN JAMES TALARICO DEMOCRATIC".
export function parseFlowedReport(text) {
  const countyMatch = text.match(/County:\s*([A-Z][A-Z .'-]+?)\s*(?:\n|$)/);
  if (!countyMatch) throw new Error('Could not find "County:" in the report');
  const county = nameCase(countyMatch[1].trim());
  const electionMatch = text.match(/(\d{4} [A-Z ]*ELECTION)/);
  const isParty = (w) => Object.hasOwn(PARTIES, w);
  const races = [];
  let current = null;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || IGNORE.some((re) => re.test(line))) continue;
    const words = line.split(/\s+/);
    if (isParty(words.at(-1)) && current) {
      let name = [];
      words.forEach((w, i) => {
        // A party word followed by another party word belongs to the name
        // (for example a candidate surnamed Green).
        if (isParty(w) && !isParty(words[i + 1] ?? '') && name.length) {
          current.candidates.push({ raw: name.join(' '), party: PARTIES[w] });
          name = [];
        } else {
          name.push(w);
        }
      });
      if (name.length) throw new Error(`Could not parse candidates in "${line}"`);
      continue;
    }
    current = { heading: line.replace(/^Party\s+/, ''), candidates: [] };
    races.push(current);
  }
  return { county, election: electionMatch ? electionMatch[1] : null, races: races.filter((r) => r.candidates.length) };
}

function readReport(file) {
  if (file.toLowerCase().endsWith('.txt')) return parseFlowedReport(readFileSync(file, 'utf8'));
  return parseReport(execFileSync('pdftotext', ['-layout', file, '-'], { encoding: 'utf8' }));
}

function main(files) {
  const races = JSON.parse(readFileSync(racesPath, 'utf8'));
  const overrides = existsSync(overridesPath) ? JSON.parse(readFileSync(overridesPath, 'utf8')) : {};
  const byId = new Map(races.map((r) => [r.id, r]));
  const candidateIds = new Map();
  for (const r of races) for (const c of r.candidates) candidateIds.set(c.id, r.id);
  mkdirSync(join(root, 'data/ballots'), { recursive: true });

  for (const file of files) {
    const report = readReport(file);
    const cslug = slug(report.county);
    const raceIds = [];
    const notes = [];
    for (const pr of report.races) {
      const info = classify(pr.heading, cslug);
      // A ballot can list a full term and an unexpired term for the same seat.
      if (raceIds.includes(info.id) && /UNEXPIRED/i.test(pr.heading)) info.id += '-unexpired';
      let race = byId.get(info.id);
      if (!race) {
        race = {
          id: info.id,
          title: titleCase(pr.heading),
          office_type: info.office_type,
          office_key: info.office_key,
          group: info.group,
          statewide: info.statewide,
          county: info.local ? report.county : null,
          candidates: [],
        };
        races.push(race);
        byId.set(race.id, race);
        notes.push(
          `new race ${race.id} (${race.title})${info.unrecognized ? '  UNRECOGNIZED OFFICE: set office_type and office_key by hand' : ''}`
        );
      }
      for (const pc of pr.candidates) {
        const name = nameCase(pc.raw, overrides);
        const existing = race.candidates.find((c) => slug(c.name) === slug(name) || c.id === slug(name));
        if (existing) continue;
        let id = slug(name);
        if (candidateIds.has(id) && candidateIds.get(id) !== race.id) id = `${id}-${race.id}`;
        race.candidates.push({ id, name, party: pc.party });
        candidateIds.set(id, race.id);
        notes.push(`new candidate ${name} (${pc.party}) in ${race.id}`);
      }
      raceIds.push(race.id);
    }
    const ballot = {
      county: report.county,
      election: report.election,
      source: basename(file),
      imported_at: new Date().toISOString().slice(0, 10),
      race_ids: raceIds,
    };
    writeFileSync(join(root, `data/ballots/${cslug}.json`), JSON.stringify(ballot, null, 1) + '\n');
    console.log(`${report.county}: ${raceIds.length} races written to data/ballots/${cslug}.json`);
    for (const n of notes) console.log('  ' + n);
  }
  writeFileSync(racesPath, JSON.stringify(races, null, 1) + '\n');
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  const files = process.argv.slice(2);
  if (!files.length) {
    console.error('Usage: node scripts/import-ballot.js report.pdf [more.pdf ...]');
    process.exit(1);
  }
  main(files);
}
