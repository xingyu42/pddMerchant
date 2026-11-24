import { isMockEnabled, mockSwitchTo } from './mock-dispatcher.js';
import { switchLiveMall } from './mall-port.js';

export async function switchTo(page, mallId, { strict } = {}) {
  if (isMockEnabled()) return mockSwitchTo(mallId);
  return switchLiveMall(page, mallId, { strict });
}
