import { labelOf, parseYuanToFen, toFiniteNumber, toLocalDateTime, yuanFromFen } from '../../infra/units.js';
import { defineReport, reportHints } from '../operating-report.js';

// days → 汇总接口 farDate（距今天数，service 按此表传参）；页面数据概况提供今天 / 近 7 / 30 / 90 天。
export const EXPERIENCE_PLAN_REPORT = defineReport({
  days: { choices: { 1: 0, 7: 6, 30: 29, 90: 89 }, default: 7, message: '--days 仅接受 {range}',
    description: '统计窗口天数（{range}，含今天）' },
  hints: {
    count_caliber: '收费订单数和运费补偿订单数取自平台数据概况，收费记录总数按创建时间筛选且只含待收费与收费成功，两者口径可能不同',
  },
});

const SERVICE_STATUS_LABEL = Object.freeze({ 1: '生效中', 2: '已失效', 3: '已补偿运费' });

export const EXPERIENCE_PLAN_ITEM_FIELDS = Object.freeze([
  'order_sn', 'service_fee_yuan', 'fee_status', 'service_status', 'effective_at', 'shipped_at', 'is_free',
]);
export const EXPERIENCE_PLAN_WINDOW_FIELDS = Object.freeze(['days', 'start_at', 'end_at']);
export const EXPERIENCE_PLAN_FIELDS = Object.freeze(['headline', 'window', 'plan_status', 'today_fee_per_order_yuan',
  'charged_order_count', 'compensated_order_count', 'items', 'total', 'page', 'hints', 'mall_id']);

// 金额对象 { unit, value }：仅 YUAN 按字符串精确转元，其他单位输出 null 并登记单位。
// 与 promo 的 parseMoney（Number() 浮点、无 unit 按元、支持 FEN）和 promo-goods 的 amountFen（裸数字为厘、
// 支持 PERCENT）语义不同：本模块只见过 YUAN 样本，故不复用、不推断其他单位。
function moneyReader() {
  const unknownUnits = new Set();
  const read = (money) => {
    if (money == null || typeof money !== 'object') return null;
    if (money.unit !== 'YUAN') {
      unknownUnits.add(String(money.unit ?? '缺失'));
      return null;
    }
    return yuanFromFen(parseYuanToFen(money.value));
  };
  const warnings = () => [...unknownUnits].map((unit) => `体验提升计划金额单位未知（${unit}），对应金额输出为 null`);
  return { read, warnings };
}

function nonNegativeCount(value) {
  const num = toFiniteNumber(value);
  return Number.isSafeInteger(num) && num >= 0 ? num : null;
}

function toFeeRecordItem(row, money) {
  return {
    order_sn: row.orderSn == null ? null : String(row.orderSn), service_fee_yuan: money.read(row.serviceAmountVO),
    fee_status: typeof row.feeStatusDesc === 'string' ? row.feeStatusDesc : null,
    service_status: labelOf(SERVICE_STATUS_LABEL, row.displayStatus),
    effective_at: toLocalDateTime(row.effectiveTime), shipped_at: toLocalDateTime(row.shippingTime),
    is_free: typeof row.isFree === 'boolean' ? row.isFree : null,
  };
}

function buildHeadline({ planStatus, fee, charged, compensated, total, page, items, days }) {
  const span = days === 1 ? '今天' : `近 ${days} 天`;
  const orderCountText = (value) => (value === null ? '缺失' : `${value} 单`);
  return [
    `消费者体验提升计划状态码 ${planStatus ?? '缺失'}（平台原值）`,
    fee === null ? '今日服务费费率缺失' : `今日服务费 ${fee} 元/单`,
    `${span}收费订单 ${orderCountText(charged)}，已获运费补偿订单 ${orderCountText(compensated)}`,
    total === 0 ? `${span}无收费记录` : `${span}收费记录共 ${total} 条，第 ${page} 页返回 ${items.length} 条`,
  ];
}

export function toExperiencePlanView({ status, available, profits, list }, { window, page, hints, mallId = null }) {
  const money = moneyReader();
  const fee = money.read(available.price);
  const items = list.items.map((row) => toFeeRecordItem(row, money));
  const charged = nonNegativeCount(profits.orderCount);
  const compensated = nonNegativeCount(profits.compensationCount);
  const data = {
    headline: buildHeadline({ planStatus: status.configStatus, fee, charged, compensated, total: list.total, page,
      items, days: window.days }),
    window: { days: window.days, start_at: toLocalDateTime(window.startMs), end_at: toLocalDateTime(window.endMs) },
    plan_status: status.configStatus ?? null, today_fee_per_order_yuan: fee,
    charged_order_count: charged, compensated_order_count: compensated,
    items, total: list.total, page, hints: reportHints(EXPERIENCE_PLAN_REPORT, hints), mall_id: mallId,
  };
  return { data, warnings: money.warnings() };
}
