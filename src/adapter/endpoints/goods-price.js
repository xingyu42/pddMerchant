// 商品价格管理（madrid）：只负责请求参数与响应形状校验；场景筛选、分转元在 service / view。
import { responseShapeError } from '../../infra/errors.js';
import { toFiniteNumber } from '../../infra/units.js';

const GOODS_PRICE_PAGE = 'https://mms.pinduoduo.com/kit/goods-price-management';
export const GOODS_PRICE_MAX_PAGE_SIZE = 10;

function requireObject(value, endpoint, expected) {
  if (!value || typeof value !== 'object') throw responseShapeError(endpoint, expected);
  return value;
}

function requireArray(value, endpoint, expected) {
  if (!Array.isArray(value)) throw responseShapeError(endpoint, expected);
  return value;
}

function requireFen(value, endpoint, field) {
  const fen = toFiniteNumber(value);
  if (fen === null) throw responseShapeError(endpoint, field);
  return fen;
}

function requireCount(value, endpoint, field, min = 0) {
  const count = toFiniteNumber(value);
  if (count === null || !Number.isInteger(count) || count < min) throw responseShapeError(endpoint, field);
  return count;
}

function requireId(value, endpoint, field) {
  const id = typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : value;
  if (typeof id !== 'string' || !/^\d+$/.test(id)) throw responseShapeError(endpoint, field);
  return id;
}

function optionalText(value) {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function normalizeDiscount(item, endpoint) {
  requireObject(item, endpoint, 'merge_promo_detail_list[] object');
  return { source_type_str: optionalText(item.source_type_str), promo_desc: optionalText(item.promo_desc),
    discount_amount: requireFen(item.discount_amount, endpoint, 'merge_promo_detail_list[].discount_amount') };
}

// 明细缺省仅在平台明确无优惠（avg_discount_amount 为 0）时视为空列表。
function normalizeDiscounts(list, avg, endpoint) {
  if (list == null && avg === 0) return [];
  return requireArray(list, endpoint, 'merge_promo_detail_list array').map((item) => normalizeDiscount(item, endpoint));
}

function normalizeSceneDetail(item, sceneValue, endpoint) {
  const prices = requireArray(item.promo_price_list, endpoint, 'promo_price_list array');
  const avg = requireFen(item.avg_discount_amount, endpoint, 'avg_discount_amount');
  return { consult_price_scene: sceneValue, avg_discount_amount: avg,
    promo_price: requireFen(prices[0], endpoint, 'promo_price_list[0]'),
    merge_promo_detail_list: normalizeDiscounts(item.merge_promo_detail_list, avg, endpoint) };
}

// 只严格校验请求口径的单件 / 多件场景（件数仅多件需要）；其他场景只保留场景值，交给 service 忽略并告警。
function normalizeScene(item, endpoint, scenes) {
  requireObject(item, endpoint, 'calculate_price_detail_list[] object');
  const sceneValue = toFiniteNumber(item.consult_price_scene);
  if (sceneValue === null) throw responseShapeError(endpoint, 'consult_price_scene');
  if (sceneValue === scenes.single) return normalizeSceneDetail(item, sceneValue, endpoint);
  if (sceneValue !== scenes.multi) return { consult_price_scene: sceneValue };
  return { ...normalizeSceneDetail(item, sceneValue, endpoint),
    number: requireCount(item.number, endpoint, 'scene number', 1) };
}

function readActivityPrice(info, endpoint) {
  if (info == null || info.activity_price == null) return null;
  return { activity_price: requireFen(info.activity_price, endpoint, 'activity_price_info.activity_price'),
    activity_type_desc: optionalText(info.activity_type_desc) };
}

// 列表与补全接口的 SKU 结构相同，补全端点复用此归一化。
function normalizePriceSku(item, endpoint, scenes) {
  requireObject(item, endpoint, 'sku_promo_list[] object');
  const details = requireArray(item.calculate_price_detail_list, endpoint, 'calculate_price_detail_list array');
  return { sku_id: requireId(item.sku_id, endpoint, 'sku_id'), sku_spec: optionalText(item.sku_spec),
    group_price: requireFen(item.group_price, endpoint, 'group_price'),
    activity_price_info: readActivityPrice(item.activity_price_info, endpoint),
    calculate_price_detail_list: details.map((entry) => normalizeScene(entry, endpoint, scenes)) };
}

function normalizeGoods(item, endpoint, scenes) {
  requireObject(item, endpoint, 'goods_price_info_list[] object');
  const skus = requireArray(item.sku_promo_list, endpoint, 'sku_promo_list array');
  return { goods_id: requireId(item.goods_id, endpoint, 'goods_id'), goods_name: optionalText(item.goods_name),
    remain_sku_num: requireCount(item.remain_sku_num, endpoint, 'remain_sku_num'),
    sku_promo_list: skus.map((sku) => normalizePriceSku(sku, endpoint, scenes)) };
}

function normalizeList(raw, { scenes }) {
  const endpoint = 'goodsPrice.list';
  const expected = 'result.total / goods_price_info_list';
  const total = requireCount(raw?.result?.total, endpoint, expected);
  const list = requireArray(raw.result.goods_price_info_list, endpoint, expected);
  return { total, goods: list.map((item) => normalizeGoods(item, endpoint, scenes)) };
}

const sceneList = (scenes) => [scenes.single, scenes.multi];

function buildListPayload({ page = 1, size = GOODS_PRICE_MAX_PAGE_SIZE, goodsIds = [], scenes }) {
  return {
    page_num: page, page_size: size, only_low_price_warn_goods: false, only_red_line_goods: false,
    ...(goodsIds.length > 0 ? { goods_search_condition: { goods_id_list: goodsIds.map(Number) } } : {}),
    consult_price_scene_list: sceneList(scenes), source_type: 'PriceManagent',
  };
}

// 列表与补全接口同在价格管理页面，共用页面 API 传输与上游成功码 / 业务原文规则。
const PRICE_PAGE_API = {
  strategy: 'page-api', nav: { url: GOODS_PRICE_PAGE },
  successRule: { mode: 'flag-or-code', codeField: 'error_code', codes: [1000000] }, errorMap: 'upstream',
};

export const GOODS_PRICE_LIST = {
  ...PRICE_PAGE_API, name: 'goodsPrice.list', apiUrl: '/madrid/price_manage/query_goods_price_with_page',
  buildPayload: buildListPayload, normalize: normalizeList, fixtureListKey: 'result.goods_price_info_list',
};

function normalizeExpand(raw, { scenes }) {
  const endpoint = 'goodsPrice.expand';
  const result = requireObject(raw?.result, endpoint, 'result.sku_promo_list');
  const skus = requireArray(result.sku_promo_list, endpoint, 'result.sku_promo_list');
  return { sku_promo_list: skus.map((sku) => normalizePriceSku(sku, endpoint, scenes)) };
}

function buildExpandPayload({ goods_id: goodsId, scenes, exposedSkuIds = [] }) {
  return { goods_id: Number(goodsId), consult_price_scene_list: sceneList(scenes),
    exposed_sku_id_list: exposedSkuIds.map(Number) };
}

// 补全接口声明 fixtureVariantKey，fixture 模式下按 goods_id 读取各商品的补全结果。
export const GOODS_PRICE_EXPAND = {
  ...PRICE_PAGE_API, name: 'goodsPrice.expand', apiUrl: '/madrid/price_manage/expand_all_sku',
  buildPayload: buildExpandPayload, normalize: normalizeExpand, fixtureVariantKey: 'goods_id',
};
