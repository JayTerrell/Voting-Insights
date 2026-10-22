import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compare, scoreAll, PRIOR_WEIGHT, choices, positionLabel, abValue, sideValue, scaleStep } from '../shared/scoring.js';

test('identical answers approach 100 and opposite answers approach 0', () => {
  const answers = {},
    same = {},
    opposite = {};
  for (let i = 0; i < 20; i++) {
    answers['q' + i] = { value: 2, weight: 1 };
    same['q' + i] = { position: 2, basis: 'record' };
    opposite['q' + i] = { position: -2, basis: 'record' };
  }
  assert.ok(compare(answers, same).score >= 95);
  assert.ok(compare(answers, opposite).score <= 5);
});

test('a single documented answer is pulled toward 50 by the prior', () => {
  const r = compare({ a: { value: 2, weight: 1 } }, { a: { position: 2, basis: 'record' } });
  assert.equal(r.score, Math.round(((1 + 0.5 * PRIOR_WEIGHT) / (1 + PRIOR_WEIGHT)) * 100));
  assert.equal(r.limited, true);
});

test('no overlap yields a null score', () => {
  assert.equal(compare({ a: { value: 1, weight: 1 } }, { b: { position: 1, basis: 'record' } }).score, null);
});

test('importance weights change the result', () => {
  const stances = { a: { position: 2, basis: 'record' }, b: { position: -2, basis: 'record' } };
  const lo = compare({ a: { value: 2, weight: 0.5 }, b: { value: 2, weight: 2 } }, stances).score;
  const hi = compare({ a: { value: 2, weight: 2 }, b: { value: 2, weight: 0.5 } }, stances).score;
  assert.ok(hi > lo);
});

test('race scoring only uses questions tied to the office', () => {
  const guide = {
    questions: [
      { id: 'x', offices: ['governor'] },
      { id: 'y', offices: ['judicial'] },
    ],
    parties: [],
    races: [
      {
        id: 'gov',
        title: 'Governor',
        office_type: 'governor',
        group: 'state',
        statewide: true,
        candidates: [
          {
            id: 'a',
            name: 'A',
            party: 'Republican',
            stances: { x: { position: 2, basis: 'record' }, y: { position: -2, basis: 'record' } },
          },
          { id: 'b', name: 'B', party: 'Democratic', stances: { x: { position: -2, basis: 'record' } } },
        ],
      },
    ],
  };
  const res = scoreAll({ x: { value: 2, weight: 1 }, y: { value: 2, weight: 1 } }, guide);
  const race = res.races[0];
  assert.equal(race.top, 'a');
  assert.equal(race.candidates[0].overlap, 1);
});

test('county ballots select races, and other counties fall back to statewide races', () => {
  const guide = {
    questions: [{ id: 'x', offices: ['governor', 'county_judge'] }],
    parties: [],
    ballots: { Collin: ['local', 'gov'] },
    races: [
      { id: 'gov', title: 'Governor', office_type: 'governor', group: 'state', statewide: true, candidates: [] },
      {
        id: 'local',
        title: 'County Judge',
        office_type: 'county_judge',
        group: 'county',
        statewide: false,
        county: 'Collin',
        candidates: [],
      },
    ],
  };
  const answers = { x: { value: 1, weight: 1 } };
  assert.deepEqual(
    scoreAll(answers, guide, 'Collin').races.map((r) => r.id),
    ['local', 'gov']
  );
  const other = scoreAll(answers, guide, 'Travis');
  assert.deepEqual(
    other.races.map((r) => r.id),
    ['gov']
  );
  assert.equal(other.full_ballot, false);
});

test('every question offers two views and maps them onto the stored scale', () => {
  const questions = JSON.parse(readFileSync(new URL('../data/questions.json', import.meta.url), 'utf8'));
  for (const q of questions) {
    for (const k of ['prompt', 'a', 'b', 'a_short', 'b_short', 'context']) assert.ok(q[k]?.trim(), `${q.id} needs ${k}`);
    assert.ok(['a', 'b'].includes(q.agree), `${q.id} agree names a side`);
    assert.doesNotMatch(JSON.stringify(q), /[–—]/, `${q.id} has no dashes`);
    const values = choices(q).map((c) => c.value);
    assert.deepEqual([...values].sort(), [-1, -2, 0, 1, 2], `${q.id} offers all five values`);
    // The strong end of the side named by agree is +2, and the labels say so.
    assert.equal(choices(q).find((c) => c.label === `Strongly ${q.agree.toUpperCase()}`).value, 2);
    assert.match(positionLabel(2, q), new RegExp(`^Strongly ${q.agree.toUpperCase()}: `));
    assert.equal(positionLabel(0, q), 'In between or mixed');
    // On the explanation scale, A is always negative and B positive.
    assert.equal(abValue(sideValue(q, 'a', 2), q), -2);
    assert.equal(abValue(sideValue(q, 'b', 1), q), 1);
    assert.equal(scaleStep(sideValue(q, 'a', 2), q), 0);
    assert.equal(scaleStep(sideValue(q, 'b', 2), q), 4);
  }
});
