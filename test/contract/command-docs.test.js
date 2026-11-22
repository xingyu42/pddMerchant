import { it } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { discoverRegisteredCommands } from '../helpers/registered-commands.js';

// 命令文档守卫：skills/pdd-cli/SKILL.md 是 agent 使用 CLI 的入口，必须与注册命令一一对应。
// 只读取 bash 代码块内的 `pdd <命令词…>` 或 `node bin/pdd.js <命令词…>` 行；`a|b` 合并写法展开为多个命令，遇到选项、占位符或文件名即停止。
const SKILL_PATH = new URL('../../skills/pdd-cli/SKILL.md', import.meta.url);
const FENCE_BASH = /^```bash\b/;
const FENCE_END = /^```/;
const INVOCATION = /^(?:pdd|node bin\/pdd\.js) +(.*)$/;
const COMMAND_WORD = /^[a-z][a-z-]*(\|[a-z][a-z-]*)*$/;

function expandWords(words) {
  return words.reduce((prefixes, word) => prefixes.flatMap((prefix) =>
    word.split('|').map((part) => (prefix ? `${prefix}.${part}` : part))), ['']);
}

function documentedCommands(markdown) {
  const names = new Set();
  let inBash = false;
  for (const line of markdown.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!inBash) {
      if (FENCE_BASH.test(trimmed)) inBash = true;
      continue;
    }
    if (FENCE_END.test(trimmed)) {
      inBash = false;
      continue;
    }
    const match = INVOCATION.exec(trimmed);
    if (!match) continue;
    const tokens = match[1].trim().split(/\s+/);
    const end = tokens.findIndex((token) => !COMMAND_WORD.test(token));
    const words = end === -1 ? tokens : tokens.slice(0, end);
    if (words.length > 0) expandWords(words).forEach((name) => names.add(name));
  }
  return names;
}

it('documents every registered command in skills/pdd-cli/SKILL.md', async () => {
  const documented = documentedCommands(readFileSync(SKILL_PATH, 'utf8'));
  const missing = (await discoverRegisteredCommands()).filter((name) => !documented.has(name));
  assert.deepEqual(missing, [], 'registered commands missing from skills/pdd-cli/SKILL.md');
});

it('documents only registered commands in skills/pdd-cli/SKILL.md', async () => {
  const registered = new Set(await discoverRegisteredCommands());
  const unknown = [...documentedCommands(readFileSync(SKILL_PATH, 'utf8'))].filter((name) => !registered.has(name));
  assert.deepEqual(unknown, [], 'skills/pdd-cli/SKILL.md documents unregistered commands');
});
