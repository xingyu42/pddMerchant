#!/usr/bin/env node
import { Command } from 'commander';
import { emit } from '../src/infra/output.js';
import { ExitCodes, mapErrorToExit, errorToEnvelope } from '../src/infra/errors.js';
import { createLogger, redactRecursive } from '../src/infra/logger.js';
import { closeAllBrowsers } from '../src/adapter/browser.js';
import { register as registerCore } from '../src/commands/registry/core.js';
import { register as registerShops } from '../src/commands/registry/shops.js';
import { register as registerOrders } from '../src/commands/registry/orders.js';
import { register as registerGoods } from '../src/commands/registry/goods.js';
import { register as registerPromo } from '../src/commands/registry/promo.js';
import { register as registerDiagnose } from '../src/commands/registry/diagnose.js';
import { register as registerAction } from '../src/commands/registry/action.js';
import { register as registerAccount } from '../src/commands/registry/account.js';
import { register as registerDaemon } from '../src/commands/registry/daemon.js';

// --- Signal Handlers (C1) ---
let shuttingDown = false;
function onSignal(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  const code = { SIGINT: 130, SIGTERM: 143 }[signal] ?? 128;
  process.exitCode = code;
  closeAllBrowsers({ timeoutMs: 5000 }).catch(() => {});
}
process.on('SIGINT', () => onSignal('SIGINT'));
process.on('SIGTERM', () => onSignal('SIGTERM'));

// --- Global Exception Handlers (W6) ---
let fatalEmitted = false;
process.on('unhandledRejection', (reason) => {
  if (fatalEmitted) return;
  fatalEmitted = true;
  const envelope = errorToEnvelope('pdd', reason instanceof Error ? reason : new Error(String(reason)));
  emit(envelope, { json: true, noColor: true });
  closeAllBrowsers().catch(() => {});
  process.exitCode = ExitCodes.GENERAL;
});

process.on('uncaughtException', (err) => {
  if (!fatalEmitted) {
    fatalEmitted = true;
    const envelope = errorToEnvelope('pdd', err);
    emit(envelope, { json: true, noColor: true });
  }
  closeAllBrowsers({ timeoutMs: 3000 }).catch(() => {}).finally(() => {
    process.exit(ExitCodes.GENERAL);
  });
});

const program = new Command();

program
  .name('pdd')
  .description('拼多多商家后台 CLI · V0 Playwright 模式\n\n命令分组：\n  📦 orders    订单管理\n  🛍️ goods     商品管理\n  🚀 promo     推广报表\n  🩺 diagnose  店铺诊断\n  🏬 shops     店铺切换\n  ⚙️ init / login / doctor  鉴权与环境')
  .version('0.1.0')
  .option('--json', 'stdout 输出单行 JSON（便于 AI/脚本消费）')
  .option('--no-color', '禁用彩色输出')
  .option('--timeout <ms>', '全局超时（毫秒）', (v) => Number(v))
  .option('--mall <id>', '指定店铺 ID（未指定则使用当前）')
  .option('--headed', '以有头浏览器运行（调试）')
  .option('--verbose', '启用 debug 日志')
  .option('--account <slug>', '指定账号（多账号模式）')
  .option('--all-accounts', '对所有注册账号执行命令')
  .showHelpAfterError(false);

program.exitOverride((err) => {
  if (err.code === 'commander.helpDisplayed' || err.code === 'commander.help' || err.code === 'commander.version') {
    process.exitCode = ExitCodes.OK;
  } else if (
    err.code === 'commander.unknownCommand'
    || err.code === 'commander.unknownOption'
    || err.code === 'commander.missingArgument'
    || err.code === 'commander.missingMandatoryOptionValue'
    || err.code === 'commander.invalidArgument'
  ) {
    process.exitCode = ExitCodes.USAGE;
  } else {
    process.exitCode = typeof err.exitCode === 'number' ? err.exitCode : ExitCodes.GENERAL;
  }
  throw err;
});

function mergeOptions(commanderCmd) {
  const merged = commanderCmd.optsWithGlobals();
  const {
    json = false,
    color = true,
    timeout,
    mall,
    headed = false,
    verbose = false,
    qr = false,
    account,
    allAccounts = false,
    consumer = false,
    ...rest
  } = merged;
  return {
    ...rest,
    json: Boolean(json),
    noColor: color === false,
    timeout: typeof timeout === 'number' && Number.isFinite(timeout) ? timeout : undefined,
    timeoutMs: typeof timeout === 'number' && Number.isFinite(timeout) ? timeout : undefined,
    mall,
    headed: Boolean(headed),
    verbose: Boolean(verbose),
    qr: Boolean(qr),
    account: account || undefined,
    allAccounts: Boolean(allAccounts),
    consumer: Boolean(consumer),
  };
}

function wireAction(cmd, commandName, runFn) {
  cmd.action(async function action(_localOpts, commanderCmd) {
    const opts = mergeOptions(commanderCmd ?? this);
    createLogger({ verbose: opts.verbose });
    try {
      const envelope = await runFn(opts);
      if (process.exitCode === 130) {
        // SIGINT already set by batch handler — preserve it
      } else if (envelope && envelope.ok === false) {
        const exitCode = envelope.meta?.exit_code
          ?? (envelope.error?.code ? mapErrorToExit({ code: envelope.error.code }) : ExitCodes.GENERAL);
        process.exitCode = exitCode;
      } else {
        const metaExit = envelope?.meta?.exit_code;
        process.exitCode = (typeof metaExit === 'number' && metaExit !== 0)
          ? metaExit
          : ExitCodes.OK;
      }
    } catch (err) {
      const envelope = errorToEnvelope(commandName, err);
      emit(envelope, { json: opts.json, noColor: opts.noColor });
      process.exitCode = envelope.meta.exit_code;
    }
  });
}

// 固定注册顺序 = help 分组顺序（design D-3）；全局 option 已先于此挂载
registerCore(program, wireAction);
registerShops(program, wireAction);
registerOrders(program, wireAction);
registerGoods(program, wireAction);
registerPromo(program, wireAction);
registerDiagnose(program, wireAction);
registerAction(program, wireAction);
registerAccount(program, wireAction);
registerDaemon(program, wireAction);

async function main() {
  try {
    await program.parseAsync(process.argv);
  } catch (err) {
    if (err && err.code && String(err.code).startsWith('commander.')) {
      const isHelpOrVersion = err.code === 'commander.helpDisplayed'
        || err.code === 'commander.help'
        || err.code === 'commander.version';
      if (isHelpOrVersion) {
        return;
      }
      const envelope = {
        ok: false,
        command: 'pdd',
        data: null,
        error: {
          code: 'E_USAGE',
          message: err?.message ?? 'unknown command or argument',
          hint: '',
          detail: {
            argv: redactRecursive(process.argv.slice(2)),
            commander_code: err.code,
          },
        },
        meta: {
          v: 1,
          exit_code: ExitCodes.USAGE,
          latency_ms: 0,
          warnings: [],
        },
      };
      emit(envelope, { json: true, noColor: true });
      process.exitCode = ExitCodes.USAGE;
      return;
    }
    const envelope = errorToEnvelope('pdd', err);
    emit(envelope, { json: false });
    process.exitCode = envelope.meta.exit_code;
  }
}

main();
