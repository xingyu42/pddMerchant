import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { prepareCommandRuntime } from '../src/commands/runtime-options.js';

const ENV_KEYS = [
  'PDD_TIMEOUT_MS',
  'PDD_DEFAULT_MALL',
  'PDD_AUTH_STATE_PATH',
  'PDD_LOG_LEVEL',
];

describe('prepareCommandRuntime', () => {
  let saved;

  beforeEach(() => {
    saved = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
    process.env.PDD_TIMEOUT_MS = '4321';
    process.env.PDD_DEFAULT_MALL = '445301049';
    process.env.PDD_AUTH_STATE_PATH = 'data/custom-auth.json';
    process.env.PDD_LOG_LEVEL = 'info';
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  it('applies environment-backed command defaults', async () => {
    const opts = { verbose: false };
    const runtimeConfig = await prepareCommandRuntime(opts);

    expect(opts).toMatchObject({
      timeout: 4321,
      timeoutMs: 4321,
      mall: '445301049',
      authStatePath: 'data/custom-auth.json',
    });
    expect(runtimeConfig.logLevel).toBe('info');
    expect(Object.isFrozen(runtimeConfig)).toBe(true);
  });

  it('preserves explicit CLI values and maps --verbose to debug', async () => {
    const opts = {
      timeout: 99,
      timeoutMs: 99,
      mall: '9988',
      authStatePath: 'data/explicit-auth.json',
      verbose: true,
    };
    const runtimeConfig = await prepareCommandRuntime(opts);

    expect(opts.timeoutMs).toBe(99);
    expect(opts.mall).toBe('9988');
    expect(opts.authStatePath).toBe('data/explicit-auth.json');
    expect(runtimeConfig.timeoutMs).toBe(99);
    expect(runtimeConfig.logLevel).toBe('debug');
  });
});
