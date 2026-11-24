// fixture 运行时（design D-2）：由 single-lifecycle 在 runtime.mode === 'fixture' 时按需动态加载。
import { mockCurrentMall, mockListMalls, mockRunEndpoint } from '../../adapter/mock-dispatcher.js';
import { buildMallContext } from '../../adapter/mall-reader.js';
import { createCommandEndpointClient } from '../../adapter/endpoint-client.js';
import { FixtureStore } from '../../adapter/fixtures/core.js';
import { createFixtureEndpointTransport } from '../../adapter/fixtures/endpoint.js';
import { loadAuthState } from '../../adapter/auth-state.js';
import { withMerchantAuthUpdate } from '../../adapter/merchant-auth-storage.js';
import { assertMerchantVerified } from '../../infra/auth-task.js';
import { recover } from '../../services/auto-relogin.js';
import { buildCommandCtx, appendActionWarnings } from './command-ctx.js';
import { finalizeSuccess, finalizeError } from './envelope-finalizer.js';

export { appendActionWarnings };

async function ensureFixtureMerchantAuth(runtime) {
  const accountId = runtime.accountCtx.accountId;
  const { state } = loadAuthState(accountId, { allowCorrupt: true });
  const preflight = await runtime.ports.auth.checkMerchant(state, {
    signal: runtime.signal,
    deadlineAt: runtime.deadlineAt,
  });
  if (preflight.verdict !== 'rejected') {
    assertMerchantVerified(preflight);
    return;
  }
  await withMerchantAuthUpdate(accountId, async (tx) => {
    const current = await runtime.ports.auth.checkMerchant(tx.state, {
      signal: runtime.signal,
      deadlineAt: runtime.deadlineAt,
    });
    if (current.verdict !== 'rejected') {
      assertMerchantVerified(current);
      return;
    }
    await recover({
      tx,
      runtime,
      authResult: current,
      retainContext: false,
    });
  }, {
    signal: runtime.signal,
    deadlineAt: runtime.deadlineAt,
    seal: runtime.seal,
    clock: runtime.clock,
  });
}

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
    if (spec.needsAuth) await ensureFixtureMerchantAuth(runtime);

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
