// fixture 运行时（design D-2）：PDD_TEST_ADAPTER=fixture 短路路径。
// fixture auth 失败、mock mall 解析、FixtureEndpointClient ctx 构造与 run 终结。
import { FixtureEndpointClient, mockCurrentMall, mockListMalls, mockIsAuthValid, mockIsAuthIndeterminate } from '../../adapter/mock-dispatcher.js';
import { buildMallContext } from '../../adapter/mall-reader.js';
import { PddCliError, ExitCodes } from '../../infra/errors.js';
import { finalizeSuccess, finalizeError } from './envelope-finalizer.js';

// ctx 字段集为 D-2 冻结契约（PROP-CTX-1）：fixture/live 两路径的单一来源，
// live 路径经 extra 追加 context/pageSession。住在本模块是因 import DAG 中
// single-lifecycle → fixture-runtime 是唯一合法共享边（envelope-finalizer 专责 envelope）。
export function buildCommandCtx(runtime, { client, page, mallCtx, ...extra }) {
  return {
    client,
    page,
    mallCtx,
    mallId: mallCtx?.activeId ?? null,
    authPath: runtime.authPath,
    account: runtime.accountCtx?.account ?? null,
    accountSlug: runtime.accountCtx?.slug ?? null,
    config: runtime.opts,
    runtimeConfig: runtime.runtimeConfig ?? null,
    log: runtime.log,
    correlation_id: runtime.correlationId,
    warnings: runtime.warnings,
    signal: runtime.signal,
    deadlineAt: runtime.deadlineAt,
    ...extra,
  };
}

async function resolveMockMall(needsMall) {
  if (needsMall !== 'current' && needsMall !== 'switch') return null;
  try {
    const current = await mockCurrentMall();
    const malls = await mockListMalls();
    // 与 live 路径同一归一化（normalizeMallRecord）：fixture / live 的店铺记录形状一致
    return buildMallContext({
      activeId: current?.id ?? null,
      activeName: current?.name ?? '',
      malls: Array.isArray(malls) ? malls : [],
      source: 'mock',
    });
  } catch {
    return null; // fixture 模式下 mall 解析可选
  }
}

export async function executeFixture(spec, runtime) {
  if (spec.needsAuth && mockIsAuthIndeterminate()) {
    return finalizeError(spec, runtime, new PddCliError({
      code: 'E_AUTH_CHECK_INDETERMINATE', message: '无法确认登录状态', exitCode: ExitCodes.NETWORK,
    }));
  }
  if (spec.needsAuth && !mockIsAuthValid()) {
    return finalizeError(spec, runtime, new PddCliError({
      code: 'E_AUTH_EXPIRED',
      message: '登录态失效',
      hint: '执行 pdd login 重新登录',
      exitCode: ExitCodes.AUTH,
    }));
  }

  const ctx = buildCommandCtx(runtime, {
    client: new FixtureEndpointClient(),
    page: null,
    mallCtx: await resolveMockMall(spec.needsMall),
  });

  try {
    return finalizeSuccess(spec, runtime, await spec.run(ctx));
  } catch (err) {
    return finalizeError(spec, runtime, err);
  }
}
