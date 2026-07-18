import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DEFAULT_CONFIG_EXAMPLE_PATH, parseWritableConfigField } from '../src/infra/config.js';
import {
  inspectManagedConfig,
  publicConfigKeys,
  setLocalConfigValue,
  unsetLocalConfigValue,
} from '../src/infra/config-management.js';

describe('config management', () => {
  let projectRoot;
  let configDir;
  let baselinePath;
  let configPath;
  let options;

  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), 'pdd-managed-config-'));
    configDir = join(projectRoot, 'config');
    baselinePath = join(configDir, 'config.example.json');
    configPath = join(configDir, 'config.json');
    await mkdir(configDir);
    await writeFile(baselinePath, await readFile(DEFAULT_CONFIG_EXAMPLE_PATH, 'utf8'), 'utf8');
    options = { projectRoot, configDir, baselinePath, configPath, env: {} };
  });

  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 20 });
  });

  it('parses values by the single shared field schema', () => {
    expect(parseWritableConfigField('rateLimitQps', '2.5')).toBe(2.5);
    expect(parseWritableConfigField('titleRewrite', '0')).toBe(false);
    expect(parseWritableConfigField('mallIdStrictParse', 'true')).toBe(true);
    expect(parseWritableConfigField('logLevel', 'debug')).toBe('debug');
    expect(parseWritableConfigField('categoryApiBase', 'https://config.example.test')).toBe('https://config.example.test');
    expect(parseWritableConfigField('consumerLoginUrl', 'https://consumer.example.test/login')).toBe('https://consumer.example.test/login');
    expect(parseWritableConfigField('fullCountDiscountRate', '88')).toBe(0.88);
    expect(() => parseWritableConfigField('rateLimitBurst', '2.5')).toThrowError(/configuration/i);
    expect(() => parseWritableConfigField('logLevel', 'verbose')).toThrowError(/configuration/i);
    expect(() => parseWritableConfigField('categoryApiBase', 'not-a-url')).toThrowError(/configuration/i);
    expect(() => parseWritableConfigField('consumerLoginUrl', 'not-a-url')).toThrowError(/configuration/i);
    expect(() => parseWritableConfigField('fullCountDiscountRate', '49')).toThrowError(/configuration/i);
    expect(() => parseWritableConfigField('PDD_QINGGUO_AUTH_KEY', 'secret')).toThrowError(/configuration/i);
  });

  it('reports effective sources and local overrides without secret-only fields', async () => {
    await writeFile(configPath, JSON.stringify({ rateLimitQps: 4, titleRewrite: false }), 'utf8');
    const inspection = await inspectManagedConfig({
      ...options,
      env: { PDD_RATE_LIMIT_QPS: '6', PDD_QINGGUO_AUTH_KEY: 'must-not-appear' },
    });

    expect(inspection.valid).toBe(true);
    expect(inspection.runtimeConfig.rateLimitQps).toBe(6);
    expect(inspection.sources.rateLimitQps).toBe('env');
    expect(inspection.sources.titleRewrite).toBe('local');
    expect(publicConfigKeys()).not.toContain('PDD_QINGGUO_AUTH_KEY');
    expect(JSON.stringify(inspection)).not.toContain('must-not-appear');
  });

  it('set writes typed sparse JSON and reports environment override', async () => {
    const result = await setLocalConfigValue('rateLimitQps', '4', {
      ...options,
      env: { PDD_RATE_LIMIT_QPS: '8' },
    });
    const saved = JSON.parse(await readFile(configPath, 'utf8'));

    expect(saved).toEqual({ rateLimitQps: 4 });
    expect(result).toMatchObject({
      changed: true,
      localValue: 4,
      effectiveSource: 'env',
      overridden: true,
      runtimeValid: true,
      restartRequired: false,
    });
  });

  it('rejects invalid or unknown set values without changing the file', async () => {
    await writeFile(configPath, '{\n  "rateLimitQps": 4\n}\n', 'utf8');
    const before = await readFile(configPath, 'utf8');

    await expect(setLocalConfigValue('rateLimitQps', 'bad', options)).rejects.toMatchObject({ code: 'E_CONFIG_INVALID' });
    await expect(setLocalConfigValue('secretToken', 'value', options)).rejects.toMatchObject({ code: 'E_CONFIG_INVALID' });
    expect(await readFile(configPath, 'utf8')).toBe(before);
  });

  it('unset repairs an unknown local field and known missing keys are no-op', async () => {
    await writeFile(configPath, JSON.stringify({ futureOption: true }), 'utf8');
    const repaired = await unsetLocalConfigValue('futureOption', options);
    expect(repaired.removed).toBe(true);
    expect(JSON.parse(await readFile(configPath, 'utf8'))).toEqual({});

    const missing = await unsetLocalConfigValue('titleRewrite', options);
    expect(missing).toMatchObject({ removed: false, changed: false });
  });

  it('set can repair the selected invalid local field', async () => {
    await writeFile(configPath, JSON.stringify({ rateLimitQps: 'invalid' }), 'utf8');
    const result = await setLocalConfigValue('rateLimitQps', '5', options);
    expect(result.runtimeValid).toBe(true);
    expect(JSON.parse(await readFile(configPath, 'utf8'))).toEqual({ rateLimitQps: 5 });
  });

  it('unset on an absent known key does not create config.json', async () => {
    await rm(configPath, { force: true });
    const result = await unsetLocalConfigValue('titleRewrite', options);
    expect(result.removed).toBe(false);
    await expect(readFile(configPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('does not overwrite damaged JSON', async () => {
    await writeFile(configPath, '{ damaged', 'utf8');
    const before = await readFile(configPath, 'utf8');
    await expect(setLocalConfigValue('titleRewrite', 'false', options)).rejects.toMatchObject({
      code: 'E_CONFIG_INVALID',
      detail: { reason: 'json_invalid' },
    });
    expect(await readFile(configPath, 'utf8')).toBe(before);
  });

  it.each([
    ['array', '[]'],
    ['null', 'null'],
    ['scalar', '42'],
  ])('does not overwrite a %s local JSON root', async (_label, content) => {
    await writeFile(configPath, content, 'utf8');
    const before = await readFile(configPath, 'utf8');

    await expect(setLocalConfigValue('titleRewrite', 'false', options)).rejects.toMatchObject({
      code: 'E_CONFIG_INVALID',
      detail: { reason: 'root_not_object' },
    });
    expect(await readFile(configPath, 'utf8')).toBe(before);
  });

  it('maps unreadable managed paths to E_CONFIG_INVALID', async () => {
    const accessError = Object.assign(new Error('denied'), { code: 'EACCES' });
    await expect(inspectManagedConfig({
      ...options,
      io: { lstat: async () => { throw accessError; } },
    })).rejects.toMatchObject({
      code: 'E_CONFIG_INVALID',
      detail: { source: 'path', reason: 'path_unreadable' },
    });
  });

  it('keeps a successful local edit when another layer is invalid', async () => {
    const result = await setLocalConfigValue('titleRewrite', 'false', {
      ...options,
      env: { PDD_RATE_LIMIT_QPS: 'invalid' },
    });
    expect(JSON.parse(await readFile(configPath, 'utf8'))).toEqual({ titleRewrite: false });
    expect(result.runtimeValid).toBe(false);
    expect(result.warnings).toContain('runtime_invalid_after_edit');
    expect(result.issues[0]).not.toHaveProperty('value');
  });

  it('keeps a successful local edit when the baseline is damaged', async () => {
    await writeFile(baselinePath, '{ damaged', 'utf8');
    const result = await setLocalConfigValue('titleRewrite', 'false', options);
    expect(JSON.parse(await readFile(configPath, 'utf8'))).toEqual({ titleRewrite: false });
    expect(result.runtimeValid).toBe(false);
    expect(result.warnings).toContain('runtime_invalid_after_edit');
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ layer: 'baseline', code: 'json_invalid' }),
    ]));
  });

  it('marks daemon-related edits without restarting anything', async () => {
    const result = await setLocalConfigValue('refreshIntervalMs', '900000', options);
    expect(result.restartRequired).toBe(true);
    expect(result.warnings).toContain('daemon_restart_required');
  });

  it('preserves the original file and cleans temp files when rename fails', async () => {
    await writeFile(configPath, '{\n  "titleRewrite": true\n}\n', 'utf8');
    const before = await readFile(configPath, 'utf8');
    await expect(setLocalConfigValue('titleRewrite', 'false', {
      ...options,
      io: { rename: async () => { throw new Error('simulated rename failure'); } },
    })).rejects.toMatchObject({ code: 'E_CONFIG_INVALID', detail: { reason: 'atomic_write_failed' } });

    expect(await readFile(configPath, 'utf8')).toBe(before);
    expect((await readdir(configDir)).filter((name) => name.endsWith('.tmp'))).toEqual([]);
  });

  it('rejects a path outside the project before creating a file', async () => {
    const outsideRoot = await mkdtemp(join(tmpdir(), 'pdd-config-outside-'));
    try {
      const outsideOptions = {
        ...options,
        configDir: outsideRoot,
        baselinePath: join(outsideRoot, 'config.example.json'),
        configPath: join(outsideRoot, 'config.json'),
      };
      await expect(setLocalConfigValue('titleRewrite', 'false', outsideOptions)).rejects.toMatchObject({
        code: 'E_CONFIG_INVALID',
        detail: { reason: 'project_escape' },
      });
      await expect(readFile(outsideOptions.configPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await rm(outsideRoot, { recursive: true, force: true });
    }
  });

  it('rejects a config directory junction that points outside the project', async () => {
    const outsideRoot = await mkdtemp(join(tmpdir(), 'pdd-config-junction-'));
    await rm(configDir, { recursive: true, force: true });
    try {
      await symlink(outsideRoot, configDir, 'junction');
      await expect(setLocalConfigValue('titleRewrite', 'false', options)).rejects.toMatchObject({
        code: 'E_CONFIG_INVALID',
        detail: { reason: 'config_directory_unsafe' },
      });
      await expect(readFile(join(outsideRoot, 'config.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await rm(outsideRoot, { recursive: true, force: true });
    }
  });

  it('rejects a config file symlink without modifying its outside target', async () => {
    const outsideRoot = await mkdtemp(join(tmpdir(), 'pdd-config-file-link-'));
    const outsideConfig = join(outsideRoot, 'outside.json');
    const original = '{\n  "titleRewrite": true\n}\n';
    await writeFile(outsideConfig, original, 'utf8');
    try {
      await symlink(outsideConfig, configPath, 'file');
      await expect(setLocalConfigValue('titleRewrite', 'false', options)).rejects.toMatchObject({
        code: 'E_CONFIG_INVALID',
        detail: { reason: 'config_file_unsafe' },
      });
      expect(await readFile(outsideConfig, 'utf8')).toBe(original);
    } finally {
      await rm(outsideRoot, { recursive: true, force: true });
    }
  });
});
