// 商品价格管理（madrid）：只负责请求参数与响应形状校验；场景筛选、分转元在 service / view。
import { responseShapeError } from '../../infra/errors.js';
import { toFiniteNumber } from '../../infra/units.js';

export const GOODS_PRICE_PAGE = 'https://mms.pinduoduo.com/kit/goods-price-management';
export const GOODS_PRICE_MAX_PAGE_SIZE = 10;

function requireFen(value, endpoint, field) {
  const fen = toFiniteNumber(value);
  if (fen === null) throw responseShapeError(endpoint, field);
  return fen;
}

function requireId(value, endpoint, field) {
  const id = typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : value;
  if (typeof id !== 'string' || !/^\d+$/.test(id)) throw responseShapeError(endpoint, field);
  return id;
}

function optionalText(value) {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function discount(item, endpoint) {
  if (!item || typeof item !== 'object') throw responseShapeError(endpoint, 'merge_promo_detail_list[] object');
  return { source_type_str: optionalText(item.source_type_str), promo_desc: optionalText(item.promo_desc),
    discount_amount: requireFen(item.discount_amount, endpoint, 'merge_promo_detail_list[].discount_amount') };
}

// 明细缺省仅在平台明确无优惠（avg_discount_amount 为 0）时视为空列表。
function discountList(scene, avg, endpoint) {
  const list = scene.merge_promo_detail_list;
  if (list == null && avg === 0) return [];
  if (!Array.isArray(list)) throw responseShapeError(endpoint, 'merge_promo_detail_list array');
  return list.map((item) => discount(item, endpoint));
}

function scene(item, endpoint) {
  if (!item || typeof item !== 'object') throw responseShapeError(endpoint, 'calculate_price_detail_list[] object');
  const sceneValue = toFiniteNumber(item.consult_price_scene);
  const number = toFiniteNumber(item.number);
  if (sceneValue === null) throw responseShapeError(endpoint, 'consult_price_scene');
  if (number === null || !Number.isInteger(number) || number < 1) throw responseShapeError(endpoint, 'scene number');
  if (!Array.isArray(item.promo_price_list)) throw responseShapeError(endpoint, 'promo_price_list array');
  const avg = requireFen(item.avg_discount_amount, endpoint, 'avg_discount_amount');
  return { consult_price_scene: sceneValue, number, avg_discount_amount: avg,
    promo_price: requireFen(item.promo_price_list[0], endpoint, 'promo_price_list[0]'),
    merge_promo_detail_list: discountList(item, avg, endpoint) };
}

function activity(info, endpoint) {
  if (info == null || info.activity_price == null) return null;
  return { activity_price: requireFen(info.activity_price, endpoint, 'activity_price_info.activity_price'),
    activity_type_desc: optionalText(info.activity_type_desc) };
}

// 列表与补全接口的 SKU 结构相同，补全端点复用此归一化。
export function normalizePriceSku(item, endpoint) {
  if (!item || typeof item !== 'object') throw responseShapeError(endpoint, 'sku_promo_list[] object');
  if (!Array.isArray(item.calculate_price_detail_list)) {
    throw responseShapeError(endpoint, 'calculate_price_detail_list array');
  }
  return { sku_id: requireId(item.sku_id, endpoint, 'sku_id'), sku_spec: optionalText(item.sku_spec),
    group_price: requireFen(item.group_price, endpoint, 'group_price'),
    activity_price_info: activity(item.activity_price_info, endpoint),
    calculate_price_detail_list: item.calculate_price_detail_list.map((entry) => scene(entry, endpoint)) };
}

function goods(item, endpoint) {
  if (!item || typeof item !== 'object') throw responseShapeError(endpoint, 'goods_price_info_list[] object');
  if (!Array.isArray(item.sku_promo_list)) throw responseShapeError(endpoint, 'sku_promo_list array');
  const remain = toFiniteNumber(item.remain_sku_num);
  return { goods_id: requireId(item.goods_id, endpoint, 'goods_id'), goods_name: optionalText(item.goods_name),
    remain_sku_num: remain !== null && Number.isInteger(remain) && remain >= 0 ? remain : null,
    sku_promo_list: item.sku_promo_list.map((sku) => normalizePriceSku(sku, endpoint)) };
}

function normalizeList(raw) {
  const result = raw?.result;
  const total = toFiniteNumber(result?.total);
  if (total === null || !Number.isInteger(total) || total < 0 || !Array.isArray(result?.goods_price_info_list)) {
    throw responseShapeError('goodsPrice.list', 'result.total / goods_price_info_list');
  }
  return { total, goods: result.goods_price_info_list.map((item) => goods(item, 'goodsPrice.list')) };
}

function buildListPayload({ page = 1, size = GOODS_PRICE_MAX_PAGE_SIZE, goodsIds = [], scenes }) {
  return {
    page_num: page, page_size: size, only_low_price_warn_goods: false, only_red_line_goods: false,
    ...(goodsIds.length > 0 ? { goods_search_condition: { goods_id_list: goodsIds.map(Number) } } : {}),
    consult_price_scene_list: [...scenes], source_type: 'PriceManagent',
  };
}

export const GOODS_PRICE_LIST = {
  name: 'goodsPrice.list', strategy: 'page-api', nav: { url: GOODS_PRICE_PAGE },
  apiUrl: '/madrid/price_manage/query_goods_price_with_page',
  buildPayload: buildListPayload,
  successRule: { mode: 'flag-or-code', codeField: 'error_code', codes: [1000000] },
  errorMap: 'upstream', normalize: normalizeList, fixtureListKey: 'result.goods_price_info_list',
};

function normalizeExpand(raw) {
  const result = raw?.result;
  if (!result || typeof result !== 'object' || !Array.isArray(result.sku_promo_list)) {
    throw responseShapeError('goodsPrice.expand', 'result.sku_promo_list');
  }
  return { sku_promo_list: result.sku_promo_list.map((sku) => normalizePriceSku(sku, 'goodsPrice.expand')) };
}

function buildExpandPayload({ goods_id: goodsId, scenes, exposedSkuIds = [] }) {
  return { goods_id: Number(goodsId), consult_price_scene_list: [...scenes],
    exposed_sku_id_list: exposedSkuIds.map(Number) };
}

// 补全接口：与列表同一页面；声明 fixtureVariantKey，fixture 模式下按 goods_id 读取各商品的补全结果。
export const GOODS_PRICE_EXPAND = {
  name: 'goodsPrice.expand', strategy: 'page-api', nav: { url: GOODS_PRICE_PAGE },
  apiUrl: '/madrid/price_manage/expand_all_sku',
  buildPayload: buildExpandPayload,
  successRule: { mode: 'flag-or-code', codeField: 'error_code', codes: [1000000] },
  errorMap: 'upstream', normalize: normalizeExpand, fixtureVariantKey: 'goods_id',
};
