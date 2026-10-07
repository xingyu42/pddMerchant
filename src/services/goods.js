import { runEndpoint } from '../adapter/run-endpoint.js';
import {
  GOODS_LIST,
  GOODS_UPDATE_STATUS,
  GOODS_UPDATE_PRICE,
  GOODS_UPDATE_STOCK,
  GOODS_UPDATE_TITLE,
} from '../adapter/endpoints/goods.js';
import { PddCliError, ExitCodes } from '../infra/errors.js';
import { parseYuanToFen } from '../infra/units.js';
import { toGoodsView } from './views/goods.js';
import { mallIdOf } from './views/_shared.js';

export const DEFAULT_LOW_STOCK_THRESHOLD = 10;

export function isLowStock(goods, threshold = DEFAULT_LOW_STOCK_THRESHOLD) {
  const qty = Number(goods?.quantity);
  if (!Number.isFinite(qty)) return false;
  return qty <= threshold;
}

function toGoodsRecord(g) {
  return {
    goods_id: g.goods_id ?? g.goodsId ?? g.id ?? null,
    goods_name: g.goods_name ?? g.goodsName ?? '',
    quantity: Number.isFinite(Number(g.quantity)) ? Number(g.quantity) : 0,
    sku_price: g.sku_price ?? g.skuPrice ?? null,
    sku_group_price: g.sku_group_price ?? g.skuGroupPrice ?? null,
    origin_sku_group_price: g.origin_sku_group_price ?? null,
    promotion: g.promotion ?? g.promotion_goods ?? null,
    mall_id: g.mall_id ?? g.mallId ?? null,
  };
}

export async function listGoods(page, params = {}, ctx = {}) {
  const result = await runEndpoint(page, GOODS_LIST, params, ctx);
  const goods = Array.isArray(result?.goods) ? result.goods.map(toGoodsRecord) : [];
  return {
    total: Number(result?.total) || 0,
    goods,
    sessionId: result?.sessionId ?? null,
    raw: result?.raw ?? null,
  };
}

export function validateGoodsId(goodsId) {
  if (goodsId == null || goodsId === '') {
    throw new PddCliError({
      code: 'E_USAGE',
      message: 'goods_id 不能为空',
      hint: '请通过 --goods-id 指定商品 ID，可用 pdd goods list 查看',
      exitCode: ExitCodes.USAGE,
    });
  }
  const n = Number(goodsId);
  if (!Number.isFinite(n) || n <= 0 || Math.floor(n) !== n) {
    throw new PddCliError({
      code: 'E_USAGE',
      message: `goods_id 必须为正整数，收到: ${goodsId}`,
      hint: '可用 pdd goods list 获取有效 goods_id',
      exitCode: ExitCodes.USAGE,
    });
  }
  return n;
}

function usageError(message, hint) {
  return new PddCliError({ code: 'E_USAGE', message, ...(hint ? { hint } : {}), exitCode: ExitCodes.USAGE });
}

function validateStatus(value) {
  if (value !== 'onsale' && value !== 'offline') {
    throw usageError(`status 必须为 onsale 或 offline，收到: ${value}`);
  }
  return value;
}

// 元 → 分：字符串精确解析（不做浮点乘法），必须 > 0 且最多 2 位小数
function validatePriceYuan(value) {
  const fen = parseYuanToFen(value);
  if (fen === null || fen <= 0) {
    throw usageError(`price_yuan 必须为大于 0、最多 2 位小数的金额（元），收到: ${value}`, '单位为元，例如 29.9');
  }
  return fen;
}

function validateStock(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || Math.floor(n) !== n) {
    throw usageError(`quantity 必须为非负整数，收到: ${value}`);
  }
  return n;
}

function validateTitle(value) {
  const s = String(value ?? '').trim();
  if (s.length === 0 || s.length > 120) {
    throw usageError(`title 长度须在 1-120 字符之间，当前: ${s.length}`);
  }
  return s;
}

// 写入字段 → 校验器；price_yuan 返回分（上游单位），其余返回归一值
const WRITE_VALIDATORS = {
  status: validateStatus,
  price_yuan: validatePriceYuan,
  stock: validateStock,
  title: validateTitle,
};

export function validateWriteValue(field, value) {
  const validate = Object.hasOwn(WRITE_VALIDATORS, field) ? WRITE_VALIDATORS[field] : null;
  if (!validate) throw usageError(`未知的写入字段: ${field}`);
  return validate(value);
}

export async function updateGoodsStatus(page, goodsId, status, ctx = {}) {
  const id = validateGoodsId(goodsId);
  validateWriteValue('status', status);
  return runEndpoint(page, GOODS_UPDATE_STATUS, { goods_id: id, status }, ctx);
}

// priceYuan 单位为元；上游接口仍以分提交
export async function updateGoodsPrice(page, goodsId, priceYuan, ctx = {}) {
  const id = validateGoodsId(goodsId);
  const fen = validateWriteValue('price_yuan', priceYuan);
  return runEndpoint(page, GOODS_UPDATE_PRICE, { goods_id: id, price: fen, sku_id: ctx.config?.skuId ?? null }, ctx);
}

export async function updateGoodsStock(page, goodsId, quantity, ctx = {}) {
  const id = validateGoodsId(goodsId);
  const q = validateWriteValue('stock', quantity);
  return runEndpoint(page, GOODS_UPDATE_STOCK, { goods_id: id, quantity: q, sku_id: ctx.config?.skuId ?? null }, ctx);
}

export async function updateGoodsTitle(page, goodsId, title, ctx = {}) {
  const id = validateGoodsId(goodsId);
  const t = validateWriteValue('title', title);
  return runEndpoint(page, GOODS_UPDATE_TITLE, { goods_id: id, title: t }, ctx);
}

// ── 输出契约 v2：命令级结果（headline + 领域视图），命令层只透传 ──

function pageLabel(pageNumber) {
  return pageNumber > 1 ? `第 ${pageNumber} 页` : '本页';
}

function goodsListHeadline(params, total, items) {
  const scope = params.status === 'offline' ? '已下架' : '在售';
  if (total === 0 && items.length === 0) return [`${scope}商品共 0 件`];
  const label = pageLabel(params.page ?? 1);
  const headline = [`${scope}商品共 ${total} 件，${label} ${items.length} 件`];
  const soldOut = items.filter((item) => item.quantity === 0).length;
  if (soldOut > 0) headline.push(`${label}库存为 0 的商品 ${soldOut} 件`);
  return headline;
}

export async function getGoodsListView(page, params = {}, ctx = {}) {
  const result = await listGoods(page, params, ctx);
  const items = result.goods.map(toGoodsView);
  return {
    headline: goodsListHeadline(params, result.total, items),
    items,
    total: result.total,
    mall_id: mallIdOf(ctx),
  };
}

function stockHeadline({ page: pageNumber = 1 }, view) {
  const label = pageLabel(pageNumber);
  const soldOut = view.items.filter((item) => item.quantity !== null && item.quantity <= 0).length;
  return [
    `${label}扫描 ${view.scanned_count} 件商品（在售共 ${view.total} 件）`,
    `库存不高于 ${view.threshold} 的商品 ${view.low_stock_count} 件（其中缺货 ${soldOut} 件）`,
  ];
}

// 仅扫描一页商品；items 为该页中库存 ≤ threshold 的商品（已筛选，故不再逐项标记 is_low_stock）
export async function getGoodsStockView(page, params = {}, ctx = {}) {
  const threshold = Number.isFinite(Number(params.threshold))
    ? Number(params.threshold)
    : DEFAULT_LOW_STOCK_THRESHOLD;
  const base = await listGoods(page, { ...params, size: params.size ?? 50 }, ctx);
  const items = base.goods.filter((g) => isLowStock(g, threshold)).map(toGoodsView);
  const view = {
    items,
    total: base.total,
    scanned_count: base.goods.length,
    threshold,
    low_stock_count: items.length,
    mall_id: mallIdOf(ctx),
  };
  return { headline: stockHeadline(params, view), ...view };
}
