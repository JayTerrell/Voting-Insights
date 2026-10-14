# Adding a county

Each county's ballot comes from its Texas Secretary of State **Ballot Certification Report** (the same PDF format as the Collin County report). Races that appear in several counties, such as Governor, the U.S. Senate, a congressional district, or a multi-county district court, are stored once and shared. Only new races and new candidates need research.

## 1. Import the report

```bash
node scripts/import-ballot.js reports/Ballot_Certification_Report_-_2026_NOVEMBER_GENERAL_ELECTION_-_DALLAS.pdf
```

Several PDFs can be passed at once. For each report the script:

- writes `data/ballots/<county>.json` with that county's race ids in ballot order;
- adds any new races and candidates to `data/races.json`;
- prints every new race and candidate.

Review that output for these cases:

- **`UNRECOGNIZED OFFICE`**: open `data/races.json`, find the race, and set `office_type` (which quiz questions apply) and `office_key` (which description in `data/offices.json` to show). If the office needs a new description, add it to `data/offices.json`.
- **Name casing**: names are converted from all caps ("KEVIN MCCORMICK" becomes "Kevin McCormick"). If a name comes out wrong, such as "Dibianca" for "DiBianca", add it to `data/name-overrides.json` as `{"ARTHUR DIBIANCA": "Arthur DiBianca"}` and re-run the import, or fix the name in `data/races.json`.
- **Same name, different race**: if a new candidate's name matches someone already in a different race, the new id gets the race id appended (for example `john-smith-dallas-jp-1`). Check that they really are different people.

Re-importing the same report is safe. Existing races, candidates, and research are never overwritten.

## 2. See what needs research

```bash
node scripts/research-status.js Dallas
```

This lists every candidate on that ballot with no research yet. Statewide candidates already researched for another county are not listed again.

## 3. Research the candidates

Follow `docs/RESEARCH_SPEC.md`. Write each batch of candidates to its own file in `data/research/`, for example `data/research/dallas-county.json`. The spec defines the JSON format, the evidence rules, and the neutrality rules. In short:

- every priority, promise, record item, note, and stance cites a source listed for that candidate;
- positions are never inferred from party;
- no em dashes or en dashes.

## 4. Build, check, and deploy

```bash
npm run build:data    # merges everything into data/guide.json and lists anything dropped
npm run check:links   # checks every source URL
npm test
```

The build prints a warning for every claim it drops, for example a stance citing a source id that does not exist. Fix those warnings before publishing. Commit `data/` and deploy. Voters who choose the new county in the quiz will then see every race on its ballot. People who took the quiz earlier will see a notice suggesting they retake it.

## Counties without an imported ballot

The quiz and guide still work for every Texas county. Voters in a county without an imported ballot see the statewide races, and the site tells them the full ballot has not been loaded yet.
