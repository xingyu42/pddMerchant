import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { metricTable, ratioPct, sumKnown } from '../../src/infra/metrics.js';

describe('metric facts', () => {
  const table = metricTable([
    ['item_count', 'count', 'count'], ['amount_yuan', 'yuan', 'yuan'], ['spend_yuan', 'fen', 'fen'],
    ['rate_pct', 'ratio', 'ratio'], ['response_seconds', 'seconds', 'seconds'],
  ]);

  it('converts all declared kinds and preserves the field order', () => {
    const view = table.project({ count: '2', yuan: '1.005', fen: '123', ratio: '0.12345', seconds: '14.666' });
    assert.deepEqual(view, { item_count: 2, amount_yuan: 1.01, spend_yuan: 1.23, rate_pct: 12.35, response_seconds: 14.67 });
    assert.deepEqual(Object.keys(view), table.fields);
    assert.ok(Object.isFrozen(table.entries[0]));
  });

  it.each([undefined, null, '', false, NaN, Infinity, 'invalid'])('propagates missing or invalid input %s', (value) => {
    const raw = Object.fromEntries(table.entries.map(([, field]) => [field, value]));
    assert.deepEqual(Object.values(table.project(raw)), [null, null, null, null, null]);
  });

  it('preserves explicit zeros and applies peer suffixes without changing conversion', () => {
    assert.deepEqual(Object.values(table.project({ count: 0, yuan: 0, fen: 0, ratio: 0, seconds: 0 })), [0, 0, 0, 0, 0]);
    const view = table.project({ ratioPeer: 0.125 }, { keySuffix: '_peer_avg', fieldSuffix: 'Peer' });
    assert.equal(view.rate_pct_peer_avg, 12.5);
  });

  it('sums known observations, preserves the empty additive identity, and propagates unknowns', () => {
    assert.equal(sumKnown([]), 0);
    assert.equal(sumKnown([0, '2', -1]), 1);
    for (const value of [undefined, null, NaN, Infinity, false, '']) assert.equal(sumKnown([1, value, 2]), null);
  });

  it('computes percentages with null propagation and a zero-denominator guard', () => {
    assert.equal(ratioPct(1, 3), 33.33);
    assert.equal(ratioPct(-1, 4), -25);
    assert.equal(ratioPct(0, 4), 0);
    for (const [top, bottom] of [[null, 4], [undefined, 4], [1, null], [1, 0], [Infinity, 1]]) {
      assert.equal(ratioPct(top, bottom), null);
    }
  });
});
