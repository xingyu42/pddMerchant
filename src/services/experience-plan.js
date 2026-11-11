import { runEndpoint } from '../adapter/run-endpoint.js';
import {
  PLAN_STATUS, PLAN_AVAILABLE_INFO, PLAN_PROFITS, PLAN_ORDER_INSURANCE_LIST,
} from '../adapter/endpoints/experience-plan.js';
import { toExperiencePlanView, EXPERIENCE_PLAN_REPORT } from './views/experience-plan.js';
import { runReport } from './operating-report.js';
import { shanghaiDaysThroughToday } from './report-windows.js';

export { EXPERIENCE_PLAN_REPORT };

// 服务费、费率与计数均为平台报告值，原样输出，不按费率重算。
export async function getExperiencePlanView(ctx, { days = EXPERIENCE_PLAN_REPORT.days.default, page = 1 } = {}) {
  return runReport(ctx, EXPERIENCE_PLAN_REPORT, { days, window: shanghaiDaysThroughToday }, async (report) => {
    const status = await runEndpoint(ctx.page, PLAN_STATUS, {}, ctx);
    const available = await runEndpoint(ctx.page, PLAN_AVAILABLE_INFO, {}, ctx);
    const profits = await runEndpoint(ctx.page, PLAN_PROFITS, { days }, ctx);
    const list = await runEndpoint(ctx.page, PLAN_ORDER_INSURANCE_LIST, { page,
      shippingBeginTime: report.window.startMs, shippingEndTime: report.window.endMs }, ctx);
    report.hint('count_caliber');
    return toExperiencePlanView({ status, available, profits, list }, { window: report.window, page, hints: report.hints });
  });
}
