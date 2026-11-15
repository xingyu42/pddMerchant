import { beforeEach, it, vi } from 'vitest';
import assert from 'node:assert/strict';
import { runEndpoint } from '../../src/adapter/run-endpoint.js';
import { PddCliError } from '../../src/infra/errors.js';
import { collectProfitInsurance } from '../../src/services/goods-profit-insurance.js';
import { resolveProfitWindow } from '../../src/services/goods-profit.js';

vi.mock('../../src/adapter/run-endpoint.js', async (original) => ({ ...(await original()), runEndpoint: vi.fn() }));
const DAY_MS = 86400000;
const NOW = Date.parse('2026-11-15T02:00:00Z') / 1000;
const record = (orderSn, overrides = {}) => ({ orderSn, serviceAmountVO: { unit: 'YUAN', value: '1.11' },
  feeStatusDesc: '收费成功', ...overrides });
const bodies = () => runEndpoint.mock.calls.map(([, spec, params]) => spec.buildPayload(params));

beforeEach(() => { runEndpoint.mockReset(); });

it('requests pending and charged records created from one day before the window to its end, 100 per page', async () => {
  const window = resolveProfitWindow(7, NOW);
  runEndpoint.mockResolvedValue({ total: 2, items: [record('SYN-1'), record('SYN-2', { feeStatusDesc: '待收费' })] });
  const result = await collectProfitInsurance(null, {}, { window, delayMs: 0 });
  assert.equal(runEndpoint.mock.calls[0][1].name, 'experiencePlan.orderInsuranceList');
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
  runEndpoint.mockResolvedValue({ total: 0, items: [] });
  await collectProfitInsurance(null, {}, { window, delayMs: 0 });
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
  runEndpoint.mockResolvedValueOnce({ total: 101, items: Array.from({ length: 100 }, (unused, index) => record(`SYN-${index}`)) })
    .mockResolvedValueOnce({ total: 101, items: [record('SYN-0', { serviceAmountVO: { unit: 'YUAN', value: '0.5' } })] });
  const result = await collectProfitInsurance(null, {}, { window, delayMs: 0 });
  assert.deepEqual(bodies().map((body) => body.pageNumber), [0, 1]);
  assert.equal(result.complete, true);
  assert.deepEqual(result.byOrder.get('SYN-0'), [{ status: 'charged', fen: 111 }, { status: 'charged', fen: 50 }]);
});

it('marks a page cap, a short page or a drifting total incomplete', async () => {
  const window = resolveProfitWindow(7, NOW);
  const full = { total: 300, items: Array.from({ length: 100 }, (unused, index) => record(`SYN-${index}`)) };
  runEndpoint.mockResolvedValue(full);
  const capped = await collectProfitInsurance(null, {}, { window, maxPages: 2, delayMs: 0 });
  assert.equal(capped.truncated, true);
  assert.equal(capped.complete, false);
  assert.ok(capped.hints.includes('insurance_incomplete'));
  runEndpoint.mockReset().mockResolvedValueOnce(full).mockResolvedValueOnce({ total: 300, items: [] });
  assert.equal((await collectProfitInsurance(null, {}, { window, delayMs: 0 })).complete, false);
  runEndpoint.mockReset().mockResolvedValueOnce(full).mockResolvedValueOnce({ ...full, total: 301 });
  assert.equal((await collectProfitInsurance(null, {}, { window, delayMs: 0 })).complete, false);
});

it('treats upstream failures as an unavailable optional source', async () => {
  const window = resolveProfitWindow(7, NOW);
  for (const code of ['E_RATE_LIMIT', 'E_NETWORK', 'E_BUSINESS']) {
    runEndpoint.mockReset().mockRejectedValue(new PddCliError({ code }));
    const result = await collectProfitInsurance(null, {}, { window });
    assert.equal(result.complete, false);
    assert.equal(result.truncated, false);
    assert.ok(result.hints.includes('insurance_unavailable'));
  }
  runEndpoint.mockReset().mockImplementation(async () => { throw new TypeError('bug'); });
  await assert.rejects(() => collectProfitInsurance(null, {}, { window }), TypeError);
});

it('keeps non-YUAN amounts and unknown fee statuses unknown with warnings', async () => {
  const window = resolveProfitWindow(7, NOW);
  runEndpoint.mockResolvedValue({ total: 3, items: [record('SYN-1', { serviceAmountVO: { unit: 'FEN', value: '111' } }),
    record('SYN-2', { feeStatusDesc: '收费取消' }), record('SYN-3', { serviceAmountVO: { unit: 'FEN', value: '1' } })] });
  const result = await collectProfitInsurance(null, {}, { window });
  assert.deepEqual(result.byOrder.get('SYN-1'), [{ status: 'charged', fen: null }]);
  assert.deepEqual(result.byOrder.get('SYN-2'), [{ status: 'unknown', fen: 111 }]);
  assert.equal(result.complete, true);
  assert.equal(result.warnings.length, 2);
  assert.ok(result.warnings.some((warning) => warning.includes('FEN')));
  assert.ok(result.warnings.some((warning) => warning.includes('收费取消')));
});
