// 分层守卫（refactor-arch-review-remediation task 8.1）：
// 1) src/adapter/** 禁止相对 import 解析到 src/services 或 src/commands
//    （依赖方向 commands→services→adapter→infra 单向，CLAUDE.md 架构约束）；
// 2) src/commands/runner/** 禁止 import _runner.js（facade 不得被其拆分件反向依赖）。
// 按解析后的绝对路径判定，覆盖任意 ../ 深度变体与动态 import()。
import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname, resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(__dirname, '..', 'src');

function walkJsFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkJsFiles(full));
    else if (entry.isFile() && entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

function importSpecifiers(source) {
  const out = [];
  // 静态 import / re-export ... from '...'
  for (const m of source.matchAll(/(?:^|\n)\s*(?:import|export)\s[^;]*?from\s+['"]([^'"]+)['"]/g)) {
    out.push(m[1]);
  }
  // 裸副作用 import '...'
  for (const m of source.matchAll(/(?:^|\n)\s*import\s+['"]([^'"]+)['"]/g)) {
    out.push(m[1]);
  }
  // 动态 import('...') / import ('...')
  for (const m of source.matchAll(/import\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    out.push(m[1]);
  }
  return out;
}

function resolvedRelativeImports(file) {
  const source = readFileSync(file, 'utf8');
  return importSpecifiers(source)
    .filter((spec) => spec.startsWith('.'))
    .map((spec) => ({ spec, resolved: resolve(dirname(file), spec) }));
}

function isInside(target, dir) {
  const rel = relative(dir, target);
  // rel === '' 即恰好命中目录本身，同样视为越界
  return rel === '' || (!rel.startsWith('..') && !rel.includes(`..${sep}`));
}

describe('分层守卫（task 8.1）', () => {
  it('扫描器非空运行（防御 vacuous pass）', () => {
    const adapterFiles = walkJsFiles(join(SRC, 'adapter'));
    assert.ok(adapterFiles.length >= 10, `adapter 文件数异常偏低: ${adapterFiles.length}`);
    const relImports = adapterFiles.flatMap(resolvedRelativeImports);
    assert.ok(relImports.length >= 5, `相对 import 提取数异常偏低: ${relImports.length}`);
  });

  it('src/adapter 不得相对 import services/ 或 commands/', () => {
    const violations = [];
    for (const file of walkJsFiles(join(SRC, 'adapter'))) {
      for (const { spec, resolved } of resolvedRelativeImports(file)) {
        if (isInside(resolved, join(SRC, 'services')) || isInside(resolved, join(SRC, 'commands'))) {
          violations.push(`${relative(SRC, file)} → '${spec}'`);
        }
      }
    }
    assert.deepEqual(violations, [], `adapter 层出现上行依赖:\n${violations.join('\n')}`);
  });

  it('src/commands/runner 不得 import _runner.js', () => {
    const violations = [];
    for (const file of walkJsFiles(join(SRC, 'commands', 'runner'))) {
      for (const { spec, resolved } of resolvedRelativeImports(file)) {
        if (resolved === join(SRC, 'commands', '_runner.js')) {
          violations.push(`${relative(SRC, file)} → '${spec}'`);
        }
      }
    }
    assert.deepEqual(violations, [], `runner 拆分件反向依赖 facade:\n${violations.join('\n')}`);
  });
});
