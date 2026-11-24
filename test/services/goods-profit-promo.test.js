import { beforeEach, it } from 'vitest';
import assert from 'node:assert/strict';
import { collectProfitPromo } from '../../src/services/goods-profit-promo.js';
import { createMemoryEndpointTransport, createTestCtx } from '../helpers/test-ctx.js';

const window = { startDate: '2026-10-01', endDate: '2026-10-30' };
const entity = (overrides = {}) => ({
  goodsId: '101', impression: 1, click: 1, gmv: 1, spend: 1, isDeleted: true, ...overrides,
});
const promoRaw = (entities, spend = 0) => ({
  success: true,
  result: {
    entityReportList: entities,
    totalSumReport: { impression: 0, click: 0, gmv: 0, spend },
  },
});

let transport;
let ctx;

beforeEach(() => {
  transport = createMemoryEndpointTransport();
  ctx = createTestCtx({ transport });
});

it('aggregates all pages, retains inactive history and subtracts attribution only once', async () => {
  transport.queue(
    'promo.entityReport',
    promoRaw(Array(50).fill(entity()), 80),
    promoRaw([entity({ goodsId: '102', spend: 10 }), entity({ goodsId: null, spend: 20 })], 80),
  );
  const result = await collectProfitPromo(ctx.page, ctx, { window, delayMs: 0 });
  assert.equal(result.complete, true);
  assert.equal(result.byGoods.get('101'), 5000);
  assert.equal(result.byGoods.get('102'), 1000);
  assert.equal(result.total_fen, 8000);
  assert.equal(result.shop_fen, 2000);
  assert.equal(result.byGoods.has('Tea'), false);
});

it('preserves totals and marks a negative residual unknown with a hint', async () => {
  transport.set('promo.entityReport', promoRaw([entity({ spend: 2 })], 1));
  const result = await collectProfitPromo(ctx.page, ctx, { window });
  assert.equal(result.total_fen, 100);
  assert.equal(result.shop_fen, null);
  assert.ok(result.hints.includes('negative_promo_difference'));
});

it('distinguishes a successful empty report from unavailable or invalid spend', async () => {
  transport.set('promo.entityReport', promoRaw([], 0));
  assert.equal((await collectProfitPromo(ctx.page, ctx, { window })).complete, true);
  transport.set('promo.entityReport', { status: 500, raw: null });
  assert.equal((await collectProfitPromo(ctx.page, ctx, { window })).total_fen, null);
  transport.set('promo.entityReport', promoRaw([entity({ spend: { value: 1, unit: 'UNKNOWN' } })], 1));
  const unknown = await collectProfitPromo(ctx.page, ctx, { window });
  assert.equal(unknown.byGoods.get('101'), null);
  assert.equal(unknown.attributed_fen, null);
  assert.ok(unknown.warnings.some((warning) => warning.includes('UNKNOWN')));
});

it('propagates capped scans, rate limits and drifting totals', async () => {
  transport.set('promo.entityReport', promoRaw(Array(50).fill(entity()), 50));
  assert.equal((await collectProfitPromo(ctx.page, ctx, { window, maxPages: 1 })).truncated, true);
  transport.set('promo.entityReport', { success: false, errorCode: 54001, errorMsg: 'rate limited' });
  assert.equal((await collectProfitPromo(ctx.page, ctx, { window })).ratelimited, true);
  const driftTransport = createMemoryEndpointTransport();
  const driftCtx = createTestCtx({ transport: driftTransport });
  driftTransport.queue(
    'promo.entityReport',
    promoRaw(Array(50).fill(entity()), 50),
    promoRaw([], 60),
  );
  assert.equal((await collectProfitPromo(driftCtx.page, driftCtx, { window, delayMs: 0 })).complete, false);
});

it('retains observed identities and the actual request count when a later page fails', async () => {
  transport.queue(
    'promo.entityReport',
    promoRaw(Array(50).fill(entity()), 80),
    { success: false, errorCode: 54001, errorMsg: 'rate limited' },
  );
  const result = await collectProfitPromo(ctx.page, ctx, { window, delayMs: 0 });
  assert.equal(result.request_count, 2);
  assert.equal(result.byGoods.has('101'), true);
  assert.equal(result.complete, false);
  assert.equal(result.ratelimited, true);
  assert.equal(result.total_fen, null);
  assert.equal(result.attributed_fen, null);
});

it('treats PddCliError domain failures as an unavailable optional source', async () => {
  for (const [code, outcome] of [
    ['E_RATE_LIMIT', { success: false, errorCode: 54001, errorMsg: 'rate limited' }],
    ['E_NETWORK', { status: 500, raw: null }],
    ['E_BUSINESS', { success: false, errorCode: 40001, errorMsg: 'business error' }],
    ['E_AUTH_EXPIRED', { status: 401, raw: null }],
  ]) {
    const caseCtx = createTestCtx({ responses: { 'promo.entityReport': outcome } });
    const result = await collectProfitPromo(caseCtx.page, caseCtx, { window });
    assert.equal(result.complete, false);
    assert.equal(result.total_fen, null);
    assert.ok(result.hints.includes('promo_unavailable'));
    assert.equal(result.ratelimited, code === 'E_RATE_LIMIT');
  }
});

it('handles a malformed entities response as an unavailable optional source', async () => {
  transport.set('promo.entityReport', promoRaw(null, 0));
  const result = await collectProfitPromo(ctx.page, ctx, { window });
  assert.equal(result.complete, false);
  assert.ok(result.hints.includes('promo_unavailable'));
});
