import { beforeEach, it, vi } from 'vitest';
import assert from 'node:assert/strict';
import { PlaywrightEndpointClient } from '../../src/adapter/endpoint-client.js';
import { executePageApiRequest } from '../../src/adapter/page-api-client.js';
import { TRAFFIC_READY_TIME } from '../../src/adapter/endpoints/traffic.js';
import { PddCliError, ExitCodes } from '../../src/infra/errors.js';

vi.mock('../../src/adapter/page-api-client.js', () => ({ executePageApiRequest: vi.fn() }));
beforeEach(() => {
  vi.stubEnv('PDD_TEST_ADAPTER', '');
  executePageApiRequest.mockReset();
});

it('preserves the default 40002 classification and hint through the traffic spec', async () => {
  const raw = { success: false, errorCode: 40002, errorMsg: '请求失败' };
  executePageApiRequest.mockResolvedValue({ status: 200, raw });
  const cooldownState = { map: new Map(), threshold: 3, ms: 300_000 };
  const client = new PlaywrightEndpointClient({ cooldownState });
  const ctx = { page: { url: () => 'https://mms.pinduoduo.com/' }, log: { debug() {} } };
  const defaultSpec = { ...TRAFFIC_READY_TIME, errorMapper: undefined, errorMap: undefined };
  const failures = [];
  for (const spec of [defaultSpec, TRAFFIC_READY_TIME]) {
    await assert.rejects(client.execute(spec, {}, ctx), (error) => {
      assert.ok(error instanceof PddCliError);
      assert.equal(error.code, 'E_BUSINESS');
      assert.equal(error.exitCode, ExitCodes.BUSINESS);
      failures.push(error);
      return true;
    });
  }
  assert.equal(failures[0].detail.classification, 'high-frequency-or-risk-control');
  assert.match(failures[0].hint, /请求签名异常/);
  assert.equal(failures[1].detail.classification, failures[0].detail.classification);
  assert.equal(failures[1].hint, failures[0].hint);
  assert.equal(cooldownState.map.size, 0);
});

it('keeps the 1/2/4 second HTTP 429 retries and records cooldown after exhaustion', async () => {
  vi.useFakeTimers();
  executePageApiRequest.mockResolvedValue({ status: 429, raw: null });
  const cooldownState = { map: new Map(), threshold: 1, ms: 300_000 };
  const client = new PlaywrightEndpointClient({ cooldownState });
  const ctx = { page: { url: () => 'https://mms.pinduoduo.com/' }, log: { debug() {} } };
  const rejection = assert.rejects(client.execute(TRAFFIC_READY_TIME, {}, ctx), (error) => {
    assert.equal(error.code, 'E_RATE_LIMIT');
    assert.equal(error.exitCode, ExitCodes.RATE_LIMIT);
    assert.equal(error.message, 'traffic.readyTime: rate limited after 3 retries');
    assert.equal(error.detail.status, 429);
    return true;
  });
  await vi.advanceTimersByTimeAsync(0);
  assert.equal(executePageApiRequest.mock.calls.length, 1);
  for (const [delay, calls] of [[1000, 2], [2000, 3], [4000, 4]]) {
    await vi.advanceTimersByTimeAsync(delay - 1);
    assert.equal(executePageApiRequest.mock.calls.length, calls - 1);
    await vi.advanceTimersByTimeAsync(1);
    assert.equal(executePageApiRequest.mock.calls.length, calls);
  }
  await rejection;
  assert.equal(cooldownState.map.get(TRAFFIC_READY_TIME.name).consecutiveFailures, 1);
  await assert.rejects(client.execute(TRAFFIC_READY_TIME, {}, ctx), (error) => {
    assert.equal(error.code, 'E_RATE_LIMIT');
    assert.equal(error.detail.cooldown_triggered, true);
    assert.equal(error.detail.cooldown_remaining_ms, 300_000);
    return true;
  });
  assert.equal(executePageApiRequest.mock.calls.length, 4);
});

it('normalizes a successful retry and clears previous rate-limit failures', async () => {
  vi.useFakeTimers();
  executePageApiRequest.mockResolvedValueOnce({ status: 429, raw: null });
  executePageApiRequest.mockResolvedValueOnce({ status: 200,
    raw: { success: true, errorCode: 0, result: '2026-10-30' } });
  const cooldownState = { map: new Map([[TRAFFIC_READY_TIME.name, { consecutiveFailures: 1 }]]), threshold: 3, ms: 300_000 };
  const client = new PlaywrightEndpointClient({ cooldownState });
  const ctx = { page: { url: () => 'https://mms.pinduoduo.com/' }, log: { debug() {} } };
  const pending = client.execute(TRAFFIC_READY_TIME, {}, ctx);
  await vi.advanceTimersByTimeAsync(1000);
  const result = await pending;
  assert.equal(result.data, '2026-10-30');
  assert.equal(result.meta.attempt, 2);
  assert.equal(executePageApiRequest.mock.calls.length, 2);
  assert.equal(cooldownState.map.size, 0);
});
