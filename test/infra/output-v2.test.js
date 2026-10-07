import { describe, it, vi } from 'vitest';
import assert from 'node:assert/strict';
import { buildBatchEnvelope, buildEnvelope, emit, ENVELOPE_VERSION } from '../../src/infra/output.js';
import { errorToEnvelope, PddCliError } from '../../src/infra/errors.js';

function captureHumanOutput(envelope) {
  const writes = [];
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => { writes.push(String(chunk)); return true; });
  emit(envelope, { noColor: true, tty: false });
  vi.restoreAllMocks();
  return writes.join('').split('\n');
}

describe('envelope version', () => {
  it('is 2 for single, batch and error envelopes', () => {
    assert.equal(ENVELOPE_VERSION, 2);
    assert.equal(buildEnvelope({ ok: true, command: 'x', data: {} }).meta.v, 2);
    assert.equal(buildBatchEnvelope('x', { a: { ok: true, data: {} } }).meta.v, 2);
    assert.equal(errorToEnvelope('x', new PddCliError({ code: 'E_USAGE', message: 'bad' })).meta.v, 2);
  });

  it('cannot be overridden by caller meta', () => {
    assert.equal(buildEnvelope({ ok: true, command: 'x', data: {}, meta: { v: 1 } }).meta.v, 2);
  });
});

describe('human rendering', () => {
  it('prints headline lines first, then items as rows and remaining keys as key/value', () => {
    const lines = captureHumanOutput({
      ok: true,
      command: 'orders.list',
      data: {
        headline: ['近 7 天共 2 单', '待发货 1 单'],
        items: [{ order_sn: 'A1', status: '待发货' }, { order_sn: 'B2', paid_amount_yuan: 1.5 }],
        total: 2,
      },
    });
    assert.equal(lines[0], 'OK  orders.list');
    assert.deepEqual(lines.slice(1, 3), ['近 7 天共 2 单', '待发货 1 单']);
    const body = lines.join('\n');
    assert.match(body, /paid_amount_yuan/);
    assert.match(body, /total/);
    assert.doesNotMatch(body, /headline|"order_sn"/);
  });

  it('keeps the key/value table for objects without headline or items', () => {
    const body = captureHumanOutput({ ok: true, command: 'x', data: { a: 1 } }).join('\n');
    assert.match(body, /key/);
    assert.match(body, /value/);
  });
});
