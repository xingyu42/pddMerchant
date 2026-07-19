import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  DEFAULT_CONFIG_EXAMPLE_PATH,
  loadConfig,
  loadRuntimeConfig,
} from '../src/infra/config.js';

describe('runtime config', () => {
  let root;
  let baselinePath;
  let configPath;
  let baseline;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'pdd-config-'));
    baselinePath = join(root, 'config.example.json');
    configPath = join(root, 'config.json');
    baseline = JSON.parse(await readFile(DEFAULT_CONFIG_EXAMPLE_PATH, 'utf8'));
    await writeFile(baselinePath, JSON.stringify(baseline), 'utf8');
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('uses the required baseline when local config is absent', async () => {
    const runtime = await loadRuntimeConfig({ baselinePath, configPath, env: {} });
    expect(runtime).toEqual(baseline);
    expect(Object.isFrozen(runtime)).toBe(true);
  });

  it('merges baseline, local, environment and CLI in order', async () => {
    await writeFile(configPath, JSON.stringify({ rateLimitQps: 4, mallIdStrictParse: true }), 'utf8');
    const result = await loadConfig({
      baselinePath,
      configPath,
      env: {
        PDD_RATE_LIMIT_QPS: '6',
        PDD_MALL_ID_STRICT_PARSE: '0',
        PDD_CONSUMER_LOGIN_URL: 'https://consumer.example.test/login',
        PDD_FULL_COUNT_DISCOUNT_RATE: '88',
      },
      cliFlags: { rateLimitQps: 8 },
    });

    expect(result.config.rateLimitQps).toBe(8);
    expect(result.config.mallIdStrictParse).toBe(false);
    expect(result.config.consumerLoginUrl).toBe('https://consumer.example.test/login');
    expect(result.config.fullCountDiscountRate).toBe(0.88);
    expect(result.layers.environment).toEqual({
      rateLimitQps: 6,
      consumerLoginUrl: 'https://consumer.example.test/login',
      mallIdStrictParse: false,
      fullCountDiscountRate: 0.88,
    });
  });

  it.each([
    ['0.5', 0.5],
    ['0.99', 0.99],
    ['50', 0.5],
    ['95', 0.95],
    ['99', 0.99],
  ])('normalizes full-count discount environment value %s', async (raw, expected) => {
    const runtime = await loadRuntimeConfig({
      baselinePath,
      configPath,
      env: { PDD_FULL_COUNT_DISCOUNT_RATE: raw },
    });
    expect(runtime.fullCountDiscountRate).toBe(expected);
  });

  it.each(['0.49', '1', '49', '100', '0.955', 'not-a-number'])(
    'rejects invalid full-count discount environment value %s',
    async (raw) => {
      await expect(loadRuntimeConfig({
        baselinePath,
        configPath,
        env: { PDD_FULL_COUNT_DISCOUNT_RATE: raw },
      })).rejects.toMatchObject({
        code: 'E_CONFIG_INVALID',
        detail: { source: 'environment' },
      });
    },
  );

  it.each([
    ['missing', async () => rm(baselinePath)],
    ['damaged JSON', async () => writeFile(baselinePath, '{', 'utf8')],
    ['missing required field', async () => {
      const { logLevel: _removed, ...incomplete } = baseline;
      await writeFile(baselinePath, JSON.stringify(incomplete), 'utf8');
    }],
  ])('fails immediately when baseline is %s', async (_label, arrange) => {
    await arrange();
    await expect(loadRuntimeConfig({ baselinePath, configPath, env: {} })).rejects.toMatchObject({
      code: 'E_CONFIG_INVALID',
      exitCode: 1,
      detail: { source: 'baseline' },
    });
  });

  it.each([
    ['damaged JSON', '{'],
    ['unknown field', JSON.stringify({ futureOption: true })],
  ])('fails immediately when local config has %s', async (_label, content) => {
    await writeFile(configPath, content, 'utf8');
    await expect(loadRuntimeConfig({ baselinePath, configPath, env: {} })).rejects.toMatchObject({
      code: 'E_CONFIG_INVALID',
      detail: { source: 'local' },
    });
  });

  it('rejects invalid environment values instead of silently falling back', async () => {
    await expect(loadRuntimeConfig({
      baselinePath,
      configPath,
      env: { PDD_RATE_LIMIT_QPS: 'not-a-number' },
    })).rejects.toMatchObject({
      code: 'E_CONFIG_INVALID',
      detail: { source: 'environment' },
    });
  });

});
