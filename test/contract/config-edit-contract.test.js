import { afterEach, beforeEach, describe, it, vi } from 'vitest';
import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as configCmd from '../../src/commands/config.js';
import { assertDataContractV2 } from '../helpers/data-contract.js';

// config set / unset 通过 CLI 子进程会写入仓库的 config/config.json，
// 故在进程内以临时项目根目录（configOptions）覆盖其 v2 data 契约。
// data-contract-v2.test.js 的 UNIT_COVERED 引用本文件。

const exampleConfig = fileURLToPath(new URL('../../config/config.example.json', import.meta.url));

let root;
let configOptions;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'pdd-config-'));
  const configDir = join(root, 'config');
  mkdirSync(configDir);
  copyFileSync(exampleConfig, join(configDir, 'config.example.json'));
  configOptions = {
    projectRoot: root, configDir,
    baselinePath: join(configDir, 'config.example.json'),
    configPath: join(configDir, 'config.json'),
    env: {},
  };
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('config set / unset v2 data', () => {
  it('config.set reports the edit in snake_case with a labeled source', async () => {
    const envelope = await configCmd.set({ args: ['rateLimitQps', '1'], json: true }, { configOptions });
    assert.equal(envelope.ok, true);
    assert.equal(envelope.meta.v, 2);
    assertDataContractV2(envelope.data);
    assert.equal(envelope.data.key, 'rateLimitQps');
    assert.equal(envelope.data.local_value, 1);
    assert.equal(envelope.data.effective_source, '本地覆盖');
    assert.equal(envelope.data.had_local_override, false);
    assert.deepEqual(envelope.data.headline, ['已设置本地覆盖 rateLimitQps = 1']);
  });

  it('config.unset reports removal and the restored source', async () => {
    await configCmd.set({ args: ['rateLimitQps', '1'], json: true }, { configOptions });
    const envelope = await configCmd.unset({ args: ['rateLimitQps'], json: true }, { configOptions });
    assertDataContractV2(envelope.data);
    assert.equal(envelope.data.removed, true);
    assert.equal(envelope.data.effective_source, '基线配置');
    assert.deepEqual(envelope.data.headline, ['已删除本地覆盖 rateLimitQps']);
    const again = await configCmd.unset({ args: ['rateLimitQps'], json: true }, { configOptions });
    assert.equal(again.data.removed, false);
    assert.deepEqual(again.data.headline, ['rateLimitQps 没有本地覆盖，未改动']);
  });
});
