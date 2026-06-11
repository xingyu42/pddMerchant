// 采集 post-R1 help 基线（refactor-arch-review-remediation task 2.6）。
// 覆盖 root + 9 个分组 + 34 个子命令，共 44 项；PROP-HELP-1（task 6.2）
// 在 bin/pdd.js 注册拆分后以本基线做逐字节对比。
// 用法：node test/fixtures/help/capture.mjs
// 确定性：spawnSync 管道模式下 stdout 非 TTY，commander 以固定宽度换行；
// NO_COLOR=1 排除着色；JSON 存储规避 git CRLF 改写。
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..', '..', '..');
const BIN = join(PROJECT_ROOT, 'bin', 'pdd.js');

const GROUPS = [
  ['shops'], ['orders'], ['goods'], ['goods', 'update'],
  ['promo'], ['diagnose'], ['action'], ['account'], ['daemon'],
];

const SUBCOMMANDS = [
  ['init'], ['login'], ['doctor'],
  ['shops', 'list'], ['shops', 'current'],
  ['orders', 'list'], ['orders', 'detail'], ['orders', 'stats'],
  ['goods', 'list'], ['goods', 'stock'], ['goods', 'segment'], ['goods', 'publish'], ['goods', 'templates'],
  ['goods', 'update', 'status'], ['goods', 'update', 'price'], ['goods', 'update', 'stock'],
  ['goods', 'update', 'title'], ['goods', 'update', 'batch'],
  ['promo', 'search'], ['promo', 'scene'], ['promo', 'roi'],
  ['diagnose', 'shop'], ['diagnose', 'orders'], ['diagnose', 'inventory'], ['diagnose', 'promo'], ['diagnose', 'funnel'],
  ['action', 'plan'],
  ['account', 'add'], ['account', 'remove'], ['account', 'list'], ['account', 'default'],
  ['daemon', 'start'], ['daemon', 'stop'], ['daemon', 'status'],
];

export const INVOCATIONS = [[], ...GROUPS, ...SUBCOMMANDS];

export function captureHelp(args) {
  const result = spawnSync(process.execPath, [BIN, ...args, '--help'], {
    encoding: 'utf8',
    timeout: 15_000,
    env: { ...process.env, NO_COLOR: '1' },
  });
  return result;
}

export function invocationKey(args) {
  return args.length === 0 ? 'pdd' : `pdd ${args.join(' ')}`;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const baseline = {};
  for (const args of INVOCATIONS) {
    const r = captureHelp(args);
    if (r.status !== 0 || !r.stdout) {
      process.stderr.write(`FAIL: ${invocationKey(args)} --help → exit ${r.status}\n${r.stderr}\n`);
      process.exit(1);
    }
    baseline[invocationKey(args)] = r.stdout;
  }
  const outPath = join(__dirname, 'baseline.json');
  writeFileSync(outPath, JSON.stringify(baseline, null, 2) + '\n');
  process.stderr.write(`captured ${Object.keys(baseline).length} help snapshots → ${outPath}\n`);
}
