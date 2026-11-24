import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { beforeEach, describe, it } from 'vitest';
import { run as updateStatus } from '../../src/commands/goods/update/status.js';
import { run as updatePrice } from '../../src/commands/goods/update/price.js';
import { run as updateStock } from '../../src/commands/goods/update/stock.js';
import { run as updateTitle } from '../../src/commands/goods/update/title.js';
import { run as updateBatch } from '../../src/commands/goods/update/batch.js';
import { saveAuthStateSnapshot } from '../../src/adapter/auth-state.js';
import { insertAccount } from '../../src/infra/account-store.js';
import { PddCliError } from '../../src/infra/errors.js';
import { composeCommandRuntime } from '../../src/runtime/command-runtime.js';
import { runtimeConfig } from '../helpers/isolated-cli.js';
import {
  createInMemoryAuthPort,
  createInMemoryBrowserRuntime,
  createInMemoryMallPort,
} from '../helpers/in-memory-ports.js';
import { createMemoryEndpointTransport } from '../helpers/test-ctx.js';

function makeMemoryStreams() {
  const stdoutChunks = [];
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  stdout.on('data', (chunk) => stdoutChunks.push(chunk.toString('utf8')));
  return {
    streams: { stdout, stderr },
    readStdout: () => stdoutChunks.join(''),
  };
}

let transport;
beforeEach(() => {
  const account = insertAccount({ identity: '900001', displayName: 'Synthetic Shop' }, { setDefault: true });
  saveAuthStateSnapshot({ cookies: [{ name: 'PASS_ID', value: 'synthetic' }], origins: [] }, account.id);
  transport = createMemoryEndpointTransport(async () => ({ success: true, fail_goods_num: 0 }));
});

async function createRuntime(streams) {
  return composeCommandRuntime({
    mode: 'live',
    runtimeConfigPolicy: 'maintenance',
    env: {},
    streams,
    overrides: {
      browser: createInMemoryBrowserRuntime(),
      mall: createInMemoryMallPort({ currentMall: { id: '900001', name: 'Synthetic Shop' } }),
      auth: createInMemoryAuthPort({ merchantIdentity: { mallId: '900001', displayName: 'Synthetic Shop' } }),
      endpointTransport: transport,
      runtimeConfig,
    },
  });
}

async function invoke(run, opts) {
  const { streams, readStdout } = makeMemoryStreams();
  const runtime = await createRuntime(streams);
  let envelope;
  try {
    envelope = await run({
      json: true, timeoutMs: 2000, ...opts,
    }, { runtime });
    assert.equal(runtime.outputSink.hasEmitted(), true);
  } finally {
    await runtime.closeAll();
  }
  const lines = readStdout().trim().split(/\r?\n/);
  assert.equal(lines.length, 1);
  assert.deepEqual(JSON.parse(lines[0]), envelope);
  return envelope;
}

const singleWrites = [
  { field: 'status', echoField: 'status', run: updateStatus, opts: { status: 'offline' }, value: '下架',
    payload: { goods_id: 101, status: 'offline' }, invalid: { status: 'unknown' },
    dryHeadline: '预演：商品 101 将下架，未提交', doneHeadline: '已提交：商品 101 下架' },
  { field: 'price', echoField: 'price_yuan', run: updatePrice, opts: { priceYuan: '29.9', skuId: 'sku-101' }, value: 29.9,
    payload: { goods_id: 101, price: 2990, sku_id: 'sku-101' }, invalid: { priceYuan: '0' },
    dryHeadline: '预演：商品 101（SKU sku-101） 价格将改为 29.90 元，未提交',
    doneHeadline: '已提交：商品 101（SKU sku-101） 价格改为 29.90 元' },
  { field: 'stock', echoField: 'stock', run: updateStock, opts: { quantity: '0', skuId: 'sku-101' }, value: 0,
    payload: { goods_id: 101, quantity: 0, sku_id: 'sku-101' }, invalid: { quantity: -1 },
    dryHeadline: '预演：商品 101（SKU sku-101） 库存将改为 0，未提交',
    doneHeadline: '已提交：商品 101（SKU sku-101） 库存改为 0' },
  { field: 'title', echoField: 'title', run: updateTitle, opts: { title: '  Synthetic Tea  ' }, value: 'Synthetic Tea',
    payload: { goods_id: 101, title: 'Synthetic Tea' }, invalid: { title: '   ' },
    dryHeadline: '预演：商品 101 标题将改为「Synthetic Tea」，未提交',
    doneHeadline: '已提交：商品 101 标题改为「Synthetic Tea」' },
];

describe('single goods write commands', () => {
  it.each(singleWrites)('$field plans a normalized change without dispatch when unconfirmed', async ({ field, echoField, run, opts, value, dryHeadline }) => {
    const envelope = await invoke(run, { goodsId: '101', ...opts });
    assert.equal(envelope.ok, true);
    assert.equal(envelope.command, `goods.update.${field}`);
    assert.deepEqual(envelope.data, {
      headline: [dryHeadline], goods_id: '101', field: echoField, value,
      ...('skuId' in opts ? { sku_id: opts.skuId } : {}),
      dry_run: true, mall_id: '900001',
    });
    assert.equal(envelope.meta.xhr_count, 0);
    assert.equal(envelope.meta.exit_code, 0);
    assert.equal(transport.calls.length, 0);
  });

  it.each(singleWrites)('$field dispatches once only after confirmation', async ({ field, run, opts, value, payload, doneHeadline }) => {
    const envelope = await invoke(run, { goodsId: '101', ...opts, confirm: true });
    assert.equal(envelope.ok, true);
    assert.equal(envelope.data.value, value);
    assert.equal(envelope.data.dry_run, false);
    assert.deepEqual(envelope.data.headline, [doneHeadline]);
    assert.deepEqual(envelope.data.result, { success: true, failed_count: ['price', 'stock'].includes(field) ? 0 : null });
    if ('skuId' in opts) assert.equal(envelope.data.sku_id, opts.skuId);
    assert.equal(envelope.meta.xhr_count, 1);
    assert.equal(envelope.meta.exit_code, 0);
    assert.equal(transport.calls.length, 1);
    assert.equal(transport.calls[0].name, `goods.update.${field}`);
    assert.deepEqual(transport.calls[0].params, payload);
  });

  it.each(singleWrites)('$field returns a usage envelope without dispatch for invalid input', async ({ run, opts, invalid }) => {
    const envelope = await invoke(run, { goodsId: '101', ...opts, ...invalid, confirm: true });
    assert.equal(envelope.ok, false);
    assert.equal(envelope.error.code, 'E_USAGE');
    assert.equal(envelope.meta.exit_code, 2);
    assert.equal(transport.calls.length, 0);
  });

  it.each([...singleWrites, { field: 'batch', run: updateBatch }])('$field rejects all-account writes before dispatch', async ({ run }) => {
    const { streams, readStdout } = makeMemoryStreams();
    const runtime = await createRuntime(streams);
    try {
      assert.throws(() => run({ allAccounts: true, confirm: true }, { runtime }),
        (error) => error.code === 'E_USAGE' && error.exitCode === 2);
      assert.equal(transport.calls.length, 0);
      assert.equal(runtime.outputSink.hasEmitted(), false);
      assert.equal(readStdout(), '');
    } finally {
      await runtime.closeAll();
    }
  });
});

describe('price input in yuan', () => {
  it.each([
    ['zero', '0'], ['negative', '-1'], ['three decimals', '29.999'], ['non-numeric', 'abc'], ['missing', undefined],
  ])('rejects %s price_yuan before dispatch', async (_label, priceYuan) => {
    const envelope = await invoke(updatePrice, { goodsId: '101', priceYuan, confirm: true });
    assert.equal(envelope.ok, false);
    assert.equal(envelope.error.code, 'E_USAGE');
    assert.equal(envelope.error.hint, '单位为元，例如 29.9');
    assert.equal(envelope.meta.exit_code, 2);
    assert.equal(transport.calls.length, 0);
  });

  it('never treats the removed cents option as a price', async () => {
    const envelope = await invoke(updatePrice, { goodsId: '101', price: '2999', confirm: true });
    assert.equal(envelope.error.code, 'E_USAGE');
    assert.equal(transport.calls.length, 0);
  });

  it.each([['0.01', 1, 0.01], ['19.99', 1999, 19.99], ['100', 10000, 100]])('submits %s yuan as %i fen', async (priceYuan, fen, echo) => {
    const envelope = await invoke(updatePrice, { goodsId: '101', priceYuan, confirm: true });
    assert.equal(envelope.data.value, echo);
    assert.equal(transport.calls[0].params.price, fen);
  });
});

describe('batch goods write command', () => {
  const changes = [
    { goods_id: '101', field: 'price_yuan', value: 19.99 },
    { goods_id: 102, field: 'stock', value: 0 },
    { goods_id: 103, field: 'title', value: 'Synthetic Cup' },
  ];

  it('returns the whole plan without dispatch when confirmation is absent', async () => {
    const envelope = await invoke(updateBatch, { changes: JSON.stringify(changes) });
    assert.equal(envelope.ok, true);
    assert.deepEqual(envelope.data, {
      headline: ['预演：共 3 项商品修改，未提交'],
      planned: [
        { goods_id: '101', field: 'price_yuan', value: 19.99, sku_id: null },
        { goods_id: '102', field: 'stock', value: 0, sku_id: null },
        { goods_id: '103', field: 'title', value: 'Synthetic Cup' },
      ],
      count: 3, dry_run: true, mall_id: '900001',
    });
    assert.equal(envelope.meta.xhr_count, 0);
    assert.equal(transport.calls.length, 0);
  });

  it('submits batch price_yuan as fen', async () => {
    const envelope = await invoke(updateBatch, {
      changes: JSON.stringify([{ goods_id: 101, field: 'price_yuan', value: 29.9 }, { goods_id: 102, field: 'price_yuan', value: '0.01' }]),
      confirm: true,
    });
    assert.equal(envelope.ok, true);
    assert.deepEqual(transport.calls.map(({ params }) => params.price), [2990, 1]);
  });

  it.each([
    { label: 'malformed JSON', value: '[' },
    { label: 'non-array', value: '{}' },
    { label: 'empty array', value: '[]' },
    { label: 'non-object item', value: JSON.stringify([changes[0], null]) },
    { label: 'unsupported field', value: JSON.stringify([changes[0], { goods_id: 102, field: 'unknown', value: 1 }]) },
    { label: 'late invalid ID', value: JSON.stringify([changes[0], { goods_id: 0, field: 'stock', value: 1 }]) },
    { label: 'late invalid value', value: JSON.stringify([changes[0], { goods_id: 102, field: 'price_yuan', value: 0 }]) },
    { label: 'removed cents field', value: JSON.stringify([{ goods_id: 101, field: 'price', value: 2999 }]) },
    { label: 'price with three decimals', value: JSON.stringify([{ goods_id: 101, field: 'price_yuan', value: 29.999 }]) },
  ])('rejects $label before making even the first write', async ({ value }) => {
    const envelope = await invoke(updateBatch, { changes: value, confirm: true });
    assert.equal(envelope.ok, false);
    assert.equal(envelope.error.code, 'E_USAGE');
    assert.equal(envelope.meta.exit_code, 2);
    assert.equal(transport.calls.length, 0);
  });

  it.each([
    { label: 'all success', failures: [], exit: 0 },
    { label: 'failure then continuation', failures: [102], exit: 7 },
    { label: 'all failure', failures: [101, 102, 103], exit: 6 },
  ])('preserves ordered results for $label', async ({ failures, exit }) => {
    let inFlight = 0;
    let peakInFlight = 0;
    transport.setHandler(async (_spec, params) => {
      inFlight += 1;
      peakInFlight = Math.max(peakInFlight, inFlight);
      try {
        await Promise.resolve();
        if (failures.includes(params.goods_id)) {
          throw new PddCliError({ code: 'E_BUSINESS', message: 'Synthetic rejection', exitCode: 6 });
        }
        return { success: true };
      } finally {
        inFlight -= 1;
      }
    });
    const envelope = await invoke(updateBatch, { changes: JSON.stringify(changes), confirm: true });
    assert.equal(envelope.ok, true);
    assert.equal(envelope.error, null);
    assert.deepEqual(envelope.data, {
      headline: [`已提交 3 项商品修改：成功 ${3 - failures.length} 项，失败 ${failures.length} 项`],
      succeeded: 3 - failures.length, failed: failures.length,
      results: changes.map((item) => ({
        goods_id: String(item.goods_id), field: item.field,
        ...(failures.includes(Number(item.goods_id))
          ? { ok: false, error_code: 'E_BUSINESS', message: 'Synthetic rejection' }
          : { ok: true }),
      })),
      dry_run: false, mall_id: '900001',
    });
    assert.equal(envelope.meta.exit_code, exit);
    assert.equal(envelope.meta.xhr_count, 3);
    assert.equal(peakInFlight, 1, 'Batch writes must complete one at a time');
    assert.deepEqual(transport.calls.map(({ name, params }) => [name, params.goods_id]), [
      ['goods.update.price', 101], ['goods.update.stock', 102], ['goods.update.title', 103],
    ]);
  });
});
