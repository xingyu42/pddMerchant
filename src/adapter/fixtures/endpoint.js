// fixture endpoint provider（design D-4）：endpoint fixture 解析与 FixtureEndpointClient。
// 行为冻结：分页 .page<N>.json 兜底、__throws 协议、structuredClone、meta 字段（PROP-MOCK-1 基线钉死）。
import { join } from 'node:path';
import { PddCliError, ExitCodes } from '../../infra/errors.js';
import { loadFixture } from './core.js';

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
