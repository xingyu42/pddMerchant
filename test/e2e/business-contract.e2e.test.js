import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { runCli } from '../helpers/isolated-cli.js';
import { assertRedacted } from '../helpers/envelope-assertions.js';
import { GOODS_LIST } from '../../src/adapter/endpoints/goods.js';

describe('offline CLI envelopes and process exits', () => {
  it('routes the requested order page and emits one successful JSON envelope', () => {
    const { status, envelope } = runCli(['orders', 'list', '--page', '2'], { fixtures: {
      'endpoints/orders.list.json': { total: 2, orders: [{ order_sn: 'SYN-PAGE-1' }] },
      'endpoints/orders.list.page2.json': { total: 2, orders: [{ order_sn: 'SYN-PAGE-2' }] },
    } });
    assert.equal(status, 0);
    assert.equal(envelope.ok, true);
    assert.equal(envelope.command, 'orders.list');
    assert.equal(envelope.error, null);
    assert.equal(envelope.data.total, 2);
    assert.deepEqual(envelope.data.orders, [{ order_sn: 'SYN-PAGE-2' }]);
    assert.equal(envelope.data.mall_id, '900001');
  });

  it('preserves an actual empty order result', () => {
    const { status, envelope } = runCli(['orders', 'list'], { fixtures: {
      'endpoints/orders.list.json': { total: 0, orders: [] },
    } });
    assert.equal(status, 0);
    assert.equal(envelope.data.total, 0);
    assert.deepEqual(envelope.data.orders, []);
  });

  it('returns usage exit 2 for missing required order identity', () => {
    const { status, envelope } = runCli(['orders', 'detail']);
    assert.equal(status, 2);
    assert.equal(envelope.ok, false);
    assert.equal(envelope.error.code, 'E_USAGE');
    assert.equal(envelope.data, null);
  });

  it('returns auth exit 3 before trying to load an endpoint fixture', () => {
    const { status, envelope } = runCli(['orders', 'list'], { authInvalid: true });
    assert.equal(status, 3);
    assert.equal(envelope.ok, false);
    assert.equal(envelope.error.code, 'E_AUTH_EXPIRED');
    assert.equal(envelope.data, null);
  });

  it.each([
    { code: 'E_RATE_LIMIT', exit: 4 },
    { code: 'E_NETWORK', exit: 5 },
    { code: 'E_BUSINESS', exit: 6 },
  ])('preserves $code from the endpoint boundary through process exit', ({ code, exit }) => {
    const { status, envelope } = runCli(['orders', 'list'], { fixtures: {
      'endpoints/orders.list.json': {
        __throws: true, __error: { code, exitCode: exit, message: 'Synthetic endpoint failure' },
      },
    } });
    assert.equal(status, exit);
    assert.equal(envelope.ok, false);
    assert.equal(envelope.command, 'orders.list');
    assert.equal(envelope.error.code, code);
    assert.equal(envelope.error.message, 'Synthetic endpoint failure');
    assert.equal(envelope.data, null);
  });

  it('redacts nested synthetic secrets and removes raw data without removing public fields', () => {
    const { status, stdout, envelope } = runCli(['orders', 'detail', '--sn', 'SYN-DETAIL'], { fixtures: {
      'endpoints/orders.detail.json': { order: {
        orderSn: 'SYN-DETAIL', receiver_phone: 'SYNTHETIC-PHONE',
        receiver_name: 'SYNTHETIC-RECEIVER', raw: { hidden: 'SYNTHETIC-RAW' },
        items: [{ goods_id: 101, authorization: 'SYNTHETIC-AUTH', raw: { hidden: 'SYNTHETIC-NESTED-RAW' } }],
      } },
    } });
    assert.equal(status, 0);
    assert.equal(envelope.data.order.orderSn, 'SYN-DETAIL');
    assert.equal(envelope.data.order.items[0].goods_id, 101);
    for (const value of [envelope.data.order.receiver_phone, envelope.data.order.receiver_name, envelope.data.order.items[0].authorization]) {
      assert.match(value, /^fp:[a-f0-9]{8}$/);
    }
    assert.equal(Object.hasOwn(envelope.data.order, 'raw'), false);
    assert.equal(Object.hasOwn(envelope.data.order.items[0], 'raw'), false);
    assertRedacted(stdout, ['SYNTHETIC-PHONE', 'SYNTHETIC-RECEIVER', 'SYNTHETIC-AUTH', 'SYNTHETIC-RAW', 'SYNTHETIC-NESTED-RAW']);
  });

  it('applies the same redaction and raw stripping to error details', () => {
    const { status, stdout, envelope } = runCli(['orders', 'list'], { fixtures: {
      'endpoints/orders.list.json': { __throws: true, __error: {
        code: 'E_BUSINESS', exitCode: 6, message: 'Synthetic rejection', detail: {
          reason: 'synthetic', authorization: 'SYNTHETIC-ERROR-AUTH',
          nested: { receiver_phone: 'SYNTHETIC-ERROR-PHONE', raw: { hidden: 'SYNTHETIC-ERROR-RAW' } },
        },
      } },
    } });
    assert.equal(status, 6);
    assert.equal(envelope.error.detail.reason, 'synthetic');
    assert.match(envelope.error.detail.authorization, /^fp:[a-f0-9]{8}$/);
    assert.match(envelope.error.detail.nested.receiver_phone, /^fp:[a-f0-9]{8}$/);
    assert.equal(Object.hasOwn(envelope.error.detail.nested, 'raw'), false);
    assertRedacted(stdout, ['SYNTHETIC-ERROR-AUTH', 'SYNTHETIC-ERROR-PHONE', 'SYNTHETIC-ERROR-RAW']);
  });

  it('emits upstream goods id in the list JSON envelope', () => {
    // Fixture mode returns normalized data, so explicitly exercise the real normalizer first.
    const goods = GOODS_LIST.normalize({ success: true, result: {
      total: 1, goods_list: [{ id: 673183509913, goods_name: 'Synthetic', quantity: 10 }],
    } });
    const { status, envelope } = runCli(['goods', 'list'], { fixtures: {
      'endpoints/goods.list.json': goods,
    } });
    assert.equal(status, 0);
    assert.equal(envelope.command, 'goods.list');
    assert.equal(envelope.meta.total, 1);
    assert.equal(envelope.data[0].goods_id, 673183509913);
  });

  it('plans a price change without any write fixture or confirmation', () => {
    const { status, envelope } = runCli(['goods', 'update', 'price', '--goods-id', '101', '--price', '1999', '--sku-id', 'sku-101']);
    assert.equal(status, 0);
    assert.deepEqual(envelope.data, { goods_id: 101, field: 'price', value: 1999, sku_id: 'sku-101', dry_run: true });
    assert.equal(envelope.meta.xhr_count, 0);
  });

  it('routes --confirm through the write service and preserves its receipt', () => {
    const { status, envelope } = runCli(['goods', 'update', 'price', '--goods-id', '101', '--price', '1999', '--confirm'], { fixtures: {
      'endpoints/goods.update.price.json': { accepted: true, receipt: 'SYN-PRICE' },
    } });
    assert.equal(status, 0);
    assert.equal(envelope.data.dry_run, false);
    assert.deepEqual(envelope.data.result, { accepted: true, receipt: 'SYN-PRICE' });
    assert.equal(envelope.meta.xhr_count, 1);
  });

  it('returns actual process exit 7 while preserving per-item partial batch results', () => {
    const changes = [
      { goods_id: 101, field: 'price', value: 1999 },
      { goods_id: 102, field: 'stock', value: 0 },
      { goods_id: 103, field: 'title', value: 'Synthetic Cup' },
    ];
    const { status, envelope } = runCli(['goods', 'update', 'batch', '--changes', JSON.stringify(changes), '--confirm'], { fixtures: {
      'endpoints/goods.update.price.json': { accepted: true },
      'endpoints/goods.update.stock.json': { __throws: true, __error: { code: 'E_BUSINESS', exitCode: 6, message: 'Synthetic stock rejection' } },
      'endpoints/goods.update.title.json': { accepted: true },
    } });
    assert.equal(status, 7);
    assert.equal(envelope.ok, true);
    assert.equal(envelope.command, 'goods.update.batch');
    assert.equal(envelope.data.succeeded, 2);
    assert.equal(envelope.data.failed, 1);
    assert.deepEqual(envelope.data.results, [
      { goods_id: 101, field: 'price', ok: true },
      { goods_id: 102, field: 'stock', ok: false, error: 'E_BUSINESS', message: 'Synthetic stock rejection' },
      { goods_id: 103, field: 'title', ok: true },
    ]);
  });
});
