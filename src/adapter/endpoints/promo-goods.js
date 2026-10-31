import { responseShapeError } from '../../infra/errors.js';
import { round, toFiniteNumber } from '../../infra/units.js';

function present(...values) {
  return values.find((value) => value != null && !(typeof value === 'string' && value.trim() === ''));
}

// 金额对象 unit → 换算为元的除数，与 promo.js MoneyVO 一致；PERCENT 另按 unitCode 换算
const MONEY_UNIT_DIVISOR = { '': 1, YUAN: 1, FEN: 100 };

// 未知单位返回 undefined，由 normalize 记录后按 null 传播
function yuanDivisor(value) {
  if (value == null || typeof value !== 'object') return 1000;
  const unit = typeof value.unit === 'string' ? value.unit.trim().toUpperCase() : '';
  if (unit === 'PERCENT') return toFiniteNumber(value.unitCode) || 100;
  return MONEY_UNIT_DIVISOR[unit];
}

function amountFen(value, unknownUnits) {
  const object = value != null && typeof value === 'object';
  const number = toFiniteNumber(object ? value.value : value);
  if (number === null) return null;
  const divisor = yuanDivisor(value);
  if (divisor === undefined) { unknownUnits.add(String(value.unit)); return null; }
  const fen = round(number / divisor * 100, 0);
  return Number.isSafeInteger(fen) && fen >= 0 ? fen : null;
}

function promotion(row, unknownUnits) {
  const flat = { ...row, ...row?.optimizationMessage, ...row?.reportInfo, ...row?.reportInfo2 };
  if (flat.goodsId == null || String(flat.goodsId).trim() === '') throw responseShapeError('promo.goodsPromotionList', 'goodsId');
  return { goodsId: String(flat.goodsId), click: toFiniteNumber(present(flat.click, flat.clickCount)),
    directOrderNum: toFiniteNumber(flat.directOrderNum), indirectOrderNum: toFiniteNumber(flat.indirectOrderNum),
    directAmountFen: amountFen(present(flat.directGmv, flat.directPayGmv), unknownUnits),
    indirectAmountFen: amountFen(present(flat.indirectGmv, flat.indirectPayGmv), unknownUnits),
    spendFen: amountFen(present(flat.spend, flat.orderMarketingSpend), unknownUnits) };
}

export const GOODS_PROMOTION_LIST = {
  name: 'promo.goodsPromotionList', fixtureIsServiceFacing: true, fixtureListKey: 'items',
  nav: { url: 'https://yingxiao.pinduoduo.com/goods/promotion/list', readyEl: '[class*="promotion"], [class*="Promotion"]' },
  apiUrl: '/mms-gateway/venus/api/goods/promotion/v3/list',
  urlPattern: /mms-gateway\/venus\/api\/goods\/promotion\/v3\/list/,
  trigger: async () => {},
  buildPayload: ({ beginDate, endDate, page = 1, goodsIds, scenesMode }) => ({
    beginDate, endDate, blockType: 3, clientType: 1, pageNumber: page, pageSize: 50,
    filter: { searchKeyV2: goodsIds.join(',') }, sortBy: 9999, orderBy: 9999, scenesMode, withTagsInfo: true,
  }),
  isSuccess: (raw) => raw?.success !== false && raw?.result != null,
  normalize(raw) {
    const result = raw?.result;
    if (result?.adInfos === null && toFiniteNumber(result.totalAdNum) === 0) return { items: [], unknownUnits: [] };
    if (!Array.isArray(result?.adInfos)) throw responseShapeError('promo.goodsPromotionList', 'result.adInfos');
    const unknownUnits = new Set();
    const items = result.adInfos.map((row) => promotion(row, unknownUnits));
    return { items, unknownUnits: [...unknownUnits] };
  },
};
