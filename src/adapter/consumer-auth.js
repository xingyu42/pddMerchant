import { checkLiveConsumerOnline } from './auth-port.js';

export async function isConsumerAuthValid(page, { timeoutMs = 15000 } = {}) {
  const result = await checkLiveConsumerOnline(page, { timeoutMs });
  return result.ok;
}
