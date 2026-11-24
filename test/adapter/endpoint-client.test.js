import { afterEach, beforeEach, it, vi } from 'vitest';
import assert from 'node:assert/strict';
import { EndpointClient, PlaywrightEndpointClient } from '../../src/adapter/endpoint-client.js';
import { executePageApiRequest } from '../../src/adapter/page-api-client.js';
import { FixtureStore } from '../../src/adapter/fixtures/core.js';
import { createFixtureEndpointTransport } from '../../src/adapter/fixtures/endpoint.js';
import { TRAFFIC_READY_TIME } from '../../src/adapter/endpoints/traffic.js';
import { PddCliError, ExitCodes } from '../../src/infra/errors.js';
import { createCliSandbox } from '../helpers/isolated-cli.js';

vi.mock('../../src/adapter/page-api-client.js', () => ({ executePageApiRequest: vi.fn() }));

let sandbox;
beforeEach(() => {
  executePageApiRequest.mockReset();
});
afterEach(() => {
  sandbox?.dispose();
  sandbox = null;
});

function fixtureClientFor(fixtureDir, opts = {}) {
  return new EndpointClient({
    transport: createFixtureEndpointTransport({ fixtureStore: new FixtureStore({ fixtureDir }) }),
    ...opts,
  });
}

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

it('forwards GET or default POST method for page-api specs and rejects unsupported methods or GET payloads in both modes', async () => {
  executePageApiRequest.mockResolvedValue({ status: 200, raw: { success: true, errorCode: 0, result: { ok: 1 } } });
  const client = new PlaywrightEndpointClient();
  const ctx = { page: { url: () => 'https://mms.pinduoduo.com/' }, log: { debug() {} } };
  const postSpec = { name: 'test.pageApiMethod', strategy: 'page-api', apiUrl: '/desert/test',
    buildPayload: () => ({ a: 1 }), normalize: (raw) => raw.result };
  const getSpec = { ...postSpec, method: 'get', buildPayload: () => ({}) };

  await client.execute(postSpec, {}, ctx);
  await client.execute(getSpec, {}, ctx);
  assert.equal(executePageApiRequest.mock.calls[0][1].method, 'POST');
  assert.equal(executePageApiRequest.mock.calls[1][1].method, 'GET');

  await assert.rejects(client.execute({ ...postSpec, method: 'DELETE' }, {}, ctx),
    { code: 'E_USAGE', exitCode: ExitCodes.USAGE });
  for (const invalidGetPayload of [() => ({ page: 2 }), () => new URLSearchParams({ page: '2' })]) {
    await assert.rejects(client.execute({ ...postSpec, method: 'GET', buildPayload: invalidGetPayload }, {}, ctx),
      { code: 'E_USAGE', exitCode: ExitCodes.USAGE });
  }
  assert.equal(executePageApiRequest.mock.calls.length, 2);

  sandbox = createCliSandbox({
    'endpoints/test.pageApiMethod.json': { success: true, errorCode: 1000000, result: { ok: 2 } },
  });
  const fixtureClient = fixtureClientFor(sandbox.fixtureDir);
  const fixtureRes = await fixtureClient.execute({ ...getSpec, method: 'GET' }, {}, { log: ctx.log });
  assert.deepEqual(fixtureRes.data, { ok: 2 });
  await assert.rejects(fixtureClient.execute({ ...postSpec, method: 'DELETE' }, {}, { log: ctx.log }),
    { code: 'E_USAGE', exitCode: ExitCodes.USAGE });
  for (const invalidGetPayload of [() => ({ page: 2 }), () => new URLSearchParams({ page: '2' })]) {
    await assert.rejects(fixtureClient.execute({ ...postSpec, method: 'GET', buildPayload: invalidGetPayload }, {}, { log: ctx.log }),
      { code: 'E_USAGE', exitCode: ExitCodes.USAGE });
  }
});

it('resolves functional apiUrl for page-api endpoints in both fixture and live modes', async () => {
  executePageApiRequest.mockReset();
  executePageApiRequest.mockResolvedValue({ status: 200, raw: { success: true, errorCode: 0, result: { ok: 3 } } });
  const client = new PlaywrightEndpointClient();
  const ctx = { page: { url: () => 'https://mms.pinduoduo.com/' }, log: { debug() {} } };
  const dynamicGetSpec = {
    name: 'test.pageApiMethod',
    strategy: 'page-api',
    method: 'GET',
    apiUrl: ({ shippingId, trackingNumber }) =>
      `/express_base/mms/track/sale_back?shippingId=${shippingId}&trackingNumber=${trackingNumber}`,
    buildPayload: () => null,
    normalize: (raw) => raw.result,
  };

  const liveRes = await client.execute(dynamicGetSpec, { shippingId: 85, trackingNumber: 'YT123' }, ctx);
  assert.deepEqual(liveRes.data, { ok: 3 });
  assert.equal(
    executePageApiRequest.mock.calls[0][1].apiUrl,
    '/express_base/mms/track/sale_back?shippingId=85&trackingNumber=YT123',
  );

  sandbox = createCliSandbox({
    'endpoints/test.pageApiMethod.json': { success: true, errorCode: 0, result: { ok: 4 } },
  });
  const fixtureClient = fixtureClientFor(sandbox.fixtureDir);
  const fixtureRes = await fixtureClient.execute(dynamicGetSpec, { shippingId: 85, trackingNumber: 'YT123' }, { log: ctx.log });
  assert.deepEqual(fixtureRes.data, { ok: 4 });

  const brokenUrlSpec = { ...dynamicGetSpec, apiUrl: () => '' };
  await assert.rejects(fixtureClient.execute(brokenUrlSpec, {}, { log: ctx.log }), { code: 'E_USAGE', exitCode: ExitCodes.USAGE });

  const validatedPostSpec = {
    name: 'test.pageApiMethod',
    strategy: 'page-api',
    method: 'POST',
    apiUrl: '/artascope/express/track/query',
    buildPayload: ({ orderSn }) => {
      if (!orderSn) {
        throw new PddCliError({ code: 'E_USAGE', message: 'missing orderSn', exitCode: ExitCodes.USAGE });
      }
      return { orderSn };
    },
    normalize: (raw) => raw.result,
  };
  await assert.rejects(fixtureClient.execute(validatedPostSpec, {}, { log: ctx.log }), { code: 'E_USAGE', exitCode: ExitCodes.USAGE });
});

it('redacts page-api transport rejection reasons before emitting E_NETWORK', async () => {
  executePageApiRequest.mockReset();
  executePageApiRequest.mockResolvedValue({
    status: null,
    raw: null,
    transportError: true,
    message: '收件人张三13812345678取件码956025',
  });
  const client = new PlaywrightEndpointClient();
  const ctx = { page: { url: () => 'https://mms.pinduoduo.com/' }, log: { debug() {} } };
  await assert.rejects(client.execute(TRAFFIC_READY_TIME, {}, ctx), (error) => {
    assert.equal(error.code, 'E_NETWORK');
    assert.equal(error.exitCode, ExitCodes.NETWORK);
    assert.equal(error.detail.reason, 'page_api_transport_error');
    const serialized = JSON.stringify({ message: error.message, hint: error.hint, detail: error.detail });
    for (const leaked of ['张三', '13812345678', '956025']) {
      assert.equal(serialized.includes(leaked), false);
    }
    return true;
  });
});

it('requires an EndpointTransportPort and exposes call() and execute() over send()', async () => {
  assert.throws(() => new EndpointClient(), { code: 'E_CONFIG_INVALID' });
  assert.throws(() => new EndpointClient({ transport: {} }), { code: 'E_CONFIG_INVALID' });

  const sleep = vi.fn(async () => {});
  const send = vi.fn()
    .mockResolvedValueOnce({ status: 429, raw: null, response: { status: () => 429 } })
    .mockResolvedValueOnce({ status: 200, raw: { success: true, errorCode: 0, result: '2026-10-30' }, response: { status: () => 200 } });
  const cooldownState = { map: new Map(), threshold: 2, ms: 300_000 };
  const client = new EndpointClient({ transport: { send }, cooldownState, clock: { now: () => 1000, sleep } });

  const opaquePage = { token: 'opaque' };
  const data = await client.call(TRAFFIC_READY_TIME, { extra: 1 }, { page: opaquePage, log: { debug() {} } });
  assert.equal(data, '2026-10-30');
  assert.equal(send.mock.calls.length, 2);
  assert.equal(sleep.mock.calls.length, 1);
  assert.equal(sleep.mock.calls[0][0], 1000);
  assert.equal(send.mock.calls[0][2].page, opaquePage);
  assert.deepEqual(send.mock.calls[0][2].pageApiRequest, {
    apiUrl: TRAFFIC_READY_TIME.apiUrl,
    method: 'POST',
    payload: {},
  });

  send.mockResolvedValueOnce({ status: 200, raw: { success: true, errorCode: 0, result: '2026-10-31' }, response: { status: () => 200 } });
  const executed = await client.execute(TRAFFIC_READY_TIME, {}, { page: null, correlation_id: 'corr-1', log: { debug() {} } });
  assert.deepEqual(executed, {
    data: '2026-10-31',
    meta: { attempt: 1, limiter_wait_ms: 0, endpoint: TRAFFIC_READY_TIME.name, correlation_id: 'corr-1' },
  });
});
