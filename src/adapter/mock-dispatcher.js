// Fixture-based mock dispatcher for E2E testing.
// 激活方式：设置 PDD_TEST_ADAPTER=fixture 环境变量。
// 作用范围：browser/auth-state/mall-switcher/run-endpoint 四个适配器模块在入口处短路到本文件。
// 生产环境不受影响（默认返回 false）。

import { existsSync, readFileSync } from 'node:fs';
import { join, isAbsolute } from 'node:path';
import { PddCliError, ExitCodes } from '../infra/errors.js';
import { PROJECT_ROOT } from '../infra/paths.js';

const ENV_ENABLED = 'PDD_TEST_ADAPTER';
const ENV_FIXTURE_DIR = 'PDD_TEST_FIXTURE_DIR';
const ENV_AUTH_INVALID = 'PDD_TEST_AUTH_INVALID';

export function isMockEnabled() {
  return process.env[ENV_ENABLED] === 'fixture';
}

function fixtureDir() {
  const override = process.env[ENV_FIXTURE_DIR];
  if (override && override.length > 0) {
    return isAbsolute(override) ? override : join(PROJECT_ROOT, override);
  }
  return join(PROJECT_ROOT, 'test', 'fixtures');
}

const cache = new Map();

export function loadFixture(relPath) {
  const full = join(fixtureDir(), relPath);
  if (cache.has(full)) return cache.get(full);
  if (!existsSync(full)) {
    throw new PddCliError({
      code: 'E_FIXTURE_MISSING',
      message: `mock adapter: fixture not found at ${full}`,
      hint: `确认 ${ENV_FIXTURE_DIR} 与 fixture 文件名`,
      exitCode: ExitCodes.GENERAL,
    });
  }
  const raw = readFileSync(full, 'utf8');
  const parsed = JSON.parse(raw);
  cache.set(full, parsed);
  return parsed;
}

export function clearFixtureCache() {
  cache.clear();
}

// ---------- browser.js ----------
export function mockLaunchBrowser() {
  const page = { __mock: true };
  const context = { __mock: true };
  const browser = { __mock: true };
  return { browser, context, page };
}

export async function mockCloseBrowser() {
  // no-op
}

// ---------- auth-state.js ----------
export function mockIsAuthValid() {
  return process.env[ENV_AUTH_INVALID] !== '1';
}

// ---------- mall-switcher.js ----------
export function mockListMalls() {
  return loadFixture('shops.list.json');
}

export function mockCurrentMall() {
  return loadFixture('shops.current.json');
}

export function mockSwitchTo(mallId) {
  const target = String(mallId ?? '');
  if (!target) {
    throw new PddCliError({
      code: 'E_USAGE',
      message: 'switchTo: mallId 必填',
      exitCode: ExitCodes.USAGE,
    });
  }
  const list = loadFixture('shops.list.json');
  const found = Array.isArray(list)
    ? list.find((m) => String(m?.id) === target)
    : null;
  if (!found) {
    throw new PddCliError({
      code: 'E_MALL_NOT_FOUND',
      message: `未找到店铺 ${target}`,
      hint: '执行 pdd shops list 查看可用店铺',
      exitCode: ExitCodes.USAGE,
    });
  }
  return { ...found, active: true };
}

// ---------- run-endpoint.js ----------
// Fixture 文件位于 test/fixtures/endpoints/<meta.name>.json
// 分页支持：优先查找 <name>.page<N>.json，兜底 <name>.json（page 1）。
// page >= 2 且无对应 fixture → 合成空列表 { [fixtureListKey]: [], total }。
// 若文件包含 { __throws: true, __error: {...} }，则抛出对应 PddCliError
export function mockRunEndpoint(meta, params = {}) {
  const name = meta?.name;
  if (!name) {
    throw new PddCliError({
      code: 'E_USAGE',
      message: 'mockRunEndpoint: meta.name is required',
      exitCode: ExitCodes.USAGE,
    });
  }

  const page = params.page ?? 1;
  const pagePath = join('endpoints', `${name}.page${page}.json`);
  const basePath = join('endpoints', `${name}.json`);

  let fx;
  try {
    fx = loadFixture(pagePath);
  } catch {
    if (page === 1) {
      fx = loadFixture(basePath);
    } else {
      const page1 = loadFixture(basePath);
      const listKey = meta.fixtureListKey;
      if (!listKey) {
        throw new PddCliError({
          code: 'E_FIXTURE_SHAPE',
          message: `mockRunEndpoint(${name}): meta.fixtureListKey required for pagination end-of-list synthesis`,
          exitCode: ExitCodes.GENERAL,
        });
      }
      const total = page1?.total ?? (Array.isArray(page1?.[listKey]) ? page1[listKey].length : 0);
      return { [listKey]: [], total };
    }
  }

  if (fx && typeof fx === 'object' && fx.__throws) {
    const e = fx.__error ?? {};
    throw new PddCliError({
      code: e.code ?? 'E_BUSINESS',
      message: e.message ?? `mock fixture ${name} business error`,
      hint: e.hint ?? '',
      detail: e.detail ?? null,
      exitCode: e.exitCode ?? ExitCodes.BUSINESS,
    });
  }
  return fx;
}

export class FixtureEndpointClient {
  async execute(spec, params = {}, _ctx = {}) {
    const raw = mockRunEndpoint(spec, params);
    const normalized = typeof spec.normalize === 'function' ? spec.normalize(raw) : { raw };
    const data = structuredClone(normalized);
    return {
      data,
      meta: {
        attempt: 1,
        limiter_wait_ms: 0,
        endpoint: spec.name,
        correlation_id: _ctx.correlation_id,
      },
    };
  }
}

// ---------- auth-refresher.js ----------
export function mockRefreshAuth() {
  if (process.env.PDD_TEST_AUTH_INVALID === '1') {
    return { success: false, reason: 'auth_expired', qrPngPath: null };
  }
  return { success: true, reason: 'refreshed' };
}

// ---------- account-registry.js ----------
export function mockAccountRegistry() {
  try {
    return loadFixture('accounts.json');
  } catch {
    return null;
  }
}

// ---------- credential-vault.js ----------
export function mockDecryptCredential() {
  return { version: 1, mobile: '13800138000', password: 'mock-password', createdAt: '2026-05-03T00:00:00Z' };
}

// ---------- password-login.js ----------
export function mockPasswordLogin({ mobile, authStatePath } = {}) {
  try {
    const fixture = loadFixture('endpoints/password-login.json');
    return { ...fixture, authStatePath: authStatePath ?? fixture.authStatePath };
  } catch {
    return {
      success: true,
      mode: 'password',
      authStatePath,
      mall: { id: '445301049', name: '测试店铺' },
      savedAt: new Date().toISOString(),
    };
  }
}
