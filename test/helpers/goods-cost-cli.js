import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCliSandbox } from './isolated-cli.js';
import { seedDb, DEFAULT_ACCOUNT } from './seed-db.js';
import { assertEnvelopeShape } from './envelope-assertions.js';
import { createProfitFixtures } from '../fixtures/test-data.js';

export const costArgs = ['--goods-id', '101', '--purchase-yuan', '8.2', '--packaging-yuan', '0.5', '--courier-yuan', '3'];
export const costInput = { goods_id: '101', purchase_yuan: '8.2', packaging_yuan: '0.5', courier_yuan: '3' };

export function createCostCli(fixtures = {}, accounts = [DEFAULT_ACCOUNT]) {
  const sandbox = createCliSandbox(fixtures);
  seedDb(sandbox.env.PDD_DB_PATH, { accounts });
  const file = join(sandbox.root, 'costs.json');
  writeFileSync(file, JSON.stringify([costInput]));
  function execute(args) {
    const result = spawnSync(process.execPath, ['--import', new URL('./offline-preload.js', import.meta.url).href,
      fileURLToPath(new URL('../../bin/pdd.js', import.meta.url)), ...args, '--json'],
    { env: sandbox.env, cwd: fileURLToPath(new URL('../../', import.meta.url)), encoding: 'utf8', timeout: 30000 });
    assert.ifError(result.error);
    const lines = result.stdout.trim().split(/\r?\n/);
    assert.equal(lines.length, 1, result.stderr);
    const envelope = JSON.parse(lines[0]);
    assertEnvelopeShape(envelope, { exitCode: result.status });
    return { ...result, envelope };
  }
  return { ...sandbox, file, execute };
}

export function runCostContract(action) {
  const cli = createCostCli();
  try {
    assert.equal(cli.execute(['goods', 'cost', 'set', ...costArgs, '--confirm']).envelope.ok, true);
    const args = { list: [], set: costArgs, remove: ['--goods-id', '101'], import: [cli.file] }[action];
    return cli.execute(['goods', 'cost', action, ...args]);
  } finally { cli.dispose(); }
}

export function runProfitContract() {
  const cli = createCostCli(createProfitFixtures());
  try {
    assert.equal(cli.execute(['goods', 'cost', 'set', ...costArgs, '--confirm']).envelope.ok, true);
    return cli.execute(['goods', 'profit']);
  } finally { cli.dispose(); }
}
