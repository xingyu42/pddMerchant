import { runEndpoint } from '../adapter/run-endpoint.js';
import { GOODS_TRAFFIC_LIST } from '../adapter/endpoints/traffic.js';
import { PddCliError, ExitCodes } from '../infra/errors.js';
import { throwIfAborted } from '../infra/abort.js';
import { mallIdOf } from './views/_shared.js';
import { toGoodsTrafficView, GOODS_TRAFFIC_REPORT } from './views/goods-traffic.js';
import { runReport } from './operating-report.js';
import { collectGoodsTrafficPromo } from './goods-traffic-promo.js';
import { readTrafficWindow } from './traffic.js';

export { GOODS_TRAFFIC_REPORT };

function validateGoodsId(goodsId) {
  if (goodsId != null && (typeof goodsId !== 'string' || !/^[1-9]\d*$/.test(goodsId))) {
    throw new PddCliError({ code: 'E_USAGE', message: '--goods-id 需为正整数字符串', exitCode: ExitCodes.USAGE });
  }
}

async function collectGoods(ctx, window, queryType, goodsId) {
  const rows = [];
  let total = 0;
  for (let page = 1; page <= 20; page += 1) {
    throwIfAborted(ctx.signal);
    const result = await runEndpoint(ctx.page, GOODS_TRAFFIC_LIST, { startDate: window.start_date,
      endDate: window.end_date, queryType, page, goodsId }, ctx);
    total = result.total;
    rows.push(...result.items);
    if (rows.length >= total) return { rows, total, truncated: false };
    if (result.items.length === 0) return { rows, total, truncated: true };
  }
  return { rows, total, truncated: true };
}

export async function getGoodsTrafficView(ctx, { days = GOODS_TRAFFIC_REPORT.days.default, goodsId } = {}) {
  return runReport(ctx, GOODS_TRAFFIC_REPORT, { days }, async (report) => {
    validateGoodsId(goodsId);
    const queryType = GOODS_TRAFFIC_REPORT.days.choices[days];
    const window = await readTrafficWindow(ctx, days);
    report.window = window;
    const { rows, total, truncated } = await collectGoods(ctx, window, queryType, goodsId);
    report.hint('promo_caliber');
    report.hint('non_promo_caliber');
    if (truncated) report.hint('goods_truncated');
    const promo = await collectGoodsTrafficPromo(ctx, rows, window, report.hints);
    return toGoodsTrafficView(rows, { window, goodsId, total, quality: { goods_truncated: truncated, promo_complete: promo.complete },
      promotions: promo.map, hints: report.hints, mallId: mallIdOf(ctx) });
  });
}
