// PROP-MOCK-1（refactor-arch-review-remediation task 1.2）
// 特征化基线：冻结 mock-dispatcher 当前可观测行为（design §D-4 行为冻结表），
// 作为 5.x 拆分（facade + per-domain providers）的等价性对照。
// 覆盖矩阵：fixture 名 / 页码 / __throws 载荷 / PDD_TEST_FIXTURE_DIR 变体 /
// 缓存清空语义（单 cache 实例）/ FixtureEndpointClient meta。
import { describe, it, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gen, property } from './_harness.js';
import {
  isMockEnabled,
  loadFixture,
  clearFixtureCache,
  mockRunEndpoint,
  FixtureEndpointClient,
  mockListMalls,
  mockSwitchTo,
} from '../../src/adapter/mock-dispatcher.js';
import { PddCliError, ExitCodes } from '../../src/infra/errors.js';
import { PROJECT_ROOT } from '../../src/infra/paths.js';

const DEFAULT_FIXTURE_DIR = join(PROJECT_ROOT, 'test', 'fixtures');

describe('mock-dispatcher behavior baseline PBT (PROP-MOCK-1)', () => {
  let tmpRoot;
  let savedDir;
  let savedAdapter;

  beforeAll(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'pdd-mock-baseline-'));
    mkdirSync(join(tmpRoot, 'endpoints'), { recursive: true });
  });

  afterAll(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  beforeEach(() => {
    savedDir = process.env.PDD_TEST_FIXTURE_DIR;
    savedAdapter = process.env.PDD_TEST_ADAPTER;
    clearFixtureCache();
  });

  afterEach(() => {
    if (savedDir !== undefined) process.env.PDD_TEST_FIXTURE_DIR = savedDir;
    else delete process.env.PDD_TEST_FIXTURE_DIR;
    if (savedAdapter !== undefined) process.env.PDD_TEST_ADAPTER = savedAdapter;
    else delete process.env.PDD_TEST_ADAPTER;
    clearFixtureCache();
  });

  it('PROP-MOCK-1a: fixture data round-trips and cache returns one shared reference until cleared', async () => {
    process.env.PDD_TEST_FIXTURE_DIR = tmpRoot;
    const payloadGen = gen.record({
      total: gen.int(0, 500),
      label: gen.string({ minLen: 1, maxLen: 12 }),
      items: gen.arrayOf(gen.record({ id: gen.int(1, 9999), name: gen.string({ minLen: 1, maxLen: 8 }) }), { maxLen: 5 }),
    });
    let seq = 0;
    await property('fixture-roundtrip-cache-identity', payloadGen, (payload) => {
      const name = `probe-a-${seq++}`;
      const relPath = join('endpoints', `${name}.json`);
      writeFileSync(join(tmpRoot, relPath), JSON.stringify(payload));

      const viaEndpoint = mockRunEndpoint({ name }, { page: 1 });
      assert.deepEqual(viaEndpoint, payload);

      const first = loadFixture(relPath);
      const second = loadFixture(relPath);
      assert.ok(first === second, 'repeated loadFixture must return the same cached reference');
      assert.ok(viaEndpoint === first, 'mockRunEndpoint must share the same cache entry as loadFixture');

      clearFixtureCache();
      const third = loadFixture(relPath);
      assert.ok(third !== first, 'clearFixtureCache must drop the cached entry');
      assert.deepEqual(third, first);
      return true;
    });
  });

  it('PROP-MOCK-1b: __throws protocol maps to PddCliError with documented defaults (?? semantics, falsy preserved)', async () => {
    process.env.PDD_TEST_FIXTURE_DIR = tmpRoot;
    const throwsGen = gen.record({
      hasErrorBody: gen.bool(),
      hasCode: gen.bool(),
      hasMessage: gen.bool(),
      hasHint: gen.bool(),
      hasExit: gen.bool(),
      hasDetail: gen.bool(),
      code: gen.oneOf(['E_RATE_LIMIT', 'E_AUTH_EXPIRED', 'E_CUSTOM_BIZ']),
      // 空串/0 是刻意的 falsy 探针：当前实现用 ?? — 改成 || 必须被本测试证伪
      message: gen.oneOf(['', 'boom-msg']),
      hint: gen.oneOf(['', 'try-this']),
      exitCode: gen.oneOf([0, 1, 2, 3, 4, 5, 6]),
      detail: gen.record({ why: gen.string({ minLen: 1, maxLen: 8 }) }),
    });
    let seq = 0;
    await property('throws-protocol-mapping', throwsGen, (s) => {
      const name = `probe-b-${seq++}`;
      const present = (flag) => s.hasErrorBody && flag;
      const errorBody = {
        ...(present(s.hasCode) ? { code: s.code } : {}),
        ...(present(s.hasMessage) ? { message: s.message } : {}),
        ...(present(s.hasHint) ? { hint: s.hint } : {}),
        ...(present(s.hasExit) ? { exitCode: s.exitCode } : {}),
        ...(present(s.hasDetail) ? { detail: s.detail } : {}),
      };
      writeFileSync(
        join(tmpRoot, 'endpoints', `${name}.json`),
        JSON.stringify({ __throws: true, ...(s.hasErrorBody ? { __error: errorBody } : {}) }),
      );
      assert.throws(
        () => mockRunEndpoint({ name }, { page: 1 }),
        (err) => {
          assert.ok(err instanceof PddCliError);
          assert.equal(err.code, present(s.hasCode) ? s.code : 'E_BUSINESS');
          assert.equal(err.message, present(s.hasMessage) ? s.message : `mock fixture ${name} business error`);
          assert.equal(err.hint, present(s.hasHint) ? s.hint : '');
          assert.equal(err.exitCode, present(s.hasExit) ? s.exitCode : ExitCodes.BUSINESS);
          assert.deepEqual(err.detail, present(s.hasDetail) ? s.detail : null);
          return true;
        },
      );
      return true;
    });
  });

  it('PROP-MOCK-1c: pagination prefers .pageN.json (any N incl. 1), synthesizes empty list via fixtureListKey, errors without it', async () => {
    process.env.PDD_TEST_FIXTURE_DIR = tmpRoot;
    const pagGen = gen.record({
      hasPage1File: gen.bool(),
      hasPageNFile: gen.bool(),
      hasListKeyMeta: gen.bool(),
      hasTotalField: gen.bool(),
      pageN: gen.oneOf([2, 3]),
      page1Items: gen.arrayOf(gen.int(1, 100), { maxLen: 4 }),
      total: gen.int(0, 999),
      pageNItems: gen.arrayOf(gen.int(1, 100), { minLen: 1, maxLen: 3 }),
    });
    let seq = 0;
    await property('pagination-matrix', pagGen, (s) => {
      const name = `probe-c-${seq++}`;
      const base = { items: s.page1Items, ...(s.hasTotalField ? { total: s.total } : {}) };
      writeFileSync(join(tmpRoot, 'endpoints', `${name}.json`), JSON.stringify(base));
      const page1File = { items: s.page1Items, marker: 'p1-file' };
      if (s.hasPage1File) {
        writeFileSync(join(tmpRoot, 'endpoints', `${name}.page1.json`), JSON.stringify(page1File));
      }
      const pageNFile = { items: s.pageNItems, marker: 'pN-file' };
      if (s.hasPageNFile) {
        writeFileSync(join(tmpRoot, 'endpoints', `${name}.page${s.pageN}.json`), JSON.stringify(pageNFile));
      }
      const meta = { name, ...(s.hasListKeyMeta ? { fixtureListKey: 'items' } : {}) };

      assert.deepEqual(
        mockRunEndpoint(meta, { page: 1 }),
        s.hasPage1File ? page1File : base,
        'page 1 prefers .page1.json when present, else falls back to base fixture',
      );

      if (s.hasPageNFile) {
        assert.deepEqual(mockRunEndpoint(meta, { page: s.pageN }), pageNFile, '.pageN.json must win when present');
      } else if (s.hasListKeyMeta) {
        assert.deepEqual(
          mockRunEndpoint(meta, { page: s.pageN }),
          { items: [], total: s.hasTotalField ? s.total : s.page1Items.length },
          'missing page>=2 synthesizes empty list with BASE fixture total fallback (not .page1.json)',
        );
      } else {
        assert.throws(
          () => mockRunEndpoint(meta, { page: s.pageN }),
          (err) => err instanceof PddCliError
            && err.code === 'E_FIXTURE_SHAPE'
            && err.exitCode === ExitCodes.GENERAL,
        );
      }
      return true;
    });
  });

  it('PROP-MOCK-1d: missing fixture and missing meta.name map to documented errors', () => {
    process.env.PDD_TEST_FIXTURE_DIR = tmpRoot;
    const missingPath = join(tmpRoot, 'endpoints', 'definitely-missing.json');
    assert.throws(
      () => mockRunEndpoint({ name: 'definitely-missing' }, { page: 1 }),
      (err) => err instanceof PddCliError
        && err.code === 'E_FIXTURE_MISSING'
        && err.exitCode === ExitCodes.GENERAL
        && err.message.includes(missingPath),
    );
    assert.throws(
      () => mockRunEndpoint({}, {}),
      (err) => err instanceof PddCliError && err.code === 'E_USAGE' && err.exitCode === ExitCodes.USAGE,
    );
  });

  it('PROP-MOCK-1e: FixtureEndpointClient meta shape, {raw} default wrap, and clone immunity', async () => {
    process.env.PDD_TEST_FIXTURE_DIR = tmpRoot;
    const cliGen = gen.record({
      corr: gen.string({ minLen: 4, maxLen: 12 }),
      useNormalize: gen.bool(),
      value: gen.record({ k: gen.int(0, 99), tag: gen.string({ minLen: 1, maxLen: 6 }) }),
    });
    let seq = 0;
    await property('client-meta-and-clone', cliGen, async (s) => {
      const name = `probe-e-${seq++}`;
      writeFileSync(join(tmpRoot, 'endpoints', `${name}.json`), JSON.stringify(s.value));

      const client = new FixtureEndpointClient();
      const spec = {
        name,
        ...(s.useNormalize ? { normalize: (raw) => ({ wrapped: raw, marker: 'norm' }) } : {}),
      };
      const res = await client.execute(spec, { page: 1 }, { correlation_id: s.corr });

      assert.deepEqual(res.meta, {
        attempt: 1,
        limiter_wait_ms: 0,
        endpoint: name,
        correlation_id: s.corr,
      });
      const expected = s.useNormalize
        ? { wrapped: s.value, marker: 'norm' }
        : { raw: s.value };
      assert.deepEqual(res.data, expected, s.useNormalize ? 'normalize output' : 'no-normalize default wraps payload as { raw }');

      // 嵌套突变探针：normalize/{raw} 包裹层每次新建，仅顶层突变测不出 structuredClone 缺失
      if (s.useNormalize) res.data.wrapped.tag = '__MUTATED__';
      else res.data.raw.tag = '__MUTATED__';
      res.data.__mutated = true;
      const again = await client.execute(spec, { page: 1 }, { correlation_id: s.corr });
      assert.deepEqual(again.data, expected, 'execute must structuredClone — nested caller mutation must not corrupt the cache');
      return true;
    });
  });

  it('PROP-MOCK-1f: PDD_TEST_FIXTURE_DIR variants — default, relative (PROJECT_ROOT-based), absolute', () => {
    const real = JSON.parse(readFileSync(join(DEFAULT_FIXTURE_DIR, 'shops.current.json'), 'utf8'));

    delete process.env.PDD_TEST_FIXTURE_DIR;
    clearFixtureCache();
    assert.deepEqual(loadFixture('shops.current.json'), real, 'unset env reads test/fixtures default');

    process.env.PDD_TEST_FIXTURE_DIR = join('test', 'fixtures');
    clearFixtureCache();
    assert.deepEqual(loadFixture('shops.current.json'), real, 'relative env resolves against PROJECT_ROOT');

    process.env.PDD_TEST_FIXTURE_DIR = tmpRoot;
    clearFixtureCache();
    const tempMall = { id: 'tmp-1', name: 'temp-mall' };
    writeFileSync(join(tmpRoot, 'shops.current.json'), JSON.stringify(tempMall));
    assert.deepEqual(loadFixture('shops.current.json'), tempMall, 'absolute env reads the override dir');
  });

  it('PROP-MOCK-1g: mall functions resolve through the single shared cache (anti double-cache counterexample)', () => {
    delete process.env.PDD_TEST_FIXTURE_DIR;
    clearFixtureCache();

    const list = mockListMalls();
    assert.ok(list === loadFixture('shops.list.json'), 'mockListMalls and loadFixture must share one cache entry');
    assert.ok(Array.isArray(list) && list.length > 0 && list[0]?.id != null, 'fixture shops.list.json must be non-empty');

    const target = list[0];
    assert.deepEqual(mockSwitchTo(String(target.id)), { ...target, active: true });

    // 读穿证明：污染缓存对象后 switchTo 必须观察到 marker —— 深拷贝双缓存无法伪装
    target.__cacheMarker = 'probe-m1';
    assert.equal(
      mockSwitchTo(String(target.id)).__cacheMarker,
      'probe-m1',
      'mockSwitchTo must read through the SAME cache entry, not a second cache',
    );
    delete target.__cacheMarker;

    assert.throws(
      () => mockSwitchTo('no-such-mall-id'),
      (err) => err instanceof PddCliError && err.code === 'E_MALL_NOT_FOUND' && err.exitCode === ExitCodes.USAGE,
    );
    assert.throws(
      () => mockSwitchTo(''),
      (err) => err instanceof PddCliError && err.code === 'E_USAGE' && err.exitCode === ExitCodes.USAGE,
    );
  });

  it('PROP-MOCK-1h: isMockEnabled is true only for the exact string "fixture"', () => {
    process.env.PDD_TEST_ADAPTER = 'fixture';
    assert.equal(isMockEnabled(), true);
    for (const variant of [undefined, '', '1', 'true', 'FIXTURE', 'Fixture', 'fixture ']) {
      if (variant === undefined) delete process.env.PDD_TEST_ADAPTER;
      else process.env.PDD_TEST_ADAPTER = variant;
      assert.equal(isMockEnabled(), false, `PDD_TEST_ADAPTER=${JSON.stringify(variant)} must not enable mock`);
    }
  });
});
