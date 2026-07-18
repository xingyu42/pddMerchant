import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const cliPath = join(repoRoot, 'bin', 'pdd.js');

function run(args, env = {}) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    cwd: repoRoot,
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
}

describe('CLI runtime config boundary', () => {
  it('returns one E_CONFIG_INVALID JSON envelope for an invalid environment override', () => {
    const result = run(['goods', 'list', '--json'], {
      PDD_TEST_ADAPTER: 'fixture',
      PDD_RATE_LIMIT_QPS: 'invalid-value',
    });
    const lines = result.stdout.trim().split(/\r?\n/).filter(Boolean);
    expect(result.status).toBe(1);
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0])).toMatchObject({
      ok: false,
      command: 'goods.list',
      error: { code: 'E_CONFIG_INVALID' },
      meta: { exit_code: 1 },
    });
  });

  it.each([['--help'], ['--version']])('%s skips runtime config loading', (flag) => {
    const result = run([flag], { PDD_RATE_LIMIT_QPS: 'invalid-value' });
    expect(result.status).toBe(0);
    expect(result.stdout).not.toContain('E_CONFIG_INVALID');
  });
});
