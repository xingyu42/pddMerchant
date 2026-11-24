import { isMockEnabled, mockCurrentMall, mockListMalls } from './mock-dispatcher.js';
import { buildMallContext } from './mall-context.js';
import {
  detectLiveMallContext,
  listLiveMalls,
} from './mall-port.js';

export async function resolveMallContext(page, opts = {}) {
  if (isMockEnabled()) {
    const current = await mockCurrentMall();
    const malls = await mockListMalls();
    return buildMallContext({
      activeId: current?.id ?? null,
      activeName: current?.name ?? '',
      malls: Array.isArray(malls) ? malls : [],
      source: 'mock',
    });
  }
  return detectLiveMallContext(page, opts);
}

export async function listMalls(page) {
  if (isMockEnabled()) return mockListMalls();
  return listLiveMalls(page);
}

export { buildMallContext };
