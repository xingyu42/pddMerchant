// 预估实收服务：调用价格管理列表、按口径选取单件 / 多件场景并收集警告；投影与换算在视图层。
import { runEndpoint } from '../adapter/run-endpoint.js';
import { GOODS_PRICE_EXPAND, GOODS_PRICE_LIST, GOODS_PRICE_MAX_PAGE_SIZE } from '../adapter/endpoints/goods-price.js';
import { PddCliError, ExitCodes } from '../infra/errors.js';
import { toGoodsReceiptView } from './views/goods-receipt.js';

// 口径 → 场景值：每种口径只采用自己的单件 / 多件场景，其余场景忽略并告警。
export const RECEIPT_CALIBERS = Object.freeze({
  regular: Object.freeze({ label: '商家出资常规优惠', single: 7, multi: 8 }),
});
export const DEFAULT_RECEIPT_CALIBER = 'regular';

function usage(message, hint) {
  return new PddCliError({ code: 'E_USAGE', message, hint, exitCode: ExitCodes.USAGE });
}

function parseGoodsIds(values = []) {
  const ids = values.flatMap((value) => String(value).split(',')).map((value) => value.trim());
  const invalid = ids.find((id) => !/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id)));
  if (invalid !== undefined) {
    throw usage('--goods-id 需为正整数商品 ID', '可重复传入或用逗号分隔，例如 --goods-id 101,102');
  }
  return [...new Set(ids)];
}

export function parseReceiptQuery({ goodsId, page = 1, size = GOODS_PRICE_MAX_PAGE_SIZE } = {}) {
  if (!Number.isSafeInteger(page) || page < 1) throw usage('--page 需为不小于 1 的整数');
  if (!Number.isSafeInteger(size) || size < 1 || size > GOODS_PRICE_MAX_PAGE_SIZE) {
    throw usage(`--size 取值 1–${GOODS_PRICE_MAX_PAGE_SIZE}`, '上游每页最多查询 10 个商品');
  }
  return { goodsIds: parseGoodsIds(goodsId), page, size, caliber: DEFAULT_RECEIPT_CALIBER };
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

// 列表每个商品只带回前几个 SKU；remain_sku_num > 0 的商品按顺序补全，补全结果按 sku_id 去重后追加。
async function expandSkus(ctx, item, scenes) {
  if (!(item.remain_sku_num > 0)) return { skus: item.sku_promo_list, calls: 0 };
  const exposedSkuIds = item.sku_promo_list.map((sku) => sku.sku_id);
  const expanded = await runEndpoint(ctx.page, GOODS_PRICE_EXPAND,
    { goods_id: item.goods_id, scenes, exposedSkuIds }, ctx);
  const seen = new Set(exposedSkuIds);
  const extra = expanded.sku_promo_list.filter((sku) => !seen.has(sku.sku_id) && seen.add(sku.sku_id));
  return { skus: [...item.sku_promo_list, ...extra], calls: 1 };
}

export async function getGoodsReceiptView(ctx, options = {}) {
  const query = parseReceiptQuery(options);
  const caliber = RECEIPT_CALIBERS[query.caliber];
  const scenes = [caliber.single, caliber.multi];
  const result = await runEndpoint(ctx.page, GOODS_PRICE_LIST, { page: query.page, size: query.size,
    goodsIds: query.goodsIds, scenes }, ctx);
  const warnings = [];
  const goods = [];
  let xhrCount = 1;
  for (const item of result.goods) {
    const { skus, calls } = await expandSkus(ctx, item, scenes);
    xhrCount += calls;
    goods.push({ ...item, skus: skus.map((sku) => selectScenes(item.goods_id, sku, caliber, warnings)) });
  }
  const data = toGoodsReceiptView(goods, { total: result.total, page: query.page, size: query.size,
    caliberLabel: caliber.label, goodsIds: query.goodsIds });
  return { data, meta: { xhr_count: xhrCount }, warnings };
}
