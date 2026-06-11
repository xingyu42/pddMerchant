// R4 render 下沉（refactor-arch-review-remediation task 7.1）等价性快照：
// _render.js 渲染输出与迁移前 shop.js 基线逐字节相等（含 --no-color 变体）。
// 基线 test/fixtures/diagnose-render/baseline.json 采集自迁移前 shop.js
// （FORCE_COLOR=3 + 非 TTY 管道），本测试以相同条件 import，保证可比。
process.env.FORCE_COLOR = '3';

import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RENDER_PATH = join(__dirname, '..', 'src', 'commands', 'diagnose', '_render.js');

// chalk 着色级别显式固定，防止宿主 TTY/CI 差异影响快照
const chalk = (await import('chalk')).default;
chalk.level = 3;
const render = await import('../src/commands/diagnose/_render.js');
const { CASES } = await import('./fixtures/diagnose-render/cases.mjs');
const baseline = JSON.parse(
  readFileSync(join(__dirname, 'fixtures', 'diagnose-render', 'baseline.json'), 'utf8')
);

describe('R4: diagnose render 迁移等价（task 7.1）', () => {
  it('基线键集与 CASES 一一对应', () => {
    assert.deepEqual(
      Object.keys(baseline).sort(),
      CASES.map((c) => c.name).sort()
    );
  });

  for (const c of CASES) {
    it(`${c.name} 输出与迁移前基线逐字节相等`, () => {
      const out = render[c.renderer](c.envelope, { useColor: c.useColor });
      assert.equal(out, baseline[c.name]);
    });
  }

  it('D-6 纯度：_render.js 仅 import chalk / cli-table3', () => {
    const source = readFileSync(RENDER_PATH, 'utf8');
    const specifiers = [...source.matchAll(/^import\s.*?from\s+'([^']+)';/gm)].map((m) => m[1]);
    assert.deepEqual(specifiers.sort(), ['chalk', 'cli-table3']);
  });

  it('shop.js 不再导出渲染函数', async () => {
    const shop = await import('../src/commands/diagnose/shop.js');
    assert.equal(shop.renderSingleDashboard, undefined);
    assert.equal(shop.renderShopDashboard, undefined);
  });
});
