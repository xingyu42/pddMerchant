import { runEndpoint } from '../adapter/run-endpoint.js';
import {
  GOODS_LIST,
  GOODS_UPDATE_STATUS,
  GOODS_UPDATE_PRICE,
  GOODS_UPDATE_STOCK,
  GOODS_UPDATE_TITLE,
} from '../adapter/endpoints/goods.js';
import { PddCliError, ExitCodes } from '../infra/errors.js';

export const DEFAULT_LOW_STOCK_THRESHOLD = 10;

export function isLowStock(goods, threshold = DEFAULT_LOW_STOCK_THRESHOLD) {
  const qty = Number(goods?.quantity);
  if (!Number.isFinite(qty)) return false;
  return qty <= threshold;
}

function toGoodsRecord(g) {
  return {
    goods_id: g.goods_id ?? g.goodsId ?? null,
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

export function validateWriteValue(field, value) {
  switch (field) {
    case 'status': {
      if (value !== 'onsale' && value !== 'offline') {
        throw new PddCliError({
          code: 'E_USAGE',
          message: `status 必须为 onsale 或 offline，收到: ${value}`,
          exitCode: ExitCodes.USAGE,
        });
      }
      return value;
    }
    case 'price': {
      const n = Number(value);
      if (!Number.isFinite(n) || n <= 0 || Math.floor(n) !== n) {
        throw new PddCliError({
          code: 'E_USAGE',
          message: `price 必须为正整数（单位：分），收到: ${value}`,
          hint: '价格以分为单位，例如 2999 表示 29.99 元',
          exitCode: ExitCodes.USAGE,
        });
      }
      return n;
    }
    case 'stock': {
      const n = Number(value);
      if (!Number.isFinite(n) || n < 0 || Math.floor(n) !== n) {
        throw new PddCliError({
          code: 'E_USAGE',
          message: `quantity 必须为非负整数，收到: ${value}`,
          exitCode: ExitCodes.USAGE,
        });
      }
      return n;
    }
    case 'title': {
      const s = String(value ?? '').trim();
      if (s.length === 0 || s.length > 120) {
        throw new PddCliError({
          code: 'E_USAGE',
          message: `title 长度须在 1-120 字符之间，当前: ${s.length}`,
          exitCode: ExitCodes.USAGE,
        });
      }
      return s;
    }
    default:
      throw new PddCliError({
        code: 'E_USAGE',
        message: `未知的写入字段: ${field}`,
        exitCode: ExitCodes.USAGE,
      });
  }
}

export async function updateGoodsStatus(page, goodsId, status, ctx = {}) {
  const id = validateGoodsId(goodsId);
  validateWriteValue('status', status);
  return runEndpoint(page, GOODS_UPDATE_STATUS, { goods_id: id, status }, ctx);
}

export async function updateGoodsPrice(page, goodsId, price, ctx = {}) {
  const id = validateGoodsId(goodsId);
  const p = validateWriteValue('price', price);
  return runEndpoint(page, GOODS_UPDATE_PRICE, { goods_id: id, price: p, sku_id: ctx.config?.skuId ?? null }, ctx);
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

export async function getGoodsStock(page, params = {}, ctx = {}) {
  const threshold = Number.isFinite(Number(params.threshold))
    ? Number(params.threshold)
    : DEFAULT_LOW_STOCK_THRESHOLD;

  const base = await listGoods(page, {
    ...params,
    size: params.size ?? 50,
  }, ctx);

  const annotated = base.goods.map((g) => ({
    ...g,
    is_low_stock: isLowStock(g, threshold),
  }));
  const low = annotated.filter((g) => g.is_low_stock);

  return {
    total: base.total,
    threshold,
    low_stock_count: low.length,
    low_stock: low,
    goods: annotated,
    sessionId: base.sessionId,
    raw: base.raw,
  };
}
