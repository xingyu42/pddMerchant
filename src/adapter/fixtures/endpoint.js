// Endpoint fixture 保存原始上游响应；判定与归一化由共享 endpoint client 执行。
import { join } from 'node:path';
import { PddCliError, ExitCodes } from '../../infra/errors.js';
import { loadFixture } from './core.js';

function throwFixtureError(fixture, name) {
  if (!fixture?.__throws) return;
  const error = fixture.__error ?? {};
  throw new PddCliError({
    code: error.code ?? 'E_BUSINESS',
    message: error.message ?? `mock fixture ${name} business error`,
    hint: error.hint ?? '',
    detail: error.detail ?? null,
    exitCode: error.exitCode ?? ExitCodes.BUSINESS,
  });
}

function emptyPage(meta, fixture) {
  throwFixtureError(fixture, meta.name);
  const path = meta.fixtureListKey?.split('.');
  const raw = structuredClone(fixture);
  const parent = path?.slice(0, -1).reduce((value, key) => value?.[key], raw);
  const key = path?.at(-1);
  if (!parent || !Array.isArray(parent[key])) {
    throw new PddCliError({
      code: 'E_FIXTURE_SHAPE',
      message: `mockRunEndpoint(${meta.name}): fixtureListKey must locate an upstream array`,
      exitCode: ExitCodes.GENERAL,
    });
  }
  parent[key] = [];
  return raw;
}

// 可选 fixture：文件缺失时返回 null，其余加载错误照常抛出。
function tryLoadFixture(rel) {
  try {
    return loadFixture(join('endpoints', rel));
  } catch (error) {
    if (error?.code !== 'E_FIXTURE_MISSING') throw error;
    return null;
  }
}

// 声明 fixtureVariantKey 的 spec 按对应请求参数读取 `<spec.name>.<变体>.json`；变体文件缺失时返回 null 交给基础加载。
function loadVariantFixture(meta, params) {
  const variant = meta.fixtureVariantKey ? params[meta.fixtureVariantKey] : null;
  return variant == null ? null : tryLoadFixture(`${meta.name}.${variant}.json`);
}

function loadEndpointFixture(meta, page) {
  const paged = tryLoadFixture(`${meta.name}.page${page}.json`);
  if (paged) return paged;
  const base = loadFixture(join('endpoints', `${meta.name}.json`));
  return page === 1 ? base : emptyPage(meta, base);
}

// 优先读取显式分页 fixture；缺失的后续页仅清空列表，保留上游 envelope、总数和汇总。
export function mockRunEndpoint(meta, params = {}) {
  if (!meta?.name) {
    throw new PddCliError({
      code: 'E_USAGE',
      message: 'mockRunEndpoint: meta.name is required',
      exitCode: ExitCodes.USAGE,
    });
  }
  const raw = loadVariantFixture(meta, params) ?? loadEndpointFixture(meta, params.page ?? 1);
  throwFixtureError(raw, meta.name);
  return structuredClone(raw);
}
