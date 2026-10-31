import { it, vi } from 'vitest';
import assert from 'node:assert/strict';
import { runEndpoint } from '../../src/adapter/run-endpoint.js';
import { PddCliError } from '../../src/infra/errors.js';
import { collectProfitPromo } from '../../src/services/goods-profit-promo.js';

vi.mock('../../src/adapter/run-endpoint.js', async (original) => ({ ...(await original()), runEndpoint: vi.fn() }));
const window = { startDate: '2026-10-01', endDate: '2026-10-30' };
const entity = (overrides = {}) => ({ goodsId: '101', spend: 1, isDeleted: true, ...overrides });

it('aggregates all pages, retains inactive history and subtracts attribution only once', async () => {
  runEndpoint.mockResolvedValueOnce({ entities: Array(50).fill(entity()), totals: { spend: 80 } })
    .mockResolvedValueOnce({ entities: [entity({ goodsId: '102', spend: 10 }), entity({ goodsId: null, spend: 20 })], totals: { spend: 80 } });
  const result = await collectProfitPromo(null, {}, { window, delayMs: 0 });
  assert.equal(result.complete, true);
  assert.equal(result.byGoods.get('101'), 5000);
  assert.equal(result.byGoods.get('102'), 1000);
  assert.equal(result.total_fen, 8000);
  assert.equal(result.shop_fen, 2000);
  assert.equal(result.byGoods.has('Tea'), false);
});

it('preserves totals and marks a negative residual unknown with a hint', async () => {
  runEndpoint.mockResolvedValue({ entities: [entity({ spend: 2 })], totals: { spend: 1 } });
  const result = await collectProfitPromo(null, {}, { window });
  assert.equal(result.total_fen, 100);
  assert.equal(result.shop_fen, null);
  assert.ok(result.hints.includes('negative_promo_difference'));
});

it('distinguishes a successful empty report from unavailable or invalid spend', async () => {
  runEndpoint.mockResolvedValue({ entities: [], totals: { spend: 0 } });
  assert.equal((await collectProfitPromo(null, {}, { window })).complete, true);
  runEndpoint.mockRejectedValue(new PddCliError({ code: 'E_NETWORK', exitCode: 5 }));
  assert.equal((await collectProfitPromo(null, {}, { window })).total_fen, null);
  runEndpoint.mockResolvedValue({ entities: [entity({ spend: null })], totals: { spend: 1 }, unitWarnings: ['unknown unit'] });
  const unknown = await collectProfitPromo(null, {}, { window });
  assert.equal(unknown.byGoods.get('101'), null);
  assert.equal(unknown.attributed_fen, null);
});

it('propagates capped scans, rate limits, drifting totals and cancellation', async () => {
  runEndpoint.mockResolvedValue({ entities: Array(50).fill(entity()), totals: { spend: 50 } });
  assert.equal((await collectProfitPromo(null, {}, { window, maxPages: 1 })).truncated, true);
  runEndpoint.mockRejectedValue(new PddCliError({ code: 'E_RATE_LIMIT', exitCode: 4 }));
  assert.equal((await collectProfitPromo(null, {}, { window })).ratelimited, true);
  runEndpoint.mockResolvedValueOnce({ entities: Array(50).fill(entity()), totals: { spend: 50 } })
    .mockResolvedValueOnce({ entities: [], totals: { spend: 60 } });
  assert.equal((await collectProfitPromo(null, {}, { window, delayMs: 0 })).complete, false);
  await assert.rejects(() => collectProfitPromo(null, { signal: AbortSignal.abort() }, { window }), { code: 'E_TIMEOUT' });
});

it('retains observed identities and the actual request count when a later page fails', async () => {
  runEndpoint.mockResolvedValueOnce({ entities: Array(50).fill(entity()), totals: { spend: 80 } })
    .mockRejectedValueOnce(new PddCliError({ code: 'E_RATE_LIMIT', exitCode: 4 }));
  const result = await collectProfitPromo(null, {}, { window, delayMs: 0 });
  assert.equal(result.request_count, 2);
  assert.equal(result.byGoods.has('101'), true);
  assert.equal(result.complete, false);
  assert.equal(result.ratelimited, true);
  assert.equal(result.total_fen, null);
  assert.equal(result.attributed_fen, null);
});

it('propagates programming errors from getPromoReport unchanged', async () => {
  for (const ErrorClass of [TypeError, ReferenceError, Error]) {
    const failure = new ErrorClass('Synthetic programming error');
    runEndpoint.mockRejectedValueOnce(failure);
    await assert.rejects(() => collectProfitPromo(null, {}, { window }), (error) => error === failure);
  }
});

it('treats PddCliError domain failures as an unavailable optional source', async () => {
  for (const code of ['E_RATE_LIMIT', 'E_NETWORK', 'E_BUSINESS', 'E_AUTH_EXPIRED']) {
    runEndpoint.mockRejectedValueOnce(new PddCliError({ code }));
    const result = await collectProfitPromo(null, {}, { window });
    assert.equal(result.complete, false);
    assert.equal(result.total_fen, null);
    assert.ok(result.hints.includes('promo_unavailable'));
    assert.equal(result.ratelimited, code === 'E_RATE_LIMIT');
  }
});

it('handles a malformed entities response as an unavailable optional source', async () => {
  runEndpoint.mockResolvedValueOnce({ entities: null });
  const result = await collectProfitPromo(null, {}, { window });
  assert.equal(result.complete, false);
  assert.ok(result.hints.includes('promo_unavailable'));
});

it('propagates timeout and abort errors even without an aborted context signal', async () => {
  const aborted = new Error('Synthetic abort');
  aborted.name = 'AbortError';
  for (const failure of [new PddCliError({ code: 'E_TIMEOUT' }), aborted]) {
    runEndpoint.mockRejectedValueOnce(failure);
    await assert.rejects(() => collectProfitPromo(null, {}, { window }), (error) => error === failure);
  }
});
