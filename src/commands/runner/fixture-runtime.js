// fixture 运行时（design D-2）：由 single-lifecycle 在 runtime.mode === 'fixture' 时按需动态加载。
import { mockCurrentMall, mockListMalls, mockRunEndpoint } from '../../adapter/mock-dispatcher.js';
import { buildMallContext } from '../../adapter/mall-reader.js';
import { createCommandEndpointClient } from '../../adapter/endpoint-client.js';
import { FixtureStore } from '../../adapter/fixtures/core.js';
import { createFixtureEndpointTransport } from '../../adapter/fixtures/endpoint.js';
import { checkFixtureMerchantSession } from '../../services/merchant-session.js';
import { buildCommandCtx, appendActionWarnings } from './command-ctx.js';
import { finalizeSuccess, finalizeError } from './envelope-finalizer.js';

export { appendActionWarnings };

async function resolveMockMall(needsMall, runtime) {
  if (needsMall !== 'current' && needsMall !== 'switch') return null;
  try {
    if (runtime.ports?.mall) {
      return await runtime.ports.mall.detectCurrentMall(null);
    }
    const current = await mockCurrentMall();
    const malls = await mockListMalls();
    return buildMallContext({
      activeId: current?.id ?? null,
      activeName: current?.name ?? '',
      malls: Array.isArray(malls) ? malls : [],
      source: 'mock',
    });
  } catch {
    return null;
  }
}

export async function executeFixture(spec, runtime) {
  try {
    if (spec.needsAuth) await checkFixtureMerchantSession(runtime.accountCtx.accountId, runtime);

    const client = runtime.ports?.endpoint ?? createCommandEndpointClient({
      runtimeConfig: runtime.runtimeConfig,
      transport: createFixtureEndpointTransport({
        fixtureStore: runtime.fixture?.fixtureStore ?? new FixtureStore({
          fixtureDir: runtime.env?.fixtureDir,
          env: runtime.env?.testEnv,
        }),
        readEndpoint: mockRunEndpoint,
      }),
      endpointState: runtime.endpointState,
      clock: runtime.clock,
    });
    const ctx = buildCommandCtx(runtime, {
      client,
      page: null,
      mallCtx: await resolveMockMall(spec.needsMall, runtime),
    });

    const result = await spec.run(ctx);
    appendActionWarnings(spec, runtime);
    return finalizeSuccess(spec, runtime, result);
  } catch (err) {
    appendActionWarnings(spec, runtime);
    return finalizeError(spec, runtime, err);
  }
}
