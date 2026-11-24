import { getLogger } from '../infra/logger.js';
import { isMockEnabled, mockIsConsumerAuthValid } from './mock-dispatcher.js';

const CONSUMER_HOME = 'https://mobile.yangkeduo.com';

export async function isConsumerAuthValid(page, { timeoutMs = 15000 } = {}) {
  if (isMockEnabled()) return mockIsConsumerAuthValid();
  try {
    await page.goto(CONSUMER_HOME, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
    return !page.url().includes('/login');
  } catch (err) {
    getLogger().debug({ err: err?.message }, 'isConsumerAuthValid navigation failed');
    return false;
  }
}
