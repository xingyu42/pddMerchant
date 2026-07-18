import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const cliPath = join(repoRoot, 'bin', 'pdd.js');

function run(args, env = {}) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    cwd: repoRoot,
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
}

function singleEnvelope(result) {
  const lines = result.stdout.trim().split(/\r?\n/).filter(Boolean);
  expect(lines).toHaveLength(1);
  return JSON.parse(lines[0]);
}

describe('pdd config e2e', () => {
  it('show is a maintenance command with one standard JSON envelope', () => {
    const result = run(['config', 'show', '--json']);
    expect(result.status).toBe(0);
    expect(singleEnvelope(result)).toMatchObject({
      ok: true,
      command: 'config.show',
      data: { path: 'config/config.json' },
    });
  });

  it('validate remains reachable when an environment layer is invalid', () => {
    const result = run(['config', 'validate', '--json'], {
      PDD_RATE_LIMIT_QPS: 'invalid-private-value',
    });
    const envelope = singleEnvelope(result);
    expect(result.status).toBe(1);
    expect(envelope).toMatchObject({
      ok: false,
      command: 'config.validate',
      error: { code: 'E_CONFIG_INVALID' },
    });
    expect(JSON.stringify(envelope)).not.toContain('invalid-private-value');
  });

  it('positional set arguments are parsed before an invalid value is rejected', () => {
    const result = run(['config', 'set', 'rateLimitBurst', 'not-a-number', '--json']);
    expect(result.status).toBe(1);
    expect(singleEnvelope(result)).toMatchObject({
      ok: false,
      command: 'config.set',
      error: { code: 'E_CONFIG_INVALID' },
    });
  });

  it('a typed local edit is read by a fresh process', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'pdd-config-process-'));
    const configDir = join(projectRoot, 'config');
    const baselinePath = join(configDir, 'config.example.json');
    const configPath = join(configDir, 'config.json');
    const baselineSource = join(repoRoot, 'config', 'config.example.json');
    const commandUrl = pathToFileURL(join(repoRoot, 'src', 'commands', 'config.js')).href;
    const configUrl = pathToFileURL(join(repoRoot, 'src', 'infra', 'config.js')).href;
    const options = JSON.stringify({ projectRoot, configDir, baselinePath, configPath, env: {} });
    await mkdir(configDir);
    await writeFile(baselinePath, await readFile(baselineSource, 'utf8'), 'utf8');

    try {
      const edit = spawnSync(process.execPath, [
        '--input-type=module',
        '--eval',
        `import { set } from ${JSON.stringify(commandUrl)};
         const configOptions = JSON.parse(process.argv[1]);
         await set({ args: ['refreshIntervalMs', '900000'], json: true, noColor: true }, { configOptions });`,
        options,
      ], { cwd: repoRoot, encoding: 'utf8' });
      expect(edit.status).toBe(0);
      expect(singleEnvelope(edit)).toMatchObject({
        ok: true,
        command: 'config.set',
        data: { localValue: 900000, restartRequired: true },
      });

      const reload = spawnSync(process.execPath, [
        '--input-type=module',
        '--eval',
        `import { loadRuntimeConfig } from ${JSON.stringify(configUrl)};
         const options = JSON.parse(process.argv[1]);
         const runtime = await loadRuntimeConfig(options);
         process.stdout.write(JSON.stringify({ refreshIntervalMs: runtime.refreshIntervalMs }));`,
        options,
      ], { cwd: repoRoot, encoding: 'utf8' });
      expect(reload.status).toBe(0);
      expect(JSON.parse(reload.stdout)).toEqual({ refreshIntervalMs: 900000 });
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });
});
