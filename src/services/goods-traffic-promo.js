import { runEndpoint } from '../adapter/run-endpoint.js';
import { GOODS_PROMOTION_LIST } from '../adapter/endpoints/promo-goods.js';
import { PddCliError } from '../infra/errors.js';
import { throwIfAborted } from '../infra/abort.js';
import { parseYuanToFen, round, toFiniteNumber } from '../infra/units.js';

const FIELDS = ['directOrderNum', 'indirectOrderNum', 'directAmountFen', 'indirectAmountFen', 'spendFen', 'click'];
const zero = () => Object.fromEntries(FIELDS.map((field) => [field, 0]));

function addPromotion(map, row) {
  const sum = map.get(String(row.goodsId));
  if (!sum) return;
  for (const key of FIELDS) sum[key] = sum[key] === null || row[key] == null ? null : sum[key] + row[key];
}

async function collectBatch(ctx, goodsIds, window, { map, hints }) {
  const requested = new Set(goodsIds);
  for (const scenesMode of [1, 3]) {
    for (let page = 1; page <= 20; page += 1) {
      throwIfAborted(ctx.signal);
      const result = await runEndpoint(ctx.page, GOODS_PROMOTION_LIST, { page, scenesMode, goodsIds,
        beginDate: window.start_date, endDate: window.end_date }, ctx);
      result.items.filter((row) => requested.has(String(row.goodsId))).forEach((row) => addPromotion(map, row));
      if (result.unknownUnits?.length) hints.push('promo_unknown_unit');
      if (result.items.length < 50) break;
      if (page === 20) return false;
    }
  }
  return true;
}

function difference(total, direct, hints) {
  if (total === null || direct == null) return null;
  const value = total - direct;
  if (value >= 0) return value;
  hints.push('negative_difference');
  return null;
}

export async function collectGoodsTrafficPromo(ctx, rows, window, hints) {
  const ids = [...new Set(rows.map((row) => String(row.goodsId)))];
  const map = new Map(ids.map((id) => [id, zero()]));
  let complete = true;
  try {
    for (let offset = 0; offset < ids.length && complete; offset += 50) {
      complete = await collectBatch(ctx, ids.slice(offset, offset + 50), window, { map, hints });
    }
    throwIfAborted(ctx.signal);
  } catch (error) {
    throwIfAborted(ctx.signal);
    if (error?.code === 'E_TIMEOUT' || error?.name === 'AbortError' || !(error instanceof PddCliError)) throw error;
    complete = false;
  }
  if (!complete) { hints.push('promo_unavailable'); return { complete, map: new Map() }; }
  for (const row of rows) {
    const promo = map.get(String(row.goodsId));
    promo.nonPromoOrders = difference(toFiniteNumber(row.payOrdrCnt), promo.directOrderNum, hints);
    promo.nonPromoAmountFen = difference(parseYuanToFen(round(row.payOrdrAmt)), promo.directAmountFen, hints);
  }
  return { complete, map };
}
