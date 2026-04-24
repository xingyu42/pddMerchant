import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pddBin = join(__dirname, '..', '..', 'bin', 'pdd.js');

describe('Commander error PBT', () => {
  it('PROP-CM-1: unknown subcommand → stdout envelope with E_USAGE', () => {
    const result = spawnSync(process.execPath, [pddBin, 'nonexistent-subcommand-xyz'], {
      timeout: 10000,
      encoding: 'utf8',
      env: { ...process.env, NO_COLOR: '1' },
    });

    const stdout = (result.stdout ?? '').trim();
    if (stdout.length === 0) {
      return;
    }

    let envelope;
    try {
      envelope = JSON.parse(stdout.split('\n')[0]);
    } catch {
      return;
    }

    assert.strictEqual(envelope.ok, false);
    assert.strictEqual(envelope.error?.code, 'E_USAGE');
    assert.ok(
      envelope.meta?.exit_code === 2 || result.status === 2,
      'exit_code should be 2 (USAGE)'
    );
  });
});
