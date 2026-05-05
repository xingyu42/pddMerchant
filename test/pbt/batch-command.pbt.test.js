import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { gen, property, getSeed, getRuns } from './_harness.js';
import { batchExitCode, ExitCodes } from '../../src/infra/errors.js';
import { buildBatchEnvelope } from '../../src/infra/output.js';

describe('batch-command PBT', () => {
  const exitCodeGen = gen.oneOf([
    ExitCodes.OK, ExitCodes.GENERAL, ExitCodes.USAGE,
    ExitCodes.AUTH, ExitCodes.RATE_LIMIT, ExitCodes.NETWORK,
    ExitCodes.BUSINESS, ExitCodes.PARTIAL,
  ]);

  it('PROP-BC-1: batchExitCode returns OK when all accounts succeed', async () => {
    const accountGen = gen.record({
      count: gen.int(1, 10),
    });
    await property('all-succeed-returns-ok', accountGen, ({ count }) => {
      const results = {};
      for (let i = 0; i < count; i++) {
        results[`shop-${i}`] = { ok: true, exit_code: ExitCodes.OK };
      }
      return batchExitCode(results) === ExitCodes.OK;
    });
  });

  it('PROP-BC-2: batchExitCode returns PARTIAL when mixed success/failure', async () => {
    const mixedGen = gen.record({
      failCode: exitCodeGen,
    });
    await property('mixed-returns-partial', mixedGen, ({ failCode }) => {
      if (failCode === ExitCodes.OK) return true;
      const results = {
        'ok-shop': { ok: true, exit_code: ExitCodes.OK },
        'fail-shop': { ok: false, exit_code: failCode },
      };
      return batchExitCode(results) === ExitCodes.PARTIAL;
    });
  });

  it('PROP-BC-3: batchExitCode returns highest-severity code when all fail', async () => {
    const SEVERITY = { 3: 6, 4: 5, 5: 4, 6: 3, 1: 2, 2: 1, 0: 0, 7: 7 };
    const failGen = gen.record({
      codes: gen.arrayOf(gen.oneOf([
        ExitCodes.GENERAL, ExitCodes.USAGE, ExitCodes.AUTH,
        ExitCodes.RATE_LIMIT, ExitCodes.NETWORK, ExitCodes.BUSINESS,
      ]), { minLen: 1, maxLen: 6 }),
    });
    await property('all-fail-highest-severity', failGen, ({ codes }) => {
      const results = {};
      for (let i = 0; i < codes.length; i++) {
        results[`shop-${i}`] = { ok: false, exit_code: codes[i] };
      }
      const result = batchExitCode(results);
      const expected = codes.sort((a, b) => (SEVERITY[b] ?? 0) - (SEVERITY[a] ?? 0))[0];
      return result === expected;
    });
  });

  it('PROP-BC-4: buildBatchEnvelope summary counts are consistent', async () => {
    const envGen = gen.record({
      numOk: gen.int(0, 5),
      numFail: gen.int(0, 5),
    });
    await property('summary-consistency', envGen, ({ numOk, numFail }) => {
      if (numOk + numFail === 0) return true;
      const accountResults = {};
      for (let i = 0; i < numOk; i++) {
        accountResults[`ok-${i}`] = { ok: true, data: { v: i }, latency_ms: 100, meta: { latency_ms: 100 } };
      }
      for (let i = 0; i < numFail; i++) {
        accountResults[`fail-${i}`] = { ok: false, error: { code: 'E_AUTH_EXPIRED' }, latency_ms: 50, meta: { latency_ms: 50 } };
      }
      const env = buildBatchEnvelope('test.cmd', accountResults, { exit_code: 0 });
      const s = env.data.summary;
      return s.total_accounts === numOk + numFail
        && s.succeeded === numOk
        && s.failed === numFail
        && s.attempted === numOk + numFail;
    });
  });

  it('PROP-BC-5: buildBatchEnvelope.ok is true only when all succeed', async () => {
    const mixGen = gen.record({
      hasOk: gen.bool(),
      hasFail: gen.bool(),
    });
    await property('ok-only-all-succeed', mixGen, ({ hasOk, hasFail }) => {
      if (!hasOk && !hasFail) return true;
      const accountResults = {};
      if (hasOk) accountResults['ok-shop'] = { ok: true, data: null, latency_ms: 10 };
      if (hasFail) accountResults['fail-shop'] = { ok: false, error: { code: 'E_GENERAL' }, latency_ms: 10 };
      const env = buildBatchEnvelope('test.cmd', accountResults, { exit_code: 0 });
      return env.ok === (hasOk && !hasFail);
    });
  });

  it('PROP-BC-6: buildBatchEnvelope sets meta.batch=true', async () => {
    await property('batch-flag', gen.int(1, 5), (n) => {
      const results = {};
      for (let i = 0; i < n; i++) results[`s-${i}`] = { ok: true, data: null, latency_ms: 1 };
      const env = buildBatchEnvelope('test.cmd', results, {});
      return env.meta.batch === true;
    });
  });

  it('PROP-BC-7: buildBatchEnvelope error codes match expected patterns', async () => {
    const scenarioGen = gen.oneOf(['all-ok', 'partial', 'all-fail']);
    await property('error-code-patterns', scenarioGen, (scenario) => {
      const results = {};
      if (scenario === 'all-ok') {
        results['a'] = { ok: true, data: null, latency_ms: 1 };
      } else if (scenario === 'partial') {
        results['a'] = { ok: true, data: null, latency_ms: 1 };
        results['b'] = { ok: false, error: { code: 'E_AUTH_EXPIRED' }, latency_ms: 1 };
      } else {
        results['a'] = { ok: false, error: { code: 'E_AUTH_EXPIRED' }, latency_ms: 1 };
      }
      const env = buildBatchEnvelope('test.cmd', results, {});
      if (scenario === 'all-ok') return env.error === null;
      if (scenario === 'partial') return env.error?.code === 'E_PARTIAL';
      return env.error?.code === 'E_BATCH_ALL_FAILED';
    });
  });

  it('PROP-BC-8: batchExitCode with empty results returns OK', () => {
    assert.strictEqual(batchExitCode({}), ExitCodes.OK);
  });

  it('PROP-BC-9: buildBatchEnvelope preserves per-account data/error', async () => {
    await property('preserves-per-account', gen.int(1, 4), (n) => {
      const results = {};
      for (let i = 0; i < n; i++) {
        results[`s-${i}`] = { ok: true, data: { idx: i }, latency_ms: i * 10, meta: { latency_ms: i * 10 } };
      }
      const env = buildBatchEnvelope('test.cmd', results, {});
      for (let i = 0; i < n; i++) {
        if (env.data.accounts[`s-${i}`].data.idx !== i) return false;
      }
      return true;
    });
  });
});
