#!/usr/bin/env node
// V0.1 Real-call Regression Runner
//
// 目的：依次真实调用 16 条命令（除 `login`），收集 envelope / exit code / latency，
// 输出 Markdown 对照表到 .context/recon/v0-1-real-call.md，作为 `/ccg:spec-archive` 前的
// 回归证据（tasks.md §7.2）。
//
// 使用：
//   node scripts/v0-1-real-call.mjs                   # 仅跑无依赖的命令 + 自动 bootstrap orders.detail
//   node scripts/v0-1-real-call.mjs --sn 240101XXXXX  # 手动指定 orders detail 的 sn
//   node scripts/v0-1-real-call.mjs --skip doctor,init  # 跳过指定命令
//   node scripts/v0-1-real-call.mjs --headed          # 有头浏览器（调试）
//
// 前置：
//   1) `~/.pdd-cli/auth-state.json` 有效（未失效则直接跑；失效先 `pdd login`）
//   2) Chromium 已安装（`npx playwright install chromium`）

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..');
const BIN = join(PROJECT_ROOT, 'bin', 'pdd.js');

const args = process.argv.slice(2);
function flag(name) {
  const i = args.indexOf(name);
  if (i < 0) return null;
  return args[i + 1] ?? true;
}
const SN_OVERRIDE = typeof flag('--sn') === 'string' ? flag('--sn') : null;
const HEADED = flag('--headed') === true;
const SKIP = String(flag('--skip') || '').split(',').map((s) => s.trim()).filter(Boolean);

const CMD_TIMEOUT_MS = Number(flag('--timeout')) || 90_000;

const baseEnv = { ...process.env, NO_COLOR: '1' };

function run(name, cliArgs) {
  const startedAt = Date.now();
  const full = HEADED ? [...cliArgs, '--headed'] : cliArgs;
  const r = spawnSync(process.execPath, [BIN, ...full], {
    encoding: 'utf8',
    env: baseEnv,
    timeout: CMD_TIMEOUT_MS,
  });
  const wall = Date.now() - startedAt;
  const stdout = (r.stdout ?? '').trim();
  const stderr = (r.stderr ?? '').trim();
  let envelope = null;
  if (stdout.length > 0) {
    const lastLine = stdout.split('\n').pop();
    try { envelope = JSON.parse(lastLine); } catch { envelope = null; }
  }
  return {
    name,
    args: cliArgs.join(' '),
    status: r.status,
    signal: r.signal,
    wall_ms: wall,
    envelope,
    stdout,
    stderr,
  };
}

// 16 条命令（除 `login`），按调用复杂度排序。
// orders.detail 需要动态填 --sn；其它全部无参或仅用固定 flag。
function buildPlan() {
  return [
    { name: 'shops.current', args: ['shops', 'current', '--json'] },
    { name: 'shops.list', args: ['shops', 'list', '--json'] },
    { name: 'doctor', args: ['doctor', '--json'] },
    { name: 'goods.list', args: ['goods', 'list', '--json', '--size', '10'] },
    { name: 'goods.stock', args: ['goods', 'stock', '--json', '--threshold', '10'] },
    { name: 'orders.list', args: ['orders', 'list', '--json', '--size', '10'] },
    { name: 'orders.stats', args: ['orders', 'stats', '--json', '--size', '50'] },
    { name: 'orders.detail', needsSn: true },
    { name: 'promo.search', args: ['promo', 'search', '--json', '--size', '10'] },
    { name: 'promo.scene', args: ['promo', 'scene', '--json', '--size', '10'] },
    { name: 'diagnose.orders', args: ['diagnose', 'orders', '--json'] },
    { name: 'diagnose.inventory', args: ['diagnose', 'inventory', '--json'] },
    { name: 'diagnose.promo', args: ['diagnose', 'promo', '--json'] },
    { name: 'diagnose.funnel', args: ['diagnose', 'funnel', '--json'] },
    { name: 'diagnose.shop', args: ['diagnose', 'shop', '--json'] },
    { name: 'init', args: ['init', '--json'] }, // 若已登录态有效，本命令通常快速返回 ok
  ];
}

function fmtEnvelopeSummary(env) {
  if (!env) return { ok: '—', code: 'NO_JSON', message: '', warnings: 0, latency: 0 };
  return {
    ok: env.ok === true ? '✅' : env.ok === false ? '❌' : '—',
    code: env.error?.code ?? '',
    message: (env.error?.message ?? '').slice(0, 60),
    warnings: (env.meta?.warnings ?? []).length,
    latency: env.meta?.latency_ms ?? 0,
  };
}

async function main() {
  const plan = buildPlan();
  const results = [];
  let detectedSn = SN_OVERRIDE;

  for (const step of plan) {
    if (SKIP.includes(step.name)) {
      results.push({ name: step.name, skipped: true });
      process.stdout.write(`⏭  ${step.name} (skipped)\n`);
      continue;
    }

    let cliArgs = step.args;
    if (step.needsSn) {
      if (!detectedSn) {
        const ordersList = results.find((r) => r.name === 'orders.list');
        const sample = ordersList?.envelope?.data?.orders?.[0]?.order_sn
          ?? ordersList?.envelope?.data?.[0]?.order_sn;
        detectedSn = sample ?? null;
      }
      if (!detectedSn) {
        results.push({ name: step.name, skipped: true, reason: 'no sn available' });
        process.stdout.write(`⏭  ${step.name} (no sn available — rerun with --sn <value>)\n`);
        continue;
      }
      cliArgs = ['orders', 'detail', '--json', '--sn', detectedSn];
    }

    process.stdout.write(`▶  ${step.name} ... `);
    const r = run(step.name, cliArgs);
    results.push(r);
    const s = fmtEnvelopeSummary(r.envelope);
    process.stdout.write(`${s.ok} exit=${r.status} latency=${s.latency}ms ${s.code ? `[${s.code}]` : ''}\n`);
  }

  const lines = [];
  lines.push(`# V0.1 真实调用回归 (${new Date().toISOString().slice(0, 10)})`);
  lines.push('');
  lines.push(`- 机器：${process.platform} ${process.arch}`);
  lines.push(`- Node：${process.version}`);
  lines.push(`- Headed：${HEADED ? 'yes' : 'no'}`);
  if (detectedSn) lines.push(`- orders.detail sn：\`${detectedSn}\``);
  lines.push('');
  lines.push('| # | 命令 | ok | exit | error.code | latency_ms | warnings | message |');
  lines.push('|---|------|----|------|------------|------------|----------|---------|');
  results.forEach((r, i) => {
    if (r.skipped) {
      lines.push(`| ${i + 1} | \`${r.name}\` | ⏭ | — | — | — | — | ${r.reason ?? 'skipped by flag'} |`);
      return;
    }
    const s = fmtEnvelopeSummary(r.envelope);
    const msg = s.message.replace(/\|/g, '\\|');
    lines.push(`| ${i + 1} | \`${r.name}\` | ${s.ok} | ${r.status ?? '—'} | ${s.code || '—'} | ${s.latency} | ${s.warnings} | ${msg} |`);
  });
  lines.push('');

  const failures = results.filter((r) => !r.skipped && r.envelope?.ok !== true);
  if (failures.length > 0) {
    lines.push('## 非 ok 明细');
    lines.push('');
    for (const f of failures) {
      lines.push(`### \`${f.name}\` (exit=${f.status})`);
      if (f.envelope?.error) {
        lines.push('');
        lines.push('```json');
        lines.push(JSON.stringify(f.envelope.error, null, 2));
        lines.push('```');
      }
      if (f.stderr) {
        const trimmed = f.stderr.split('\n').slice(0, 10).join('\n');
        lines.push('');
        lines.push('```');
        lines.push(trimmed);
        lines.push('```');
      }
      lines.push('');
    }
  }

  const outDir = join(PROJECT_ROOT, '.context', 'recon');
  mkdirSync(outDir, { recursive: true });
  const outFile = join(outDir, 'v0-1-real-call.md');
  writeFileSync(outFile, lines.join('\n'), 'utf8');
  process.stdout.write(`\n📝 ${outFile}\n`);

  const ok = results.filter((r) => !r.skipped && r.envelope?.ok === true).length;
  const fail = failures.length;
  const skipped = results.filter((r) => r.skipped).length;
  process.stdout.write(`总计：${results.length}，ok=${ok}，fail=${fail}，skipped=${skipped}\n`);
  process.exit(fail === 0 ? 0 : 1);
}

main();
