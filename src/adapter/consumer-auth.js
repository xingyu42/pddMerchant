import { isMockEnabled, mockIsConsumerAuthValid } from './mock-dispatcher.js';
import { checkLiveConsumerOnline } from './auth-port.js';

export async function isConsumerAuthValid(page, { timeoutMs = 15000 } = {}) {
  if (isMockEnabled()) return mockIsConsumerAuthValid();
  const result = await checkLiveConsumerOnline(page, { timeoutMs });
  return result.ok;
}
