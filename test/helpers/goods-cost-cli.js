import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCliSandbox, spawnNode } from './isolated-cli.js';
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
  const cwd = fileURLToPath(new URL('../../', import.meta.url));
  const nodeArgs = (args) => ['--import', new URL('./offline-preload.js', import.meta.url).href,
    fileURLToPath(new URL('../../bin/pdd.js', import.meta.url)), ...args, '--json'];
  function parse(result) {
    assert.ifError(result.error);
    const lines = result.stdout.trim().split(/\r?\n/);
    assert.equal(lines.length, 1, result.stderr);
    const envelope = JSON.parse(lines[0]);
    assertEnvelopeShape(envelope, { exitCode: result.status });
    return { ...result, envelope };
  }
  function execute(args) {
    return parse(spawnSync(process.execPath, nodeArgs(args), { env: sandbox.env, cwd, encoding: 'utf8', timeout: 30000 }));
  }
  async function executeAsync(args) {
    return parse(await spawnNode(nodeArgs(args), { env: sandbox.env, cwd, timeoutMs: 30000 }));
  }
  return { ...sandbox, file, execute, executeAsync };
}

export async function runCostContract(action) {
  const cli = createCostCli();
  try {
    assert.equal((await cli.executeAsync(['goods', 'cost', 'set', ...costArgs, '--confirm'])).envelope.ok, true);
    const args = { list: [], set: costArgs, remove: ['--goods-id', '101'], import: [cli.file] }[action];
    return await cli.executeAsync(['goods', 'cost', action, ...args]);
  } finally { cli.dispose(); }
}

export async function runProfitContract() {
  const cli = createCostCli(createProfitFixtures());
  try {
    assert.equal((await cli.executeAsync(['goods', 'cost', 'set', ...costArgs, '--confirm'])).envelope.ok, true);
    return await cli.executeAsync(['goods', 'profit']);
  } finally { cli.dispose(); }
}
