import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DEFAULT_CONFIG_EXAMPLE_PATH } from '../src/infra/config.js';
import * as configCommand from '../src/commands/config.js';

describe('config command handlers', () => {
  let projectRoot;
  let configDir;
  let baselinePath;
  let configPath;
  let configOptions;
  let stdout;
  let stdoutSpy;

  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), 'pdd-config-command-'));
    configDir = join(projectRoot, 'config');
    baselinePath = join(configDir, 'config.example.json');
    configPath = join(configDir, 'config.json');
    await mkdir(configDir);
    await writeFile(baselinePath, await readFile(DEFAULT_CONFIG_EXAMPLE_PATH, 'utf8'), 'utf8');
    configOptions = { projectRoot, configDir, baselinePath, configPath, env: {} };
    stdout = '';
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      stdout += String(chunk);
      return true;
    });
  });

  afterEach(async () => {
    stdoutSpy.mockRestore();
    await rm(projectRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 20 });
  });

  it('set emits one JSON envelope and writes a typed value', async () => {
    const envelope = await configCommand.set(
      { args: ['mallIdStrictParse', 'false'], json: true, noColor: true },
      { configOptions },
    );
    expect(envelope).toMatchObject({
      ok: true,
      command: 'config.set',
      data: { key: 'mallIdStrictParse', localValue: false, runtimeValid: true },
    });
    expect(stdout.trim().split(/\r?\n/)).toHaveLength(1);
    expect(JSON.parse(await readFile(configPath, 'utf8'))).toEqual({ mallIdStrictParse: false });
  });

  it('show reports a local value as overridden by environment', async () => {
    await writeFile(configPath, JSON.stringify({ rateLimitQps: 4 }), 'utf8');
    const envelope = await configCommand.show(
      { json: true, noColor: true },
      { configOptions: { ...configOptions, env: { PDD_RATE_LIMIT_QPS: '7' } } },
    );
    expect(envelope.data.fields.rateLimitQps).toEqual({
      effectiveValue: 7,
      source: 'env',
      hasLocalOverride: true,
      localOverride: 4,
      overridden: true,
    });
  });

  it('validate reports all safe layer issues without the invalid raw value', async () => {
    await writeFile(baselinePath, '{', 'utf8');
    await writeFile(configPath, JSON.stringify({ unknownField: true }), 'utf8');
    let error;
    try {
      await configCommand.validate(
        { json: true, noColor: true },
        { configOptions: { ...configOptions, env: { PDD_RATE_LIMIT_QPS: 'raw-secret-value' } } },
      );
    } catch (caught) {
      error = caught;
    }
    expect(error?.code).toBe('E_CONFIG_INVALID');
    expect(error?.detail?.issues.map((issue) => issue.layer)).toEqual(expect.arrayContaining(['baseline', 'local', 'env']));
    expect(JSON.stringify(error)).not.toContain('raw-secret-value');
  });

  it('unset reports daemon restart without invoking daemon control', async () => {
    await writeFile(configPath, JSON.stringify({ refreshIntervalMs: 900000 }), 'utf8');
    const envelope = await configCommand.unset(
      { args: ['refreshIntervalMs'], json: true, noColor: true },
      { configOptions },
    );
    expect(envelope.data).toMatchObject({ removed: true, restartRequired: true });
    expect(envelope.meta.warnings).toContain('daemon_restart_required');
  });
});
