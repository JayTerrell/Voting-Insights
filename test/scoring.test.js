import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compare, scoreAll, PRIOR_WEIGHT } from '../public/js/scoring.js';

test('identical answers approach 100 and opposite answers approach 0', () => {
  const answers = {}, same = {}, opposite = {};
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
        id: 'gov', title: 'Governor', office_type: 'governor', group: 'state',
        candidates: [
          { id: 'a', name: 'A', party: 'Republican', stances: { x: { position: 2, basis: 'record' }, y: { position: -2, basis: 'record' } } },
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
