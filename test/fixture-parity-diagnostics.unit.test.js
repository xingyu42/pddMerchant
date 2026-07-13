import { describe, test, beforeEach, afterEach } from 'vitest';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runEndpoint } from '../src/adapter/run-endpoint.js';
import { getSharedLimiter, _resetSharedClient } from '../src/adapter/rate-limiter-singleton.js';
import {
  collectFixtureParityDiagnostics,
  flattenFixtureParityWarnings,
  validateFixtureParity,
} from '../src/adapter/fixture-parity-diagnostics.js';
import { ORDER_LIST } from '../src/adapter/endpoints/orders.js';
import { allEndpointSpecs } from './_endpoint-specs.js';

const FIXTURE_ENDPOINT_DIR = join(process.cwd(), 'test', 'fixtures', 'endpoints');

function fixtureNames() {
  return readdirSync(FIXTURE_ENDPOINT_DIR).filter((name) => name.endsWith('.json'));
}

function fixturePayloads(specs) {
  const payloads = new Map();
  for (const spec of specs) {
    const full = join(FIXTURE_ENDPOINT_DIR, `${spec.name}.json`);
    if (!existsSync(full)) continue;
    payloads.set(spec.name, JSON.parse(readFileSync(full, 'utf8')));
  }
  return payloads;
}

function warningsByCode(reports, code) {
  return flattenFixtureParityWarnings(reports).filter((item) => item.code === code);
}

function spyAcquire() {
  const limiter = getSharedLimiter();
  const calls = [];
  const original = limiter.acquire.bind(limiter);
  limiter.acquire = (label) => {
    calls.push(label);
    return original(label);
  };
  return {
    calls,
    restore: () => {
      limiter.acquire = original;
    },
  };
}

describe('fixture/live parity diagnostics', () => {
  let savedAdapter;

  beforeEach(() => {
    savedAdapter = process.env.PDD_TEST_ADAPTER;
    _resetSharedClient();
  });

  afterEach(() => {
    if (savedAdapter === undefined) delete process.env.PDD_TEST_ADAPTER;
    else process.env.PDD_TEST_ADAPTER = savedAdapter;
    _resetSharedClient();
  });

  test('collects warning-first diagnostics for all endpoint specs without hard failures', () => {
    const reports = collectFixtureParityDiagnostics(allEndpointSpecs, {
      fixtureNames: fixtureNames(),
      fixturePayloads: fixturePayloads(allEndpointSpecs),
    });

    assert.equal(reports.length, allEndpointSpecs.length);
    assert.deepEqual(
      reports.filter((report) => !report.valid).map((report) => report.name),
      [],
      'existing endpoint parity diagnostics should remain warning-first',
    );
  });

  test('reports endpoint specs that currently have no base endpoint fixture', () => {
    const reports = collectFixtureParityDiagnostics(allEndpointSpecs, {
      fixtureNames: fixtureNames(),
      fixturePayloads: fixturePayloads(allEndpointSpecs),
    });

    const missing = warningsByCode(reports, 'MISSING_BASE_FIXTURE').map((item) => item.endpoint).sort();

    assert.deepEqual(missing, [
      'goods.adStrategy',
      'goods.publish.create_draft',
      'goods.publish.edit_draft',
      'goods.publish.save_decoration',
      'goods.publish.template',
      'promo.hourlyReport',
    ]);
  });

  test('reports normalized fixture payloads that differ from FixtureEndpointClient output', () => {
    const report = validateFixtureParity(ORDER_LIST, {
      fixtureNames: fixtureNames(),
      fixturePayloads: fixturePayloads([ORDER_LIST]),
    });

    const codes = report.warnings.map((item) => item.code);
    assert.ok(codes.includes('BASE_FIXTURE_NOT_LIVE_SUCCESS'));
    assert.ok(codes.includes('FIXTURE_CLIENT_DATA_DIFFERS'));
  });

  test('reports page-specific fixture coverage without fixtureListKey synthesis contract', () => {
    const reports = collectFixtureParityDiagnostics(allEndpointSpecs, {
      fixtureNames: fixtureNames(),
      fixturePayloads: fixturePayloads(allEndpointSpecs),
    });

    const paginated = warningsByCode(reports, 'PAGINATED_FIXTURE_WITHOUT_LIST_KEY')
      .map((item) => item.endpoint);

    assert.deepEqual(paginated, ['goods.list']);
  });

  test('warning schema stays stable for downstream review tooling', () => {
    const report = validateFixtureParity(ORDER_LIST, {
      fixtureNames: fixtureNames(),
      fixturePayloads: fixturePayloads([ORDER_LIST]),
    });

    for (const item of report.warnings) {
      assert.equal(typeof item.code, 'string');
      assert.ok(['error', 'warning', 'info'].includes(item.severity));
      assert.equal(typeof item.message, 'string');
      assert.ok('field' in item);
      assert.ok('suggestion' in item);
      assert.ok('detail' in item);
    }
  });

  test('runEndpoint fixture path remains direct mockRunEndpoint short-circuit with no limiter acquire', async () => {
    process.env.PDD_TEST_ADAPTER = 'fixture';
    const { calls, restore } = spyAcquire();
    try {
      const result = await runEndpoint({ __fake: true }, ORDER_LIST, { page: 1 }, {});

      assert.equal(calls.length, 0);
      assert.equal(result.total, 3);
      assert.ok(Array.isArray(result.orders));
      assert.equal(result.raw?.source, 'fixtures/endpoints/orders.list.json');
    } finally {
      restore();
    }
  });
});
