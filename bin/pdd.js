#!/usr/bin/env node
import { Command } from 'commander';
import * as init from '../src/commands/init.js';
import * as login from '../src/commands/login.js';
import * as doctor from '../src/commands/doctor.js';
import * as shopsList from '../src/commands/shops/list.js';
import * as shopsCurrent from '../src/commands/shops/current.js';
import * as ordersListCmd from '../src/commands/orders/list.js';
import * as ordersDetail from '../src/commands/orders/detail.js';
import * as ordersStats from '../src/commands/orders/stats.js';
import * as goodsListCmd from '../src/commands/goods/list.js';
import * as goodsStock from '../src/commands/goods/stock.js';
import * as goodsSegment from '../src/commands/goods/segment.js';
import * as goodsUpdateStatus from '../src/commands/goods/update/status.js';
import * as goodsUpdatePrice from '../src/commands/goods/update/price.js';
import * as goodsUpdateStock from '../src/commands/goods/update/stock.js';
import * as goodsUpdateTitle from '../src/commands/goods/update/title.js';
import * as goodsUpdateBatch from '../src/commands/goods/update/batch.js';
import * as promoSearch from '../src/commands/promo/search.js';
import * as promoScene from '../src/commands/promo/scene.js';
import * as promoRoi from '../src/commands/promo/roi.js';
import * as diagnoseShopCmd from '../src/commands/diagnose/shop.js';
import * as diagnoseOrders from '../src/commands/diagnose/orders.js';
import * as diagnoseInventory from '../src/commands/diagnose/inventory.js';
import * as diagnosePromo from '../src/commands/diagnose/promo.js';
import * as diagnoseFunnel from '../src/commands/diagnose/funnel.js';
import * as daemonCmd from '../src/commands/daemon.js';
import * as actionPlan from '../src/commands/action/plan.js';
import * as accountCmd from '../src/commands/account.js';
import { emit } from '../src/infra/output.js';
import { PddCliError, ExitCodes, mapErrorToExit, errorToEnvelope } from '../src/infra/errors.js';
import { createLogger, redactRecursive } from '../src/infra/logger.js';
import { closeAllBrowsers } from '../src/adapter/browser.js';

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
  .option('--raw', '输出原始接口响应（deprecated, V0.4 移除）')
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
    raw = false,
    timeout,
    mall,
    headed = false,
    verbose = false,
    qr = false,
    account,
    allAccounts = false,
    ...rest
  } = merged;
  return {
    ...rest,
    json: Boolean(json),
    noColor: color === false,
    raw: Boolean(raw),
    timeout: typeof timeout === 'number' && Number.isFinite(timeout) ? timeout : undefined,
    timeoutMs: typeof timeout === 'number' && Number.isFinite(timeout) ? timeout : undefined,
    mall,
    headed: Boolean(headed),
    verbose: Boolean(verbose),
    qr: Boolean(qr),
    account: account || undefined,
    allAccounts: Boolean(allAccounts),
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
        process.exitCode = ExitCodes.OK;
      }
    } catch (err) {
      const envelope = errorToEnvelope(commandName, err);
      emit(envelope, { json: opts.json, noColor: opts.noColor });
      process.exitCode = envelope.meta.exit_code;
    }
  });
}

// ⚙️ Utility (top-level)
wireAction(
  program
    .command('init')
    .description('⚙️ 首次交互式登录（默认弹浏览器；加 --qr 则无头扫码）')
    .option('--qr', '无头模式：终端渲染二维码 + 保存 PNG 到 data/'),
  'init',
  init.run
);

wireAction(
  program
    .command('login')
    .description('⚙️ 重新登录（刷新 auth-state）')
    .option('--qr', '无头模式：终端渲染二维码 + 保存 PNG 到 data/')
    .option('--password', '��码登录模式（交互式输入手机号+密码）'),
  'login',
  login.run
);

wireAction(
  program
    .command('doctor')
    .description('⚙️ 环境自检（Chromium / auth-state / 登录态）')
    .option('--probe <mode>', 'mall context 探测策略：xhr = state 探测 miss 时主动 reload 激活 XHR 兜底；默认不额外探测'),
  'doctor',
  doctor.run
);

// 🏬 Shops
const shops = program.command('shops').description('🏬 店铺管理');
wireAction(
  shops.command('list').description('列出当前账号下所有店铺'),
  'shops.list',
  shopsList.run
);
wireAction(
  shops.command('current').description('显示当前店铺'),
  'shops.current',
  shopsCurrent.run
);

// 📦 Orders
const orders = program.command('orders').description('📦 订单管理');
wireAction(
  orders
    .command('list')
    .description('订单列表')
    .option('--page <n>', '页码', (v) => Number(v), 1)
    .option('--size <n>', '每页数量', (v) => Number(v), 20)
    .option('--since <unix>', '起始时间（Unix 秒）', (v) => Number(v))
    .option('--until <unix>', '结束时间（Unix 秒）', (v) => Number(v)),
  'orders.list',
  ordersListCmd.run
);
wireAction(
  orders
    .command('detail')
    .description('订单详情（按订单号查询）')
    .requiredOption('--sn <sn>', '订单号 / shipping_id'),
  'orders.detail',
  ordersDetail.run
);
wireAction(
  orders
    .command('stats')
    .description('订单统计（远程 + 本地聚合 P50/P95）')
    .option('--size <n>', '本地聚合样本数', (v) => Number(v), 50),
  'orders.stats',
  ordersStats.run
);

// 🛍️ Goods
const goods = program.command('goods').description('🛍️ 商品管理');
wireAction(
  goods
    .command('list')
    .description('商品列表')
    .option('--page <n>', '页码', (v) => Number(v), 1)
    .option('--size <n>', '每页数量', (v) => Number(v), 10)
    .option('--status <s>', '状态筛选：onsale | offline', 'onsale'),
  'goods.list',
  goodsListCmd.run
);
wireAction(
  goods
    .command('stock')
    .description('库存告警（按阈值筛低库存/缺货）')
    .option('--page <n>', '页码', (v) => Number(v), 1)
    .option('--size <n>', '每页数量', (v) => Number(v), 50)
    .option('--threshold <n>', '低库存阈值', (v) => Number(v), 10),
  'goods.stock',
  goodsStock.run
);
wireAction(
  goods
    .command('segment')
    .description('商品分层（A/B/C/D 四象限）')
    .option('--days <n>', '销量统计窗口天数', (v) => Number(v), 30)
    .option('--size <n>', '商品分页大小', (v) => Number(v), 50)
    .option('--max-pages <n>', '最大商品页数', (v) => Number(v), 10)
    .option('--break-even <n>', '推广保本 ROI 阈值', (v) => Number(v), 1.0)
    .option('--no-promo', '跳过推广 ROI 数据'),
  'goods.segment',
  goodsSegment.run
);

// 🛍️ Goods Update (write ops)
const goodsUpdate = goods.command('update').description('商品编辑（写操作，需 --confirm 确认）');
wireAction(
  goodsUpdate
    .command('status')
    .description('上下架')
    .requiredOption('--goods-id <id>', '商品 ID', (v) => Number(v))
    .requiredOption('--status <s>', '目标状态: onsale | offline')
    .option('--confirm', '确认执行（默认 dry-run）'),
  'goods.update.status',
  goodsUpdateStatus.run
);
wireAction(
  goodsUpdate
    .command('price')
    .description('修改价格')
    .requiredOption('--goods-id <id>', '商品 ID', (v) => Number(v))
    .requiredOption('--price <cents>', '价格（分）', (v) => Number(v))
    .option('--sku-id <id>', 'SKU ID（可选）')
    .option('--confirm', '确认执行（默认 dry-run）'),
  'goods.update.price',
  goodsUpdatePrice.run
);
wireAction(
  goodsUpdate
    .command('stock')
    .description('修改库存')
    .requiredOption('--goods-id <id>', '商品 ID', (v) => Number(v))
    .requiredOption('--quantity <n>', '库存数量', (v) => Number(v))
    .option('--sku-id <id>', 'SKU ID（可选）')
    .option('--confirm', '确认执行（默认 dry-run）'),
  'goods.update.stock',
  goodsUpdateStock.run
);
wireAction(
  goodsUpdate
    .command('title')
    .description('修改标题')
    .requiredOption('--goods-id <id>', '商品 ID', (v) => Number(v))
    .requiredOption('--title <text>', '新标题')
    .option('--confirm', '确认执行（默认 dry-run）'),
  'goods.update.title',
  goodsUpdateTitle.run
);
wireAction(
  goodsUpdate
    .command('batch')
    .description('批量编辑（JSON 输入）')
    .requiredOption('--changes <json>', '变更列表 JSON: [{"goods_id":1001,"field":"price","value":2999}]')
    .option('--confirm', '确认执行（默认 dry-run）'),
  'goods.update.batch',
  goodsUpdateBatch.run
);

// 🚀 Promo
const promo = program.command('promo').description('🚀 推广报表');
wireAction(
  promo
    .command('search')
    .description('搜索推广 / 全量推广实体报表')
    .option('--since <date>', '起始日期 YYYY-MM-DD')
    .option('--page <n>', '页码', (v) => Number(v), 1)
    .option('--size <n>', '每页数量', (v) => Number(v), 10),
  'promo.search',
  promoSearch.run
);
wireAction(
  promo
    .command('scene')
    .description('场景推广报表')
    .option('--since <date>', '起始日期 YYYY-MM-DD')
    .option('--page <n>', '页码', (v) => Number(v), 1)
    .option('--size <n>', '每页数量', (v) => Number(v), 10),
  'promo.scene',
  promoScene.run
);
wireAction(
  promo
    .command('roi')
    .description('推广 ROI 诊断（按计划/商品/渠道维度）')
    .option('--by <dimension>', '分组维度 plan|sku|channel', 'plan')
    .option('--since <date>', '起始日期 YYYY-MM-DD')
    .option('--page <n>', '页码', (v) => Number(v), 1)
    .option('--size <n>', '每页数量', (v) => Number(v), 50)
    .option('--break-even <n>', '保本 ROI 阈值', (v) => Number(v), 1.0)
    .option('--include-inactive', '包含已删除/暂停计划'),
  'promo.roi',
  promoRoi.run
);

// 🩺 Diagnose
const diagnose = program.command('diagnose').description('🩺 店铺健康诊断');
wireAction(
  diagnose.command('shop').description('店铺总分（4 维度加权平均）')
    .option('--compare', '启用环比对比')
    .option('--days <n>', '对比窗口天数', (v) => Number(v), 7),
  'diagnose.shop',
  diagnoseShopCmd.run
);
wireAction(
  diagnose.command('orders').description('订单维度健康（P95 / 退款 / 堆积）'),
  'diagnose.orders',
  diagnoseOrders.run
);
wireAction(
  diagnose.command('inventory').description('库存维度健康（缺货 / 低库存）'),
  'diagnose.inventory',
  diagnoseInventory.run
);
wireAction(
  diagnose.command('promo').description('推广维度健康（ROI / CTR）'),
  'diagnose.promo',
  diagnosePromo.run
);
wireAction(
  diagnose.command('funnel').description('漏斗维度健康（退款率 / 履约率）')
    .option('--days <n>', '分析窗口天数', (v) => Number(v), 30),
  'diagnose.funnel',
  diagnoseFunnel.run
);

// 🎯 Action
const action = program.command('action').description('🎯 运营动作');
wireAction(
  action
    .command('plan')
    .description('生成优先级运营动作清单')
    .option('--days <n>', '诊断窗口天数', (v) => Number(v), 7)
    .option('--compare', '包含环比趋势')
    .option('--limit <n>', '最大动作数', (v) => Number(v), 10)
    .option('--break-even <n>', '推广保本 ROI 阈值', (v) => Number(v), 1.0)
    .option('--no-promo', '跳过推广 ROI')
    .option('--no-segment', '跳过商品分层'),
  'action.plan',
  actionPlan.run
);

// 👤 Account
const account = program.command('account').description('👤 多账号管理');
wireAction(
  account.command('add').description('添加新账号（密码登录 + 自动注册）'),
  'account.add',
  accountCmd.add
);
wireAction(
  account.command('remove')
    .description('移除账号')
    .requiredOption('--slug <slug>', '账号 slug')
    .option('--remove-files', '同时删除账号目录'),
  'account.remove',
  accountCmd.remove
);
wireAction(
  account.command('list').description('列出所有账号'),
  'account.list',
  accountCmd.list
);
wireAction(
  account.command('default')
    .description('设置默认账号')
    .requiredOption('--slug <slug>', '账号 slug'),
  'account.default',
  accountCmd.setDefault
);

// 🔄 Daemon
const daemon = program.command('daemon').description('🔄 后台 auth 自动续期');
wireAction(
  daemon.command('start').description('启动 daemon（后台定时刷新 cookie）'),
  'daemon.start',
  daemonCmd.start
);
wireAction(
  daemon.command('stop').description('停止 daemon'),
  'daemon.stop',
  daemonCmd.stop
);
wireAction(
  daemon.command('status').description('查看 daemon 状态'),
  'daemon.status',
  daemonCmd.status
);

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
