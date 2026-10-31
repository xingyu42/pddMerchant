import { runEndpoint } from '../adapter/run-endpoint.js';
import { GOODS_TRAFFIC_LIST } from '../adapter/endpoints/traffic.js';
import { PddCliError, ExitCodes } from '../infra/errors.js';
import { throwIfAborted } from '../infra/abort.js';
import { toLocalDate } from '../infra/units.js';
import { mallIdOf } from './views/_shared.js';
import { toGoodsTrafficView } from './views/goods-traffic.js';
import { collectGoodsTrafficPromo } from './goods-traffic-promo.js';

function optionsOf(days, goodsId) {
  if (![1, 7, 30].includes(days)) throw new PddCliError({ code: 'E_USAGE', message: '--days 仅接受 1、7、30', exitCode: ExitCodes.USAGE });
  if (goodsId != null && (typeof goodsId !== 'string' || !/^[1-9]\d*$/.test(goodsId))) {
    throw new PddCliError({ code: 'E_USAGE', message: '--goods-id 需为正整数字符串', exitCode: ExitCodes.USAGE });
  }
  const today = Date.parse(`${toLocalDate(Date.now())}T00:00:00Z`);
  return { window: { start_date: new Date(today - days * 86400000).toISOString().slice(0, 10),
    end_date: new Date(today - 86400000).toISOString().slice(0, 10), days }, queryType: { 1: 0, 7: 1, 30: 2 }[days] };
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

export async function getGoodsTrafficView(ctx, { days = 30, goodsId } = {}) {
  const { window, queryType } = optionsOf(days, goodsId);
  const { rows, total, truncated } = await collectGoods(ctx, window, queryType, goodsId);
  const hints = ['promo_caliber', 'non_promo_caliber'];
  if (truncated) hints.push('goods_truncated');
  const promo = await collectGoodsTrafficPromo(ctx, rows, window, hints);
  return toGoodsTrafficView(rows, { window, goodsId, total, quality: { goods_truncated: truncated, promo_complete: promo.complete },
    promotions: promo.map, hints, mallId: mallIdOf(ctx) });
}
