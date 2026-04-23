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
import * as promoSearch from '../src/commands/promo/search.js';
import * as promoScene from '../src/commands/promo/scene.js';
import * as diagnoseShopCmd from '../src/commands/diagnose/shop.js';
import * as diagnoseOrders from '../src/commands/diagnose/orders.js';
import * as diagnoseInventory from '../src/commands/diagnose/inventory.js';
import * as diagnosePromo from '../src/commands/diagnose/promo.js';
import * as diagnoseFunnel from '../src/commands/diagnose/funnel.js';
import { emit } from '../src/infra/output.js';
import { PddCliError, ExitCodes, mapErrorToExit } from '../src/infra/errors.js';
import { createLogger } from '../src/infra/logger.js';

const program = new Command();

program
  .name('pdd')
  .description('拼多多商家后台 CLI · V0 Playwright 模式\n\n命令分组：\n  📦 orders    订单管理\n  🛍️ goods     商品管理\n  🚀 promo     推广报表\n  🩺 diagnose  店铺诊断\n  🏬 shops     店铺切换\n  ⚙️ init / login / doctor  鉴权与环境')
  .version('0.1.0')
  .option('--json', 'stdout 输出单行 JSON（便于 AI/脚本消费）')
  .option('--no-color', '禁用彩色输出')
  .option('--raw', '输出原始接口响应（调试用）')
  .option('--timeout <ms>', '全局超时（毫秒）', (v) => Number(v))
  .option('--mall <id>', '指定店铺 ID（未指定则使用当前）')
  .option('--headed', '以有头浏览器运行（调试）')
  .option('--verbose', '启用 debug 日志')
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
  };
}

function wireAction(cmd, commandName, runFn) {
  cmd.action(async function action(_localOpts, commanderCmd) {
    const opts = mergeOptions(commanderCmd ?? this);
    createLogger({ verbose: opts.verbose });
    try {
      const envelope = await runFn(opts);
      if (envelope && envelope.ok === false) {
        const code = envelope.error?.code ?? 'E_GENERAL';
        process.exitCode = mapErrorToExit({ code });
      } else {
        process.exitCode = ExitCodes.OK;
      }
    } catch (err) {
      emit(
        {
          ok: false,
          command: commandName,
          error: {
            code: err?.code ?? 'E_GENERAL',
            message: err?.message ?? '未知错误',
            hint: err?.hint ?? '',
          },
          meta: { latency_ms: 0 },
        },
        { json: opts.json, noColor: opts.noColor }
      );
      process.exitCode = err instanceof PddCliError ? err.exitCode : mapErrorToExit(err);
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
    .option('--qr', '无头模式：终端渲染二维码 + 保存 PNG 到 data/'),
  'login',
  login.run
);

wireAction(
  program
    .command('doctor')
    .description('⚙️ 环境自检（Chromium / auth-state / 登录态）'),
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
    .description('订单详情（V0 通过列表过滤兜底）')
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

// 🩺 Diagnose
const diagnose = program.command('diagnose').description('🩺 店铺健康诊断');
wireAction(
  diagnose.command('shop').description('店铺总分（4 维度加权平均）'),
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
  diagnose.command('funnel').description('漏斗维度健康（V0 partial）'),
  'diagnose.funnel',
  diagnoseFunnel.run
);

async function main() {
  try {
    await program.parseAsync(process.argv);
  } catch (err) {
    if (err && err.code && String(err.code).startsWith('commander.')) {
      return;
    }
    emit(
      {
        ok: false,
        command: 'pdd',
        error: {
          code: err?.code ?? 'E_GENERAL',
          message: err?.message ?? '未知错误',
          hint: err?.hint ?? '',
        },
        meta: { latency_ms: 0 },
      },
      { json: false }
    );
    process.exitCode = err instanceof PddCliError ? err.exitCode : mapErrorToExit(err);
  }
}

main();
