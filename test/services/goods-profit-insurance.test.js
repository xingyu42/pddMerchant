import { beforeEach, it } from 'vitest';
import assert from 'node:assert/strict';
import { collectProfitInsurance } from '../../src/services/goods-profit-insurance.js';
import { resolveProfitWindow } from '../../src/services/goods-profit.js';
import { createMemoryEndpointTransport, createTestCtx } from '../helpers/test-ctx.js';

const DAY_MS = 86400000;
const NOW = Date.parse('2026-11-15T02:00:00Z') / 1000;
const record = (orderSn, overrides = {}) => ({ orderSn, serviceAmountVO: { unit: 'YUAN', value: '1.11' },
  feeStatusDesc: '收费成功', ...overrides });
const insuranceRaw = (total, orderInsurances) => ({
  success: true,
  errorCode: 0,
  result: { total, orderInsurances },
});

let transport;
let ctx;
const bodies = () => transport.calls.map((call) => call.payload);

beforeEach(() => {
  transport = createMemoryEndpointTransport();
  ctx = createTestCtx({ transport });
});

it('requests pending and charged records created from one day before the window to its end, 100 per page', async () => {
  const window = resolveProfitWindow(7, NOW);
  transport.set('experiencePlan.orderInsuranceList',
    insuranceRaw(2, [record('SYN-1'), record('SYN-2', { feeStatusDesc: '待收费' })]));
  const result = await collectProfitInsurance(ctx.page, ctx, { window, delayMs: 0 });
  assert.equal(transport.calls[0].name, 'experiencePlan.orderInsuranceList');
  assert.deepEqual(bodies(), [{ pageSize: 100, pageNumber: 0, queryFeeStatusList: [1, 2], clientType: 1,
    createBeginTime: Date.parse('2026-11-06T16:00:00Z'), createEndTime: Date.parse('2026-11-14T16:00:00Z') - 1 }]);
  assert.equal(result.complete, true);
  assert.equal(result.truncated, false);
  assert.equal(result.request_count, 1);
  assert.deepEqual(result.byOrder.get('SYN-1'), [{ status: 'charged', fen: 111 }]);
  assert.deepEqual(result.byOrder.get('SYN-2'), [{ status: 'pending', fen: 111 }]);
});

it('splits windows longer than 30 days into contiguous spans of at most 30 days', async () => {
  const window = resolveProfitWindow(90, NOW);
  transport.set('experiencePlan.orderInsuranceList', insuranceRaw(0, []));
  await collectProfitInsurance(ctx.page, ctx, { window, delayMs: 0 });
  const spans = bodies();
  assert.equal(spans.length, 4);
  assert.equal(spans[0].createBeginTime, (window.start * 1000) - DAY_MS);
  assert.equal(spans.at(-1).createEndTime, (window.end * 1000) - 1);
  for (const [index, body] of spans.entries()) {
    assert.equal(body.pageNumber, 0);
    assert.ok(body.createEndTime - body.createBeginTime + 1 <= 30 * DAY_MS);
    if (index > 0) assert.equal(body.createBeginTime, spans[index - 1].createEndTime + 1);
  }
});

it('pages each span until total is reached and sums repeated records of one order', async () => {
  const window = resolveProfitWindow(7, NOW);
  transport.queue(
    'experiencePlan.orderInsuranceList',
    insuranceRaw(101, Array.from({ length: 100 }, (unused, index) => record(`SYN-${index}`))),
    insuranceRaw(101, [record('SYN-0', { serviceAmountVO: { unit: 'YUAN', value: '0.5' } })]),
  );
  const result = await collectProfitInsurance(ctx.page, ctx, { window, delayMs: 0 });
  assert.deepEqual(bodies().map((body) => body.pageNumber), [0, 1]);
  assert.equal(result.complete, true);
  assert.deepEqual(result.byOrder.get('SYN-0'), [{ status: 'charged', fen: 111 }, { status: 'charged', fen: 50 }]);
});

it('marks a page cap, a short page or a drifting total incomplete', async () => {
  const window = resolveProfitWindow(7, NOW);
  const full = insuranceRaw(300, Array.from({ length: 100 }, (unused, index) => record(`SYN-${index}`)));
  transport.set('experiencePlan.orderInsuranceList', full);
  const capped = await collectProfitInsurance(ctx.page, ctx, { window, maxPages: 2, delayMs: 0 });
  assert.equal(capped.truncated, true);
  assert.equal(capped.complete, false);
  assert.ok(capped.hints.includes('insurance_incomplete'));
  transport.queue('experiencePlan.orderInsuranceList', full, insuranceRaw(300, []));
  assert.equal((await collectProfitInsurance(ctx.page, ctx, { window, delayMs: 0 })).complete, false);
  transport.queue('experiencePlan.orderInsuranceList', full, insuranceRaw(301, full.result.orderInsurances));
  assert.equal((await collectProfitInsurance(ctx.page, ctx, { window, delayMs: 0 })).complete, false);
});

it('treats upstream failures as an unavailable optional source', async () => {
  const window = resolveProfitWindow(7, NOW);
  for (const outcome of [
    { success: false, errorCode: 54001, errorMsg: 'rate limit' },
    { status: 500, raw: null },
    { success: false, errorCode: 40001, errorMsg: 'business error' },
  ]) {
    const caseTransport = createMemoryEndpointTransport({
      responses: { 'experiencePlan.orderInsuranceList': outcome },
    });
    const caseCtx = createTestCtx({ transport: caseTransport });
    const result = await collectProfitInsurance(caseCtx.page, caseCtx, { window });
    assert.equal(result.complete, false);
    assert.equal(result.truncated, false);
    assert.ok(result.hints.includes('insurance_unavailable'));
  }
  transport.fail('experiencePlan.orderInsuranceList', new TypeError('bug'));
  await assert.rejects(() => collectProfitInsurance(ctx.page, ctx, { window }), TypeError);
});

it('keeps non-YUAN amounts and unknown fee statuses unknown with warnings', async () => {
  const window = resolveProfitWindow(7, NOW);
  transport.set('experiencePlan.orderInsuranceList', insuranceRaw(3, [
    record('SYN-1', { serviceAmountVO: { unit: 'FEN', value: '111' } }),
    record('SYN-2', { feeStatusDesc: '收费取消' }),
    record('SYN-3', { serviceAmountVO: { unit: 'FEN', value: '1' } }),
  ]));
  const result = await collectProfitInsurance(ctx.page, ctx, { window });
  assert.deepEqual(result.byOrder.get('SYN-1'), [{ status: 'charged', fen: null }]);
  assert.deepEqual(result.byOrder.get('SYN-2'), [{ status: 'unknown', fen: 111 }]);
  assert.equal(result.complete, true);
  assert.equal(result.warnings.length, 2);
  assert.ok(result.warnings.some((warning) => warning.includes('FEN')));
  assert.ok(result.warnings.some((warning) => warning.includes('收费取消')));
});
