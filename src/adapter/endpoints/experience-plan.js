import { responseShapeError } from '../../infra/errors.js';
import { pickFields, resultObject } from './_shared.js';

// 消费者体验提升计划（退货包运费）只读端点；同模块的开通 / 暂停 / 关闭 / 刷新状态写接口一律不接入。
const LIST_ITEM_FIELDS = ['orderSn', 'serviceAmountVO', 'feeStatusDesc', 'displayStatus', 'effectiveTime',
  'shippingTime', 'isFree'];

function orderInsuranceList(raw) {
  const name = 'experiencePlan.orderInsuranceList';
  const result = resultObject(raw, name);
  const total = result.total;
  if (!Number.isSafeInteger(total) || total < 0) throw responseShapeError(name, 'result.total');
  const rows = result.orderInsurances ?? (total === 0 ? [] : null);
  if (!Array.isArray(rows) || rows.some((row) => !row || typeof row !== 'object')) {
    throw responseShapeError(name, 'result.orderInsurances array');
  }
  return { total, items: rows.map((row) => pickFields(row, LIST_ITEM_FIELDS)) };
}

function endpoint(name, path, normalize, buildPayload = () => ({})) {
  return {
    name: `experiencePlan.${name}`, strategy: 'page-api',
    nav: { url: 'https://mms.pinduoduo.com/freight/return_freight' },
    apiUrl: `/mms-gateway/rfreight/${path}`,
    buildPayload, normalize,
    // 该模块成功码为 1000（报表类接口是 1000000）。
    successRule: { mode: 'flag-and-code', codeField: 'errorCode', codes: [1000] },
    errorMap: 'upstream',
  };
}

export const PLAN_STATUS = endpoint('status', 'mall_insurance_status', (raw) =>
  ({ configStatus: resultObject(raw, 'experiencePlan.status').configStatus ?? null }));

// 未取得费率时上游 result 可能缺少 normalService，费率按缺失处理。
export const PLAN_AVAILABLE_INFO = endpoint('availableInfo', 'mallInsurance/queryAvailableInfo', (raw) =>
  ({ price: raw?.result?.normalService?.algoDailyStrategy?.price ?? null }));

// farDate / closerDate 为距今天数：近 N 天 = [N-1, 0]；days → farDate 映射由 EXPERIENCE_PLAN_REPORT.days.choices 拥有。
export const PLAN_PROFITS = endpoint('profits', 'postpaid/profits', (raw) => {
  const result = resultObject(raw, 'experiencePlan.profits');
  return { orderCount: result.orderCount ?? null, compensationCount: result.compensationCount ?? null };
}, ({ farDate }) => ({ farDate, closerDate: 0 }));

export const PLAN_ORDER_INSURANCE_LIST = {
  ...endpoint('orderInsuranceList', 'postpaid/order_insurance_list', orderInsuranceList,
    // 与页面默认请求一致：收费状态 1 待收费 + 2 收费成功（3 收费取消不查），按创建时间（毫秒）筛选。
    ({ page, createBeginTime, createEndTime }) => ({ pageSize: 10, pageNumber: page - 1,
      queryFeeStatusList: [1, 2], clientType: 1, createBeginTime, createEndTime })),
  fixtureListKey: 'result.orderInsurances',
};
