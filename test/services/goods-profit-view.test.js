import { it, vi } from 'vitest';
import assert from 'node:assert/strict';
import { getGoodsProfitView } from '../../src/services/goods-profit.js';
import {
  GOODS_PROFIT_ITEM_FIELDS,
  GOODS_PROFIT_SUMMARY_FIELDS,
  GOODS_PROFIT_QUALITY_FIELDS,
} from '../../src/services/views/goods-profit.js';
import { insertAccount } from '../../src/infra/account-store.js';
import { upsertGoodsCosts } from '../../src/infra/goods-cost-store.js';
import { createRateLimiter } from '../../src/adapter/rate-limiter.js';
import { createTestCtx } from '../helpers/test-ctx.js';
import { assertDataContractV2 } from '../helpers/data-contract.js';

const NOW_MS = Date.parse('2026-10-01T00:00:00Z');
const CONFIRM_TIME = Date.parse('2026-09-29T16:00:00Z') / 1000;

it('projects only exact profit facts in yuan with signed rates and fixed disclosures', async () => {
  vi.useFakeTimers({ now: NOW_MS });
  const account = insertAccount({ kind: 'merchant', identity: '900001', displayName: 'Synthetic Shop' }, { setDefault: true });
  upsertGoodsCosts({
    accountId: account.id,
    mallId: '900001',
    entries: [{ goods_id: '101', spec: null, purchase_fen: 400, packaging_fen: 0, courier_fen: 0, technical_service_fen: 0 }],
  });

  const ctx = createTestCtx({
    accountId: account.id,
    account,
    mallId: '900001',
    limiter: createRateLimiter({ qps: 0 }),
    responses: {
      'orders.list': {
        success: true,
        result: {
          totalItemNum: 1,
          pageItems: [{
            order_sn: 'SYN-1', goods_id: '101', goods_number: 1, order_amount: 100,
            platform_discount: 0, after_sales_status: null, pay_status: 2,
            confirm_time: CONFIRM_TIME, buyer_memo: 'SYN-SECRET',
          }],
        },
      },
      'promo.entityReport': {
        success: true,
        result: { entityReportList: [], totalSumReport: { impression: 0, click: 0, gmv: 0, spend: 0 } },
      },
      'experiencePlan.orderInsuranceList': {
        success: true,
        errorCode: 0,
        result: { total: 0, orderInsurances: [] },
      },
    },
  });

  const pending = getGoodsProfitView(ctx, { days: 30 });
  await vi.runAllTimersAsync();
  const { data } = await pending;

  assertDataContractV2(data, {
    entityFields: {
      'items[]': GOODS_PROFIT_ITEM_FIELDS,
      summary: GOODS_PROFIT_SUMMARY_FIELDS,
      'summary.data_quality': GOODS_PROFIT_QUALITY_FIELDS,
    },
  });
  assert.deepEqual(data.summary.data_quality, {
    orders_complete: true,
    orders_truncated: false,
    orders_ratelimited: false,
    promo_complete: true,
    promo_truncated: false,
    promo_ratelimited: false,
    insurance_complete: true,
    insurance_truncated: false,
  });
  assert.ok(data.hints.some((hint) => hint.includes('运费险取消费者体验提升计划收费记录')));
  assert.equal(data.items[0].net_profit_yuan, -3);
  assert.equal(data.items[0].net_margin_pct, -300);
  assert.equal(data.items[0].cost_updated_at, '2026-10-01 08:00:00');
  assert.ok(data.hints.some((hint) => hint.includes('仅退款不退货')));
  assert.ok(data.hints.some((hint) => hint.includes('共担')));
  assert.ok(data.hints.some((hint) => hint.includes('仅含商品推广报表口径')));
  assert.equal(JSON.stringify(data).includes('SYN-SECRET'), false);
});
