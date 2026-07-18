import { readFileSync } from 'node:fs';
import { DEFAULT_CONFIG_EXAMPLE_PATH } from '../../src/infra/config.js';

export const TEST_RUNTIME_CONFIG = Object.freeze(
  JSON.parse(readFileSync(DEFAULT_CONFIG_EXAMPLE_PATH, 'utf8')),
);

export function testRuntimeConfig(overrides = {}) {
  return Object.freeze({ ...TEST_RUNTIME_CONFIG, ...overrides });
}
