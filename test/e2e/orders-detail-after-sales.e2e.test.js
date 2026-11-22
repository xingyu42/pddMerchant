import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import {
  createAfterSalesFixtures, createFactFixtures, createProfitFixtures, createProfitOrders,
  createUpstreamAfterSalesCase, createUpstreamOrderDetail,
} from '../fixtures/test-data.js';
import { runCli } from '../helpers/isolated-cli.js';

const sn = 'SYN-DETAIL';
const command = ['orders', 'detail', '--sn', sn];
const baseHeadline = [
  '订单 SYN-DETAIL：已发货，待收货',
  'Tea × 2，实付 23.50 元',
  '2023-11-15 07:13:20 发货（SYN 快递）',
];

function orderDetailFixtures(overrides = {}) {
  return { 'endpoints/orders.detail.json': { success: true, result: createUpstreamOrderDetail(overrides) } };
}

describe('orders detail after-sales fixture CLI', () => {
  it('enriches the order with exact matches across pages, sorted by application time then numeric ID', () => {
    const sameTime = 1700000010;
    const otherOrder = createUpstreamAfterSalesCase({ orderSn: `${sn}-OTHER`, createdAt: 1700000020 });
    const fixtures = {
      ...orderDetailFixtures({ after_sales_id: '100', after_sales_status: '退款成功', after_sales_status_code: 5 }),
      ...createAfterSalesFixtures({ items: [
        createUpstreamAfterSalesCase({ orderSn: sn, id: '99999999999999' }),
        createUpstreamAfterSalesCase({ orderSn: sn, id: '20', createdAt: sameTime }),
        ...Array.from({ length: 98 }, () => otherOrder),
        createUpstreamAfterSalesCase({ orderSn: sn, id: '100', createdAt: sameTime, afterSalesStatus: 10 }),
      ] }),
    };

    const { status, stdout, envelope } = runCli(command, { fixtures });
    assert.equal(status, 0);
    assert.equal(envelope.ok, true);
    const { data } = envelope;
    assert.equal(data.order.after_sales_status, '退款成功');
    assert.deepEqual(data.after_sales_cases?.map((item) => [item.after_sales_id, item.order_sn]), [
      ['100', sn], ['20', sn], ['99999999999999', sn],
    ]);
    assert.equal(data.after_sales_cases[0].reason_category, '七天无理由退货');
    assert.deepEqual(data.hints, []);
    assert.deepEqual(data.headline, [
      ...baseHeadline, '售后单 3 条，最新：退货退款（待消费者发货），原因：不想要了',
    ]);
    assert.doesNotMatch(stdout, /SYN-AFTER-SALES-PRIVATE|thumbUrl|mallRemark|"uid"|returnAddressId|actions|expireActionDesc/);
    assert.equal(envelope.meta.xhr_count, 4);
  });

  it('makes only the detail request when both after-sales indicators are nullish', () => {
    const { status, envelope } = runCli(command, { fixtures: {
      ...orderDetailFixtures({ after_sales_id: null, after_sales_status: 5 }),
      'endpoints/after_sales.list.json': { __throws: true, __error: { code: 'E_INTERNAL', exitCode: 1 } },
    } });
    assert.equal(status, 0);
    assert.equal(envelope.ok, true);
    assert.deepEqual(envelope.data.after_sales_cases, []);
    assert.deepEqual(envelope.data.hints, []);
    assert.deepEqual(envelope.data.headline, baseHeadline);
    assert.equal(envelope.meta.xhr_count, 1);
  });

  it('warns when the related case search truncates at 2000 rows', () => {
    const items = Array.from({ length: 2050 }, (_, id) => ({ id, orderSn: sn }));
    const { envelope } = runCli(command, { fixtures: {
      ...orderDetailFixtures({ after_sales_id: '123456' }),
      ...createAfterSalesFixtures({ items }),
    } });
    assert.equal(envelope.ok, true);
    assert.equal(envelope.data.after_sales_cases.length, 2000);
    assert.deepEqual(envelope.data.hints, ['关联售后单检索已达单次 2000 条上限，结果可能不完整']);
    assert.equal(envelope.meta.xhr_count, 22);
  });

  it('skips the reason dictionary when only fuzzy matches are found', () => {
    const { envelope } = runCli(command, { fixtures: {
      ...orderDetailFixtures({ after_sales_status_code: 5 }),
      ...createAfterSalesFixtures({ params: { __throws: true }, items: [
        createUpstreamAfterSalesCase({ orderSn: `${sn}-OTHER` }),
      ] }),
    } });
    assert.equal(envelope.ok, true);
    assert.deepEqual(envelope.data.after_sales_cases, []);
    assert.deepEqual(envelope.data.hints, []);
    assert.deepEqual(envelope.data.headline, baseHeadline);
    assert.equal(envelope.meta.xhr_count, 2);
  });

  it('keeps the order available and skips the dictionary if the case list fails', () => {
    const { status, envelope } = runCli(command, { fixtures: {
      ...orderDetailFixtures({ after_sales_id: '123456' }),
      'endpoints/after_sales.list.json': { __throws: true, __error: { code: 'E_NETWORK', exitCode: 5 } },
      'endpoints/after_sales.params.json': { __throws: true, __error: { code: 'E_INTERNAL', exitCode: 1 } },
    } });
    assert.equal(status, 0);
    assert.equal(envelope.ok, true);
    assert.equal(envelope.data.order.order_sn, sn);
    assert.equal(envelope.data.after_sales_cases, null);
    const hint = '关联售后单拉取失败，售后原因暂不可用';
    assert.deepEqual(envelope.data.hints, [hint]);
    assert.deepEqual(envelope.data.headline, [...baseHeadline, hint]);
    assert.equal(envelope.meta.xhr_count, 2);
  });

  it('keeps case reasons when the reason dictionary fails', () => {
    const { status, envelope } = runCli(command, { fixtures: {
      ...orderDetailFixtures({ after_sales_status_code: 5 }),
      ...createAfterSalesFixtures({
        items: [createUpstreamAfterSalesCase({ orderSn: sn })], params: { __throws: true },
      }),
    } });
    assert.equal(status, 0);
    assert.equal(envelope.ok, true);
    assert.deepEqual(envelope.data.after_sales_cases.map(({ reason_desc, reason_category }) =>
      [reason_desc, reason_category]), [['不想要了', null]]);
    assert.deepEqual(envelope.data.hints, ['售后参数字典拉取失败，售后原因大类暂不可用']);
    assert.equal(envelope.meta.xhr_count, 3);
  });

  it('counts both case pages when the second page fails', () => {
    const { envelope } = runCli(command, { fixtures: {
      ...orderDetailFixtures({ after_sales_id: '123456' }),
      ...createAfterSalesFixtures({ count: 101 }),
      'endpoints/after_sales.list.page2.json': { __throws: true, __error: { code: 'E_NETWORK', exitCode: 5 } },
      'endpoints/after_sales.params.json': { __throws: true, __error: { code: 'E_INTERNAL', exitCode: 1 } },
    } });
    assert.equal(envelope.ok, true);
    assert.equal(envelope.data.after_sales_cases, null);
    assert.deepEqual(envelope.data.hints, ['关联售后单拉取失败，售后原因暂不可用']);
    assert.equal(envelope.meta.xhr_count, 3);
  });

  it.each([['E_TIMEOUT', 5], ['E_INTERNAL', 1]])('propagates a case-list %s', (code, exitCode) => {
    const { status, envelope } = runCli(command, { fixtures: {
      ...orderDetailFixtures({ after_sales_id: '123456' }),
      'endpoints/after_sales.list.json': { __throws: true, __error: { code, exitCode } },
    } });
    assert.equal(status, exitCode);
    assert.equal(envelope.error.code, code);
    assert.equal(envelope.data, null);
  });
});

it('keeps stats, diagnosis and profit on order-level refund and processing calibers', () => {
  const orders = createProfitOrders([5, 6, 16, null].map((after_sales_status) => ({ after_sales_status })));
  const baseline = { ...createFactFixtures(), ...createProfitFixtures({ orders }) };
  const withCaseEndpoints = {
    ...baseline,
    ...createAfterSalesFixtures({ items: orders.flatMap(({ order_sn }) => [5, 6, 16].map((afterSalesStatus) =>
      createUpstreamAfterSalesCase({ orderSn: order_sn, afterSalesStatus, refundAmount: 9999 }))) }),
  };

  function unchangedData(args) {
    const { envelope } = runCli(args, { fixtures: withCaseEndpoints });
    const original = runCli(args, { fixtures: baseline }).envelope;
    assert.equal(envelope.ok, true);
    assert.equal(original.ok, true);
    assert.deepEqual(envelope.data, original.data);
    assert.equal(envelope.meta.xhr_count, original.meta.xhr_count);
    return envelope.data;
  }

  const { local } = unchangedData(['orders', 'stats']);
  assert.deepEqual([local.order_count, local.refund_count, local.after_sales_count, local.refund_rate_pct],
    [4, 1, 2, 25]);
  const { detail } = unchangedData(['diagnose', 'after-sales']);
  assert.deepEqual([detail.total_orders, detail.refund_count, detail.after_sales_count,
    detail.refund_rate_pct, detail.after_sales_rate_pct], [4, 1, 2, 25, 50]);
  const { summary } = unchangedData(['goods', 'profit']);
  assert.deepEqual([summary.observed_order_count, summary.refunded_order_count, summary.after_sales_order_count,
    summary.revenue_yuan, summary.after_sales_revenue_yuan], [4, 1, 2, 72, 48]);
});
