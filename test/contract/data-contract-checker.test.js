import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { assertDataContractV2, collectDataContractViolations } from '../helpers/data-contract.js';

const GOOD = {
  headline: ['近 7 天共 128 单，本页 20 单', '待发货 5 单'],
  items: [
    { order_sn: 'S1', status: '待发货', paid_amount_yuan: 29.9, paid_at: '2026-10-01 12:00:00' },
  ],
  total: 128,
  refund_rate_pct: 3.12,
  ctr_pct: 1.5,
  gmv_delta_pct: -12.5,
  roi: 2.35,
  price_note: '含运费',
  window: { start_date: '2026-09-30', end_date: '2026-10-06' },
};

describe('data contract v2 checker', () => {
  it('accepts a conforming data object', () => {
    assertDataContractV2(GOOD);
  });

  it('rejects non-object data', () => {
    for (const data of [null, [], 'x', 3]) {
      assert.deepEqual(collectDataContractViolations(data), ['data: must be a plain object']);
    }
  });

  it('requires a non-empty string headline', () => {
    for (const headline of [undefined, [], 'one', [1], ['']]) {
      const violations = collectDataContractViolations({ ...GOOD, headline });
      assert.deepEqual(violations, ['headline: must be a non-empty array of non-empty strings']);
    }
  });

  it('rejects non-snake_case keys at any depth', () => {
    const data = { ...GOOD, items: [{ orderStatus: 1 }], window: { StartDate: 'x' }, '1st': 1 };
    assert.deepEqual(collectDataContractViolations(data), [
      'items[].orderStatus: key is not snake_case',
      'window.StartDate: key is not snake_case',
      '1st: key is not snake_case',
    ]);
  });

  it('requires _yuan on numeric money keys', () => {
    const data = { ...GOOD, items: [{ sku_price: 2990 }], net_gmv: 10, fee_yuan: 1, total_amount: 'n/a' };
    assert.deepEqual(collectDataContractViolations(data), [
      'items[].sku_price: numeric money key must end with _yuan',
      'net_gmv: numeric money key must end with _yuan',
    ]);
  });

  it('requires _pct on numeric rate/ctr keys', () => {
    const data = { ...GOOD, refund_rate: 0.03, ctr: 0.01, fee_rate_pct: 0.6 };
    assert.deepEqual(collectDataContractViolations(data), [
      'refund_rate: numeric rate key must end with _pct',
      'ctr: numeric rate key must end with _pct',
    ]);
  });

  it('skips key rules for free-form key maps but still checks their values', () => {
    const data = {
      ...GOOD,
      status_distribution: { 待发货: 5, 已签收: { refundRate: 0.1 } },
    };
    assert.deepEqual(collectDataContractViolations(data, { freeKeyPaths: ['status_distribution'] }), [
      'status_distribution.*.refundRate: key is not snake_case',
      'status_distribution.*.refundRate: numeric rate key must end with _pct',
    ]);
    assert.equal(collectDataContractViolations(data).length, 4);
  });

  it('supports nested free-form paths through arrays and other free-form maps', () => {
    const data = {
      headline: ['批量'],
      accounts: { 'shop-a': { data: { items: [{ by_label: { 待发货: 1 } }] } } },
    };
    const options = { freeKeyPaths: ['accounts', 'accounts.*.data.items[].by_label'] };
    assert.deepEqual(collectDataContractViolations(data, options), []);
  });

  it('requires entity key sets to equal the declared view whitelist', () => {
    const fields = ['order_sn', 'status', 'paid_amount_yuan', 'paid_at'];
    assert.deepEqual(collectDataContractViolations(GOOD, { entityFields: { 'items[]': fields } }), []);
    const leaky = { ...GOOD, items: [{ ...GOOD.items[0], goods_name: 'Tea' }, { order_sn: 'S2' }] };
    assert.deepEqual(collectDataContractViolations(leaky, { entityFields: { 'items[]': fields } }), [
      'items[]: unexpected entity keys goods_name',
      'items[]: missing entity keys paid_amount_yuan,paid_at,status',
    ]);
  });

  it('fails when a declared entity path never occurs', () => {
    const empty = { ...GOOD, items: [] };
    assert.deepEqual(collectDataContractViolations(empty, { entityFields: { 'items[]': ['order_sn'], order: ['x'] } }), [
      'items[]: declared entity path not found',
      'order: declared entity path not found',
    ]);
  });
});
