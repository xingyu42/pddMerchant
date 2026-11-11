import { runEndpoint } from '../adapter/run-endpoint.js';
import {
  GOODS_LIST,
  GOODS_UPDATE_STATUS,
  GOODS_UPDATE_PRICE,
  GOODS_UPDATE_STOCK,
  GOODS_UPDATE_TITLE,
} from '../adapter/endpoints/goods.js';
import { PddCliError, ExitCodes } from '../infra/errors.js';
import { parseYuanToFen, toFiniteNumber } from '../infra/units.js';
import { toGoodsStockView, toGoodsView } from './views/goods.js';
import { mallIdOf } from './views/_shared.js';

export const DEFAULT_LOW_STOCK_THRESHOLD = 10;

export function isLowStock(goods, threshold = DEFAULT_LOW_STOCK_THRESHOLD) {
  const qty = toFiniteNumber(goods?.quantity);
  if (qty === null) return false;
  return qty <= threshold;
}

// 上游 isOnsale 形态未经真实样本确认（布尔或 0/1），其余取值记为未知
function toOnSale(value) {
  if (value === true || value === 1 || value === '1') return true;
  if (value === false || value === 0 || value === '0') return false;
  return null;
}

function toSkuRecord(sku) {
  return {
    sku_id: sku?.skuId ?? null,
    spec: sku?.spec ?? null,
    quantity: toFiniteNumber(sku?.skuQuantity),
    on_sale: toOnSale(sku?.isOnsale),
  };
}

function toGoodsRecord(g) {
  return {
    goods_id: g.goods_id ?? g.goodsId ?? g.id ?? null,
    goods_name: g.goods_name ?? g.goodsName ?? '',
    quantity: toFiniteNumber(g.quantity),
    sku_price: g.sku_price ?? g.skuPrice ?? null,
    sku_group_price: g.sku_group_price ?? g.skuGroupPrice ?? null,
    origin_sku_group_price: g.origin_sku_group_price ?? null,
    promotion: g.promotion ?? g.promotion_goods ?? null,
    mall_id: g.mall_id ?? g.mallId ?? null,
    skus: Array.isArray(g.sku_list) ? g.sku_list.map(toSkuRecord) : null,
  };
}

export async function listGoods(page, params = {}, ctx = {}) {
  const result = await runEndpoint(page, GOODS_LIST, params, ctx);
  const goods = Array.isArray(result?.goods) ? result.goods.map(toGoodsRecord) : [];
  return {
    total: toFiniteNumber(result?.total),
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

export function usageError(message, hint) {
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
  const catalog = total === null ? `${scope}商品总数未获取` : `${scope}商品共 ${total} 件`;
  const headline = [`${catalog}，${label} ${items.length} 件`];
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
  const { items, threshold } = view;
  const soldOut = items.filter((item) => item.quantity !== null && item.quantity <= 0).length;
  const catalog = view.total === null ? '在售总数未获取' : `在售共 ${view.total} 件`;
  const lowSkus = items.flatMap((item) => item.skus ?? []).filter((sku) => sku.low_stock);
  const soldOutSkus = lowSkus.filter((sku) => sku.quantity <= 0).length;
  // 告警商品 = 总库存低 + 仅因规格进入（总库存高于阈值或缺失），两行合计覆盖全部 items
  const skuTriggered = items.length - view.low_stock_count;
  const headline = [
    `${label}扫描 ${view.scanned_count} 件商品（${catalog}）`,
    `库存不高于 ${threshold} 的商品 ${view.low_stock_count} 件（其中缺货 ${soldOut} 件）`,
    `库存不高于 ${threshold} 的在售规格 ${lowSkus.length} 个（其中缺货 ${soldOutSkus} 个），`
      + `总库存高于 ${threshold} 或缺失、因规格库存进入告警的商品 ${skuTriggered} 件`,
  ];
  const skuUnavailable = items.filter((item) => item.skus === null).length;
  if (skuUnavailable > 0) headline.push(`规格数据缺失的告警商品 ${skuUnavailable} 件`);
  return headline;
}

// 规格低库存 = 在售且库存为有限数且 ≤ threshold；on_sale 未知或库存缺失的规格不触发
function isLowStockSku(sku, threshold) {
  return sku.on_sale === true && sku.quantity !== null && sku.quantity <= threshold;
}

// 规格数据不可用（skus 非数组）时 low_stock_sku_count 为 null
function withSkuLowStock(record, threshold) {
  if (!Array.isArray(record.skus)) return { ...record, low_stock_sku_count: null };
  const skus = record.skus.map((sku) => ({ ...sku, low_stock: isLowStockSku(sku, threshold) }));
  return { ...record, skus, low_stock_sku_count: skus.filter((sku) => sku.low_stock).length };
}

// 仅扫描一页商品；items 为该页中总库存 ≤ threshold 或至少一个规格低库存的商品
// low_stock_count 仅计总库存 ≤ threshold 的商品（与 headline 第二行一致）
export async function getGoodsStockView(page, params = {}, ctx = {}) {
  const threshold = Number.isFinite(Number(params.threshold))
    ? Number(params.threshold)
    : DEFAULT_LOW_STOCK_THRESHOLD;
  const base = await listGoods(page, { ...params, size: params.size ?? 50 }, ctx);
  const alerted = base.goods
    .map((g) => withSkuLowStock(g, threshold))
    .filter((g) => isLowStock(g, threshold) || g.low_stock_sku_count > 0);
  const view = {
    items: alerted.map(toGoodsStockView),
    total: base.total,
    scanned_count: base.goods.length,
    threshold,
    low_stock_count: alerted.filter((g) => isLowStock(g, threshold)).length,
    mall_id: mallIdOf(ctx),
  };
  return { headline: stockHeadline(params, view), ...view };
}
