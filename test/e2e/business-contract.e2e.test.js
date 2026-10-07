import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { runCli } from '../helpers/isolated-cli.js';
import { assertRedacted } from '../helpers/envelope-assertions.js';
import { GOODS_LIST } from '../../src/adapter/endpoints/goods.js';
import { ORDER_DETAIL_VIEW_FIELDS } from '../../src/services/views/order.js';
import {
  createFactFixtures, createUpstreamGoods, createUpstreamOrder, createUpstreamOrderDetail, SYNTHETIC_PII_VALUES,
} from '../fixtures/test-data.js';

const PII_KEY = /receive_|receiver|mobile|phone|addr|nickname|contact|province|city|district/i;

function collectKeys(value, keys = []) {
  if (Array.isArray(value)) value.forEach((item) => collectKeys(item, keys));
  else if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      keys.push(key);
      collectKeys(child, keys);
    }
  }
  return keys;
}

describe('offline CLI envelopes and process exits', () => {
  it('routes the requested order page and emits one successful JSON envelope', () => {
    const { status, envelope } = runCli(['orders', 'list', '--page', '2'], { fixtures: {
      'endpoints/orders.list.json': { total: 2, orders: [createUpstreamOrder({ order_sn: 'SYN-PAGE-1' })] },
      'endpoints/orders.list.page2.json': { total: 2, orders: [createUpstreamOrder({ order_sn: 'SYN-PAGE-2' })] },
    } });
    assert.equal(status, 0);
    assert.equal(envelope.ok, true);
    assert.equal(envelope.command, 'orders.list');
    assert.equal(envelope.error, null);
    assert.equal(envelope.data.total, 2);
    assert.deepEqual(envelope.data.items.map((order) => order.order_sn), ['SYN-PAGE-2']);
    assert.equal(envelope.data.mall_id, '900001');
    assert.deepEqual(envelope.data.headline, ['近 7 天共 2 单，第 2 页 1 单', '第 2 页状态：已发货，待收货 1 单']);
  });

  it('preserves an actual empty order result', () => {
    const { status, envelope } = runCli(['orders', 'list'], { fixtures: {
      'endpoints/orders.list.json': { total: 0, orders: [] },
    } });
    assert.equal(status, 0);
    assert.equal(envelope.data.total, 0);
    assert.deepEqual(envelope.data.items, []);
    assert.deepEqual(envelope.data.headline, ['近 7 天无订单']);
  });

  it('emits order list facts in domain units without upstream fields, timestamps, fen or PII', () => {
    const { status, stdout, envelope } = runCli(['orders', 'list'], { fixtures: createFactFixtures() });
    assert.equal(status, 0);
    const [order] = envelope.data.items;
    assert.equal(order.status, '已发货，待收货');
    assert.equal(order.paid_amount_yuan, 23.5);
    assert.equal(order.unit_price_yuan, 12.5);
    assert.equal(order.ordered_at, '2023-11-15 06:13:20');
    for (const token of ['orderStatus', '"order_status"', 'pageItems', 'order_status_str', '2350', '1250']) {
      assert.equal(stdout.includes(token), false, `stdout must not contain ${token}`);
    }
    assert.doesNotMatch(stdout, /\b1[6-9]\d{8}\b/, 'stdout must not contain unix timestamps');
    assert.deepEqual(collectKeys(envelope.data).filter((key) => PII_KEY.test(key)), []);
    assertRedacted(stdout, SYNTHETIC_PII_VALUES);
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

  it('projects order detail onto the view whitelist, dropping PII, secrets and raw data', () => {
    const { status, stdout, envelope } = runCli(['orders', 'detail', '--sn', 'SYN-DETAIL'], { fixtures: {
      'endpoints/orders.detail.json': { order: {
        ...createUpstreamOrderDetail(), receiver_phone: 'SYNTHETIC-PHONE', authorization: 'SYNTHETIC-AUTH',
        raw: { hidden: 'SYNTHETIC-RAW' },
      } },
    } });
    assert.equal(status, 0);
    assert.deepEqual(Object.keys(envelope.data.order).sort(), [...ORDER_DETAIL_VIEW_FIELDS].sort());
    assert.equal(envelope.data.order.order_sn, 'SYN-DETAIL');
    assert.equal(envelope.data.order.paid_at, '2023-11-15 06:14:20');
    assert.equal(envelope.data.headline[0], '订单 SYN-DETAIL：已发货，待收货');
    assert.deepEqual(collectKeys(envelope.data).filter((key) => PII_KEY.test(key)), []);
    assertRedacted(stdout, [...SYNTHETIC_PII_VALUES, 'SYNTHETIC-PHONE', 'SYNTHETIC-AUTH', 'SYNTHETIC-RAW']);
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

  it('emits upstream goods id and yuan price ranges in the list envelope data', () => {
    // Fixture mode returns normalized data, so explicitly exercise the real normalizer first.
    const goods = GOODS_LIST.normalize({ success: true, result: {
      total: 1, goods_list: [{ ...createUpstreamGoods({ goods_id: undefined }), id: 673183509913 }],
    } });
    const { status, stdout, envelope } = runCli(['goods', 'list'], { fixtures: {
      'endpoints/goods.list.json': goods,
    } });
    assert.equal(status, 0);
    assert.equal(envelope.command, 'goods.list');
    assert.equal(envelope.data.total, 1);
    assert.equal(envelope.data.mall_id, '900001');
    assert.equal(Object.hasOwn(envelope.meta, 'total'), false);
    assert.equal(Object.hasOwn(envelope.meta, 'mall'), false);
    assert.deepEqual(envelope.data.items, [{
      goods_id: '673183509913', goods_name: 'Tea', quantity: 10,
      price_min_yuan: 12.9, price_max_yuan: 16.9, single_price_min_yuan: 15.9, single_price_max_yuan: 19.9,
      promotion: { name: 'Synthetic 限时折扣', price_min_yuan: 11.9, price_max_yuan: 15.9 },
    }]);
    assert.deepEqual(envelope.data.headline, ['在售商品共 1 件，本页 1 件']);
    for (const token of ['sku_group_price', 'origin_sku_group_price', 'activity_id', 'thumb_url', '1290']) {
      assert.equal(stdout.includes(token), false, `stdout must not contain ${token}`);
    }
  });

  it('rejects the removed cents price option and malformed yuan prices with usage exit 2', () => {
    for (const args of [
      ['--price', '2999'],
      ['--price-yuan', '29.999'],
      ['--price-yuan', '0'],
    ]) {
      const { status, envelope } = runCli(['goods', 'update', 'price', '--goods-id', '1', ...args, '--confirm']);
      assert.equal(status, 2, args.join(' '));
      assert.equal(envelope.error.code, 'E_USAGE');
    }
    const changes = JSON.stringify([{ goods_id: 1, field: 'price', value: 2999 }]);
    const batch = runCli(['goods', 'update', 'batch', '--changes', changes, '--confirm']);
    assert.equal(batch.status, 2);
    assert.match(batch.envelope.error.hint, /price_yuan/);
  });

  it('plans a price change in yuan without any write fixture or confirmation', () => {
    const { status, envelope } = runCli(['goods', 'update', 'price', '--goods-id', '101', '--price-yuan', '19.99', '--sku-id', 'sku-101']);
    assert.equal(status, 0);
    assert.deepEqual(envelope.data, {
      headline: ['预演：商品 101（SKU sku-101） 价格将改为 19.99 元，未提交'],
      goods_id: '101', field: 'price_yuan', value: 19.99, sku_id: 'sku-101', dry_run: true, mall_id: '900001',
    });
    assert.equal(envelope.meta.xhr_count, 0);
  });

  it('routes --confirm through the write service and normalizes its receipt', () => {
    const { status, envelope } = runCli(['goods', 'update', 'price', '--goods-id', '101', '--price-yuan', '29.9', '--confirm'], { fixtures: {
      'endpoints/goods.update.price.json': { success: true, fail_goods_num: 0, raw: { receipt: 'SYN-PRICE' } },
    } });
    assert.equal(status, 0);
    assert.equal(envelope.data.dry_run, false);
    assert.equal(envelope.data.value, 29.9);
    assert.deepEqual(envelope.data.result, { success: true, failed_count: 0 });
    assert.deepEqual(envelope.data.headline, ['已提交：商品 101 价格改为 29.90 元']);
    assert.equal(envelope.meta.xhr_count, 1);
  });

  it('returns actual process exit 7 while preserving per-item partial batch results', () => {
    const changes = [
      { goods_id: 101, field: 'price_yuan', value: 19.99 },
      { goods_id: 102, field: 'stock', value: 0 },
      { goods_id: 103, field: 'title', value: 'Synthetic Cup' },
    ];
    const { status, envelope } = runCli(['goods', 'update', 'batch', '--changes', JSON.stringify(changes), '--confirm'], { fixtures: {
      'endpoints/goods.update.price.json': { success: true },
      'endpoints/goods.update.stock.json': { __throws: true, __error: { code: 'E_BUSINESS', exitCode: 6, message: 'Synthetic stock rejection' } },
      'endpoints/goods.update.title.json': { success: true },
    } });
    assert.equal(status, 7);
    assert.equal(envelope.ok, true);
    assert.equal(envelope.command, 'goods.update.batch');
    assert.equal(envelope.data.succeeded, 2);
    assert.equal(envelope.data.failed, 1);
    assert.deepEqual(envelope.data.results, [
      { goods_id: '101', field: 'price_yuan', ok: true },
      { goods_id: '102', field: 'stock', ok: false, error_code: 'E_BUSINESS', message: 'Synthetic stock rejection' },
      { goods_id: '103', field: 'title', ok: true },
    ]);
  });
});
