import { it } from 'vitest';
import assert from 'node:assert/strict';
import { GOODS_COST_ENTRY_FIELDS, toGoodsCostEntry } from '../../src/services/views/goods-cost.js';
import { assertDataContractV2 } from '../helpers/data-contract.js';

it('whitelists cost entries, yuan values and Shanghai timestamps', () => {
  const entry = toGoodsCostEntry({ goods_id: '101', spec: null, purchase_fen: 820,
    packaging_fen: 0, courier_fen: 300, insurance_fen: 0, technical_service_fen: 1,
    updated_at: '2026-10-01T00:00:00Z', raw: 'private' });
  assert.equal(entry.purchase_yuan, 8.2);
  assert.equal(entry.updated_at, '2026-10-01 08:00:00');
  assert.equal(toGoodsCostEntry({}).purchase_yuan, null);
  assertDataContractV2({ headline: ['已录入成本 1 条'], items: [entry] }, { entityFields: { 'items[]': GOODS_COST_ENTRY_FIELDS } });
});
