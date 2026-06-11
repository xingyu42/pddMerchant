// PROP-HELP-1（refactor-arch-review-remediation task 6.2）：
// bin/pdd.js 注册拆分（R2b）后，全部 help 输出与 post-R1 基线（task 2.6 采集）逐字节相等。
// 基线：test/fixtures/help/baseline.json，44 项 = root + 9 个分组 + 34 个子命令。
// 同时守卫 bin/pdd.js 薄 facade 行数，防止注册代码回流。
import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { INVOCATIONS, captureHelp, invocationKey } from '../fixtures/help/capture.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const baseline = JSON.parse(
  readFileSync(join(__dirname, '..', 'fixtures', 'help', 'baseline.json'), 'utf8')
);

describe('PROP-HELP-1: help 输出与 post-R1 基线逐字节相等', () => {
  it('基线快照键集与 INVOCATIONS 枚举一一对应', () => {
    const expected = INVOCATIONS.map(invocationKey).sort();
    assert.deepEqual(Object.keys(baseline).sort(), expected);
  });

  for (const args of INVOCATIONS) {
    const key = invocationKey(args);
    it(`${key} --help`, () => {
      const result = captureHelp(args);
      assert.equal(result.status, 0, `exit ${result.status}, stderr: ${result.stderr}`);
      assert.equal(result.stdout, baseline[key]);
    });
  }
});

describe('R2b: bin/pdd.js 薄 facade 行数门禁', () => {
  // 保留物清单（design D-3：信号/致命处理器/全局 option/exitOverride/mergeOptions/wireAction/main）
  // 固定成本约 160 行，拆分后实测 193；门禁 200 用于拦截注册代码回流 bin。
  it('行数 ≤ 200', () => {
    const source = readFileSync(join(__dirname, '..', '..', 'bin', 'pdd.js'), 'utf8');
    const lineCount = source.split('\n').length;
    assert.ok(lineCount <= 200, `bin/pdd.js 已增长到 ${lineCount} 行（> 200），注册逻辑应放入 src/commands/registry/`);
  });
});
