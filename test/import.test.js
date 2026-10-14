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
  assert.deepEqual(r.races.map((x) => x.heading), ['GOVERNOR', 'JUSTICE OF THE PEACE PRECINCT 1, PLACE 2', 'MEMBER, STATE BOARD OF EDUCATION, DISTRICT 7']);
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
