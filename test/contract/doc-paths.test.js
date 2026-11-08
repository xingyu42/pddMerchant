import { it } from 'vitest';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';

// 引导文档路径守卫：agent 常驻读取的文档里，反引号中的仓库路径必须真实存在，防止指引随重构过时。
// 含占位符（<>）、通配（*）、花括号或 | 的写法跳过。
const projectRoot = new URL('../../', import.meta.url);
const CODE_SPAN = /`([^`\n]+)`/g;
const REPO_PATH = /^(?:src|test|docs|bin|skills|\.trellis|\.agents|\.github)\/[^\s<>*{}|]+$/;

function steeringDocs() {
  const skills = readdirSync(new URL('.agents/skills/', projectRoot))
    .filter((name) => name.startsWith('pdd-'))
    .map((name) => `.agents/skills/${name}/SKILL.md`);
  return ['AGENTS.md', 'CLAUDE.md', 'CODING_STANDARDS.md', ...skills];
}

function referencedPaths(markdown) {
  return [...markdown.matchAll(CODE_SPAN)]
    .map((match) => match[1].replace(/[),.;:]+$/, ''))
    .filter((path) => REPO_PATH.test(path));
}

it('steering docs only reference repo paths that exist', () => {
  const docs = steeringDocs();
  assert.ok(docs.length > 3, 'steering doc discovery must not be vacuous');
  const missing = docs.flatMap((doc) => referencedPaths(readFileSync(new URL(doc, projectRoot), 'utf8'))
    .filter((path) => !existsSync(new URL(path, projectRoot)))
    .map((path) => `${doc}: ${path}`));
  assert.deepEqual(missing, [], 'stale paths in steering docs');
});
