import { getPromoReport } from './promo.js';
import { parseYuanToFen, round } from '../infra/units.js';
import { throwIfAborted, abortableSleep } from '../infra/abort.js';
import { responseShapeError } from '../infra/errors.js';
import { sumKnown } from '../infra/metrics.js';
import { createReport } from './operating-report.js';
import { GOODS_PROFIT_REPORT } from './views/goods-profit.js';

function spendFen(value) {
  return value == null ? null : parseYuanToFen(round(value, 2));
}

function addEntities(target, entities) {
  for (const entity of entities) {
    const goodsId = entity.goodsId == null ? '' : String(entity.goodsId);
    if (!/^[1-9]\d*$/.test(goodsId)) continue;
    const previous = target.has(goodsId) ? target.get(goodsId) : 0;
    target.set(goodsId, sumKnown([previous, spendFen(entity.spend)]));
  }
}

async function scanPromo(page, ctx, { window, maxPages, delayMs }, result) {
  for (let pageNumber = 1; pageNumber <= maxPages; pageNumber += 1) {
    throwIfAborted(ctx.signal);
    result.request_count = pageNumber;
    const report = await getPromoReport(page, { type: 'entity', page: pageNumber, size: 50,
      startDate: window.startDate, endDate: window.endDate }, ctx);
    if (!Array.isArray(report?.entities)) throw responseShapeError('promo.entityReport', 'entities');
    result.warnings.push(...(report.unitWarnings ?? []));
    const total = spendFen(report.totals?.spend);
    if (pageNumber === 1) result.total_fen = total;
    else if (report.totals && total !== result.total_fen) result.complete = false;
    addEntities(result.byGoods, report.entities);
    if (report.entities.length < 50) return result;
    if (pageNumber === maxPages) { result.truncated = true; result.complete = false; }
    else await abortableSleep(delayMs, ctx.signal);
  }
  return result;
}

function finishPromo(result) {
  const attributed = sumKnown([...result.byGoods.values()]);
  const total = result.complete ? result.total_fen : null;
  const difference = total === null || attributed === null ? null : total - attributed;
  const hints = [...result.hints];
  const report = createReport({}, GOODS_PROFIT_REPORT, { hints });
  if (!result.complete) report.hint('promo_incomplete');
  if (difference !== null && difference < 0) report.hint('negative_promo_difference');
  if (attributed === null || total === null) report.hint('promo_amount_unknown');
  return { ...result, total_fen: total, attributed_fen: result.complete ? attributed : null,
    shop_fen: difference === null || difference < 0 ? null : difference, hints };
}

export async function collectProfitPromo(page, ctx, { window, maxPages = 100, delayMs = 200 }) {
  const result = { byGoods: new Map(), total_fen: null, complete: true, truncated: false,
    ratelimited: false, warnings: [], hints: [], request_count: 0 };
  const report = createReport(ctx, GOODS_PROFIT_REPORT, { window, hints: result.hints });
  const collected = await report.optional('promo_unavailable', async () =>
    scanPromo(page, ctx, { window, maxPages, delayMs }, result),
  (error) => ({ ...result, complete: false, ratelimited: error.code === 'E_RATE_LIMIT' }));
  return finishPromo(collected);
}
