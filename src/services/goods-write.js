// 商品写操作编排（输出契约 v2）：校验 → 预演 / 提交 → 回显 + headline。
// 输入与回显的价格单位均为元（price_yuan）；上游接口仍以分提交（见 services/goods.js updateGoodsPrice）。
import { ExitCodes } from '../infra/errors.js';
import { yuanFromFen } from '../infra/units.js';
import {
  updateGoodsPrice, updateGoodsStatus, updateGoodsStock, updateGoodsTitle,
  validateGoodsId, validateWriteValue,
} from './goods.js';
import { mallIdOf, toFiniteNumber } from './views/_shared.js';

// field → { update, subject（headline 主语，可空）, action(value), sku（是否回显 sku_id）}
const WRITE_FIELDS = {
  status: {
    update: updateGoodsStatus, subject: '', sku: false,
    action: (value) => value,
  },
  price_yuan: {
    update: updateGoodsPrice, subject: '价格', sku: true,
    action: (value) => `改为 ${value.toFixed(2)} 元`,
  },
  stock: {
    update: updateGoodsStock, subject: '库存', sku: true,
    action: (value) => `改为 ${value}`,
  },
  title: {
    update: updateGoodsTitle, subject: '标题', sku: false,
    action: (value) => `改为「${value}」`,
  },
};

export const GOODS_WRITE_FIELDS = Object.freeze(Object.keys(WRITE_FIELDS));

// 上下架目标状态（CLI 取值 onsale / offline）→ 中文动作标签，仅用于回显
const STATUS_ACTION_LABEL = Object.freeze({ onsale: '上架', offline: '下架' });

function echoValue(field, normalized) {
  if (field === 'price_yuan') return yuanFromFen(normalized);
  if (field === 'status') return STATUS_ACTION_LABEL[normalized];
  return normalized;
}

// 校验并生成回显：{ goods_id, field, value[, sku_id] }；price_yuan 回显为元，status 回显为中文动作
export function planGoodsWrite({ field, goodsId, value, skuId }) {
  const spec = WRITE_FIELDS[field];
  const id = validateGoodsId(goodsId);
  const normalized = validateWriteValue(field, value);
  return {
    goods_id: String(id),
    field,
    value: echoValue(field, normalized),
    ...(spec.sku ? { sku_id: skuId ?? null } : {}),
  };
}

function describeWrite(plan, { dryRun }) {
  const spec = WRITE_FIELDS[plan.field];
  const sku = plan.sku_id ? `（SKU ${plan.sku_id}）` : '';
  const action = spec.action(plan.value);
  const target = `商品 ${plan.goods_id}${sku} ${spec.subject}`;
  return dryRun ? `预演：${target}将${action}，未提交` : `已提交：${target}${action}`;
}

// 上游写接口结果 → { success, failed_count }（不透传上游字段名）
export function toWriteResultView(result) {
  return {
    success: result?.success === true,
    failed_count: toFiniteNumber(result?.fail_goods_num),
  };
}

// 写入上游：使用原始输入（price_yuan 为元字符串 / 数字），由 update* 内部再次校验并换算为分
export function applyGoodsWrite(page, { field, goodsId, value }, ctx) {
  return WRITE_FIELDS[field].update(page, validateGoodsId(goodsId), value, ctx);
}

export async function executeGoodsWrite(ctx, { field, goodsId, value, skuId, confirm }) {
  const plan = planGoodsWrite({ field, goodsId, value, skuId });
  const mallId = mallIdOf(ctx);
  if (!confirm) {
    return { headline: [describeWrite(plan, { dryRun: true })], ...plan, dry_run: true, mall_id: mallId };
  }
  const result = toWriteResultView(await applyGoodsWrite(ctx.page, { field, goodsId, value }, ctx));
  const headline = [describeWrite(plan, { dryRun: false })];
  if (result.failed_count > 0) headline.push(`平台返回 ${result.failed_count} 个商品修改失败`);
  return { headline, ...plan, dry_run: false, result, mall_id: mallId };
}

function batchExitCode(succeeded, failed) {
  if (failed === 0) return ExitCodes.OK;
  return succeeded > 0 ? ExitCodes.PARTIAL : ExitCodes.BUSINESS;
}

// 逐项串行提交；单项失败不中断，结果保序
async function applyBatch(ctx, items) {
  const results = [];
  for (const item of items) {
    const echo = { goods_id: String(validateGoodsId(item.goods_id)), field: item.field };
    try {
      await applyGoodsWrite(ctx.page, { field: item.field, goodsId: item.goods_id, value: item.value }, ctx);
      results.push({ ...echo, ok: true });
    } catch (err) {
      results.push({ ...echo, ok: false, error_code: err.code ?? 'E_GENERAL', message: err.message ?? '' });
    }
  }
  return results;
}

// items 已由命令层解析为 [{ goods_id, field, value }]；全部校验通过后才会写入任何一项
export async function executeGoodsBatchWrite(ctx, items, { confirm }) {
  const planned = items.map((item) => planGoodsWrite({ field: item.field, goodsId: item.goods_id, value: item.value }));
  const mallId = mallIdOf(ctx);
  if (!confirm) {
    const headline = [`预演：共 ${planned.length} 项商品修改，未提交`];
    return { data: { headline, planned, count: planned.length, dry_run: true, mall_id: mallId }, exitCode: ExitCodes.OK };
  }
  const results = await applyBatch(ctx, items);
  const succeeded = results.filter((item) => item.ok).length;
  const failed = results.length - succeeded;
  const headline = [`已提交 ${results.length} 项商品修改：成功 ${succeeded} 项，失败 ${failed} 项`];
  return {
    data: { headline, succeeded, failed, results, dry_run: false, mall_id: mallId },
    exitCode: batchExitCode(succeeded, failed),
  };
}
