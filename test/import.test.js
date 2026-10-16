import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseReport, classify, nameCase } from '../scripts/import-ballot.js';

const SAMPLE = `                           Texas Secretary of State
                            Ballot Certification Report
                         2026 NOVEMBER GENERAL ELECTION

County: FORT BEND

   GOVERNOR                                               Party
       GREG ABBOTT                                        REPUBLICAN
       GINA HINOJOSA                                      DEMOCRATIC

   JUSTICE OF THE PEACE PRECINCT 1, PLACE 2
       MARY O'NEIL                                        DEMOCRATIC

   MEMBER, STATE BOARD OF EDUCATION, DISTRICT 7
       JOHN MCDONALD JR.                                  REPUBLICAN
                                Page 1 of 3                    10/14/2026, 5:55:46 AM
`;

test('parses county, races, and candidates from report text', () => {
  const r = parseReport(SAMPLE);
  assert.equal(r.county, 'Fort Bend');
  assert.deepEqual(
    r.races.map((x) => x.heading),
    ['GOVERNOR', 'JUSTICE OF THE PEACE PRECINCT 1, PLACE 2', 'MEMBER, STATE BOARD OF EDUCATION, DISTRICT 7']
  );
  assert.equal(r.races[0].candidates.length, 2);
  assert.equal(r.races[0].candidates[1].party, 'Democratic');
});

test('classifies shared and county offices', () => {
  assert.equal(classify('GOVERNOR', 'fort-bend').id, 'governor');
  assert.equal(classify('GOVERNOR', 'fort-bend').statewide, true);
  assert.equal(classify('JUSTICE OF THE PEACE PRECINCT 1, PLACE 2', 'fort-bend').id, 'fort-bend-jp-1-2');
  assert.equal(classify('MEMBER, STATE BOARD OF EDUCATION, DISTRICT 7', 'fort-bend').id, 'sboe-7');
  assert.equal(classify('JUSTICE, 14TH COURT OF APPEALS DISTRICT, PLACE 3', 'harris').id, 'coa14-3');
  assert.equal(classify('DISTRICT JUDGE, 219TH JUDICIAL DISTRICT', 'collin').id, 'district-219');
  assert.equal(classify('COUNTY JUDGE', 'collin').id, 'collin-county-judge');
  assert.equal(classify('SOMETHING NEW', 'collin').unrecognized, true);
});

test('proper-cases names', () => {
  assert.equal(nameCase('KEVIN MCCORMICK'), 'Kevin McCormick');
  assert.equal(nameCase("MARY O'NEIL"), "Mary O'Neil");
  assert.equal(nameCase('V. ALONZO ECHAVARRIA-GARZA'), 'V. Alonzo Echavarria-Garza');
  assert.equal(nameCase('ARTHUR DIBIANCA', { 'ARTHUR DIBIANCA': 'Arthur DiBianca' }), 'Arthur DiBianca');
});

import { readFileSync } from 'node:fs';
import { parseFlowedReport } from '../scripts/import-ballot.js';

test('parses the flowed text rendering of a report', () => {
  const r = parseFlowedReport(readFileSync(new URL('./fixtures/smith-excerpt.txt', import.meta.url), 'utf8'));
  assert.equal(r.county, 'Smith');
  assert.deepEqual(
    r.races.map((x) => x.heading),
    [
      'U. S. SENATOR',
      'U. S. REPRESENTATIVE DISTRICT 1',
      'LIEUTENANT GOVERNOR',
      'MEMBER, STATE BOARD OF EDUCATION, DISTRICT 9',
      'JUSTICE, 12TH COURT OF APPEALS DISTRICT, PLACE 3 - UNEXPIRED TERM',
      'COUNTY COMMISSIONER PRECINCT 4',
    ]
  );
  assert.deepEqual(r.races[2].candidates.at(-1), { raw: 'KEVIN MCCORMICK', party: 'Green' });
  assert.deepEqual(r.races[5].candidates, [{ raw: 'RALPH E CARAWAY, SR', party: 'Democratic' }]);
});

test('a candidate surnamed Green is not mistaken for a party', () => {
  const text = 'County: TEST\n\nSTATE SENATOR, DISTRICT 9\n\nMARY GREEN REPUBLICAN JOHN GREEN GREEN\n';
  assert.deepEqual(parseFlowedReport(text).races[0].candidates, [
    { raw: 'MARY GREEN', party: 'Republican' },
    { raw: 'JOHN GREEN', party: 'Green' },
  ]);
});

test('classifies county courts, constables, and unexpired terms', () => {
  assert.equal(classify('JUDGE, COUNTY COURT AT LAW', 'bastrop').id, 'bastrop-ccl');
  assert.equal(classify('JUDGE, COUNTY CRIMINAL COURT NO. 4', 'dallas').id, 'dallas-ccl-criminal-4');
  assert.equal(classify('JUDGE, COUNTY CRIMINAL COURT OF APPEALS NO. 1', 'dallas').id, 'dallas-ccl-criminal-appeals-1');
  assert.equal(classify('CRIMINAL DISTRICT JUDGE, DALLAS COUNTY NUMBER 5', 'dallas').id, 'dallas-criminal-district-5');
  assert.equal(classify('CRIMINAL DISTRICT JUDGE #3 TARRANT COUNTY', 'tarrant').id, 'tarrant-criminal-district-3');
  assert.equal(classify('CRIMINAL DISTRICT JUDGE JEFFERSON COUNTY', 'jefferson').id, 'jefferson-criminal-district');
  assert.equal(classify('JUDGE, COUNTY PROBATE COURT AT LAW NO. 2', 'denton').id, 'denton-probate-2');
  assert.equal(classify('COUNTY CONSTABLE PRECINCT 3, UNEXPIRED TERM', 'brazoria').id, 'brazoria-constable-3');
  assert.equal(classify('SHERIFF, UNEXPIRED TERM', 'x').id, 'x-sheriff');
  assert.equal(classify('JUSTICE, 7TH COURT OF APPEALS DISTRICT, PLACE 2 - UNEXPIREDParty TERM', 'potter').id, 'coa7-2');
  assert.equal(classify('HARRIS COUNTY DEPARTMENT OF EDUCATION, PLACE 5', 'harris').id, 'harris-dept-education-5');
  assert.equal(classify('COUNTY SURVEYOR', 'kaufman').id, 'kaufman-surveyor');
});

test('capitalizes nicknames in quotes or parentheses', () => {
  assert.equal(nameCase('ARTURO A. (ART) MCDONALD, JR'), 'Arturo A. (Art) McDonald, Jr');
  assert.equal(nameCase('MARICELA "MARI" DE LEON'), 'Maricela "Mari" De Leon');
});
