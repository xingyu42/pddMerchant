import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it, vi } from 'vitest';
import { run as updateStatus } from '../../src/commands/goods/update/status.js';
import { run as updatePrice } from '../../src/commands/goods/update/price.js';
import { run as updateStock } from '../../src/commands/goods/update/stock.js';
import { run as updateTitle } from '../../src/commands/goods/update/title.js';
import { run as updateBatch } from '../../src/commands/goods/update/batch.js';
import { clearFixtureCache } from '../../src/adapter/mock-dispatcher.js';
import { PddCliError } from '../../src/infra/errors.js';
import { createCliSandbox, runtimeConfig } from '../helpers/isolated-cli.js';

const { dispatch, emitSpy } = vi.hoisted(() => ({ dispatch: vi.fn(), emitSpy: vi.fn() }));
vi.mock('../../src/adapter/mock-dispatcher.js', async (importOriginal) => ({
  ...await importOriginal(), mockRunEndpoint: dispatch,
}));
vi.mock('../../src/infra/output.js', async (importOriginal) => ({
  ...await importOriginal(), emit: emitSpy,
}));

let sandbox;
beforeEach(() => {
  sandbox = createCliSandbox();
  for (const [key, value] of Object.entries(sandbox.env)) {
    if (key.startsWith('PDD_')) vi.stubEnv(key, value);
  }
  clearFixtureCache();
  dispatch.mockReset().mockImplementation(async (spec) => ({ receipt: spec.name }));
  emitSpy.mockClear();
});
afterEach(() => {
  clearFixtureCache();
  sandbox?.dispose();
});

async function invoke(run, opts) {
  const envelope = await run({
    json: true, authStatePath: sandbox.env.PDD_AUTH_STATE_PATH, timeoutMs: 2000, ...opts,
  }, { runtimeConfig });
  assert.equal(emitSpy.mock.calls.length, 1);
  assert.equal(emitSpy.mock.calls[0][0], envelope);
  return envelope;
}

const singleWrites = [
  { field: 'status', run: updateStatus, opts: { status: 'offline' }, value: 'offline',
    payload: { goods_id: 101, status: 'offline' }, invalid: { status: 'unknown' } },
  { field: 'price', run: updatePrice, opts: { price: '1999', skuId: 'sku-101' }, value: 1999,
    payload: { goods_id: 101, price: 1999, sku_id: 'sku-101' }, invalid: { price: 0 } },
  { field: 'stock', run: updateStock, opts: { quantity: '0', skuId: 'sku-101' }, value: 0,
    payload: { goods_id: 101, quantity: 0, sku_id: 'sku-101' }, invalid: { quantity: -1 } },
  { field: 'title', run: updateTitle, opts: { title: '  Synthetic Tea  ' }, value: 'Synthetic Tea',
    payload: { goods_id: 101, title: 'Synthetic Tea' }, invalid: { title: '   ' } },
];

describe('single goods write commands', () => {
  it.each(singleWrites)('$field plans a normalized change without dispatch when unconfirmed', async ({ field, run, opts, value }) => {
    const envelope = await invoke(run, { goodsId: '101', ...opts });
    assert.equal(envelope.ok, true);
    assert.equal(envelope.command, `goods.update.${field}`);
    assert.deepEqual(envelope.data, {
      goods_id: 101, field, value, dry_run: true,
      ...('skuId' in opts ? { sku_id: opts.skuId } : {}),
    });
    assert.equal(envelope.meta.xhr_count, 0);
    assert.equal(envelope.meta.exit_code, 0);
    assert.equal(dispatch.mock.calls.length, 0);
  });

  it.each(singleWrites)('$field dispatches once only after confirmation', async ({ field, run, opts, value, payload }) => {
    const envelope = await invoke(run, { goodsId: '101', ...opts, confirm: true });
    assert.equal(envelope.ok, true);
    assert.equal(envelope.data.value, value);
    assert.equal(envelope.data.dry_run, false);
    assert.deepEqual(envelope.data.result, { receipt: `goods.update.${field}` });
    if ('skuId' in opts) assert.equal(envelope.data.sku_id, opts.skuId);
    assert.equal(envelope.meta.confirm, true);
    assert.equal(envelope.meta.xhr_count, 1);
    assert.equal(envelope.meta.exit_code, 0);
    assert.equal(dispatch.mock.calls.length, 1);
    assert.equal(dispatch.mock.calls[0][0].name, `goods.update.${field}`);
    assert.deepEqual(dispatch.mock.calls[0][1], payload);
  });

  it.each(singleWrites)('$field returns a usage envelope without dispatch for invalid input', async ({ run, opts, invalid }) => {
    const envelope = await invoke(run, { goodsId: '101', ...opts, ...invalid, confirm: true });
    assert.equal(envelope.ok, false);
    assert.equal(envelope.error.code, 'E_USAGE');
    assert.equal(envelope.meta.exit_code, 2);
    assert.equal(dispatch.mock.calls.length, 0);
  });

  it.each([...singleWrites, { field: 'batch', run: updateBatch }])('$field rejects all-account writes before dispatch', ({ run }) => {
    assert.throws(() => run({ allAccounts: true, confirm: true }, { runtimeConfig }),
      (error) => error.code === 'E_USAGE' && error.exitCode === 2);
    assert.equal(dispatch.mock.calls.length, 0);
    assert.equal(emitSpy.mock.calls.length, 0);
  });
});

describe('batch goods write command', () => {
  const changes = [
    { goods_id: '101', field: 'price', value: 1999 },
    { goods_id: 102, field: 'stock', value: 0 },
    { goods_id: 103, field: 'title', value: 'Synthetic Cup' },
  ];

  it('returns the whole plan without dispatch when confirmation is absent', async () => {
    const envelope = await invoke(updateBatch, { changes: JSON.stringify(changes) });
    assert.equal(envelope.ok, true);
    assert.deepEqual(envelope.data, {
      planned: changes.map((item) => ({ ...item, goods_id: Number(item.goods_id) })),
      count: 3, dry_run: true,
    });
    assert.equal(envelope.meta.xhr_count, 0);
    assert.equal(dispatch.mock.calls.length, 0);
  });

  it.each([
    { label: 'malformed JSON', value: '[' },
    { label: 'non-array', value: '{}' },
    { label: 'empty array', value: '[]' },
    { label: 'non-object item', value: JSON.stringify([changes[0], null]) },
    { label: 'unsupported field', value: JSON.stringify([changes[0], { goods_id: 102, field: 'unknown', value: 1 }]) },
    { label: 'late invalid ID', value: JSON.stringify([changes[0], { goods_id: 0, field: 'stock', value: 1 }]) },
    { label: 'late invalid value', value: JSON.stringify([changes[0], { goods_id: 102, field: 'price', value: 0 }]) },
  ])('rejects $label before making even the first write', async ({ value }) => {
    const envelope = await invoke(updateBatch, { changes: value, confirm: true });
    assert.equal(envelope.ok, false);
    assert.equal(envelope.error.code, 'E_USAGE');
    assert.equal(envelope.meta.exit_code, 2);
    assert.equal(dispatch.mock.calls.length, 0);
  });

  it.each([
    { label: 'all success', failures: [], exit: 0 },
    { label: 'failure then continuation', failures: [102], exit: 7 },
    { label: 'all failure', failures: [101, 102, 103], exit: 6 },
  ])('preserves ordered results for $label', async ({ failures, exit }) => {
    let inFlight = 0;
    let peakInFlight = 0;
    dispatch.mockImplementation(async (_spec, payload) => {
      inFlight += 1;
      peakInFlight = Math.max(peakInFlight, inFlight);
      try {
        await Promise.resolve();
        if (failures.includes(payload.goods_id)) {
          throw new PddCliError({ code: 'E_BUSINESS', message: 'Synthetic rejection', exitCode: 6 });
        }
        return { accepted: true };
      } finally {
        inFlight -= 1;
      }
    });
    const envelope = await invoke(updateBatch, { changes: JSON.stringify(changes), confirm: true });
    assert.equal(envelope.ok, true);
    assert.equal(envelope.error, null);
    assert.deepEqual(envelope.data, {
      succeeded: 3 - failures.length, failed: failures.length, dry_run: false,
      results: changes.map((item) => ({
        goods_id: Number(item.goods_id), field: item.field,
        ...(failures.includes(Number(item.goods_id))
          ? { ok: false, error: 'E_BUSINESS', message: 'Synthetic rejection' }
          : { ok: true }),
      })),
    });
    assert.equal(envelope.meta.exit_code, exit);
    assert.equal(envelope.meta.xhr_count, 3);
    assert.equal(envelope.meta.confirm, true);
    assert.equal(peakInFlight, 1, 'Batch writes must complete one at a time');
    assert.deepEqual(dispatch.mock.calls.map(([spec, payload]) => [spec.name, payload.goods_id]), [
      ['goods.update.price', 101], ['goods.update.stock', 102], ['goods.update.title', 103],
    ]);
  });
});
