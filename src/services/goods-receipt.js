// 预估实收服务：调用价格管理列表、按口径选取单件 / 多件场景并收集警告；投影与换算在视图层。
import { runEndpoint } from '../adapter/run-endpoint.js';
import { GOODS_PRICE_EXPAND, GOODS_PRICE_LIST, GOODS_PRICE_MAX_PAGE_SIZE } from '../adapter/endpoints/goods-price.js';
import { usageError } from './goods.js';
import { toGoodsReceiptView } from './views/goods-receipt.js';

export { GOODS_PRICE_MAX_PAGE_SIZE };

// 口径 → 场景值：每种口径只采用自己的单件 / 多件场景，其余场景忽略并告警。
export const RECEIPT_CALIBERS = Object.freeze({
  regular: Object.freeze({ label: '商家出资常规优惠', single: 7, multi: 8 }),
  all: Object.freeze({ label: '商家出资所有优惠', single: 10, multi: 11 }),
});
export const DEFAULT_RECEIPT_CALIBER = 'regular';

// 口径可选值说明：注册器帮助文案与未知口径提示共用。
export function describeReceiptCalibers() {
  return Object.entries(RECEIPT_CALIBERS).map(([name, { label }]) => `${name}（${label}）`).join(' | ');
}

// 选项取值由 commander 在解析阶段校验；此处只把口径名解析为场景表，防御直接调用 service 的未知口径。
function resolveCaliber(name) {
  if (!Object.hasOwn(RECEIPT_CALIBERS, name)) throw usageError(`未知口径：${name}`, `可选：${describeReceiptCalibers()}`);
  return RECEIPT_CALIBERS[name];
}

function selectScenes(goodsId, sku, caliber, warnings) {
  const scenes = sku.calculate_price_detail_list;
  const find = (value) => scenes.find((scene) => scene.consult_price_scene === value) ?? null;
  const ignored = scenes.map((scene) => scene.consult_price_scene)
    .filter((value) => value !== caliber.single && value !== caliber.multi);
  const where = { goods_id: goodsId, sku_id: sku.sku_id };
  if (ignored.length > 0) {
    warnings.push({ code: 'receipt_scene_ignored', ...where, scenes: ignored,
      message: `平台返回了不属于${caliber.label}口径的场景，已忽略` });
  }
  const single = find(caliber.single);
  if (!single) {
    warnings.push({ code: 'receipt_single_missing', ...where, message: '平台未返回单件场景，single 为 null' });
  }
  return { ...sku, single, multi: find(caliber.multi) };
}

function warnIncomplete(item, skus, warnings) {
  const expected = item.sku_promo_list.length + item.remain_sku_num;
  if (skus.length >= expected) return;
  warnings.push({ code: 'receipt_sku_incomplete', goods_id: item.goods_id, expected, actual: skus.length,
    message: `补全后 SKU 数 ${skus.length} 少于平台报告的 ${expected} 个` });
}

// 列表每个商品只带回前几个 SKU；remain_sku_num > 0 的商品按顺序补全，补全结果按 sku_id 去重后追加，数量不足时告警。
async function expandSkus(ctx, item, caliber, warnings) {
  if (item.remain_sku_num === 0) return item.sku_promo_list;
  const exposedSkuIds = item.sku_promo_list.map((sku) => sku.sku_id);
  const expanded = await runEndpoint(ctx.page, GOODS_PRICE_EXPAND,
    { goods_id: item.goods_id, scenes: caliber, exposedSkuIds }, ctx);
  const seen = new Set(exposedSkuIds);
  const extra = expanded.sku_promo_list.filter((sku) => !seen.has(sku.sku_id) && seen.add(sku.sku_id));
  const skus = [...item.sku_promo_list, ...extra];
  warnIncomplete(item, skus, warnings);
  return skus;
}

export async function getGoodsReceiptView(ctx, { goodsIds = [], page = 1, size = GOODS_PRICE_MAX_PAGE_SIZE,
  caliber: caliberName = DEFAULT_RECEIPT_CALIBER } = {}) {
  const caliber = resolveCaliber(caliberName);
  const result = await runEndpoint(ctx.page, GOODS_PRICE_LIST, { page, size, goodsIds, scenes: caliber }, ctx);
  const warnings = [];
  const goods = [];
  for (const item of result.goods) {
    const skus = await expandSkus(ctx, item, caliber, warnings);
    goods.push({ ...item, skus: skus.map((sku) => selectScenes(item.goods_id, sku, caliber, warnings)) });
  }
  const data = toGoodsReceiptView(goods, { total: result.total, page, size, caliberLabel: caliber.label, goodsIds });
  const xhrCount = 1 + result.goods.filter((item) => item.remain_sku_num > 0).length;
  return { data, meta: { xhr_count: xhrCount }, warnings };
}
