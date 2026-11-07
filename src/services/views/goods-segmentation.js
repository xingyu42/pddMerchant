import { labelOf } from '../../infra/units.js';
import { mallIdOf } from './_shared.js';
import { DATA_COMPLETENESS_LABEL, MATCHED_BY_LABEL } from './labels.js';

export const GOODS_SEGMENT_ITEM_FIELDS = Object.freeze([
  'goods_id', 'goods_name', 'units_sold', 'observed_units_sold', 'quantity', 'stock_days', 'promo_roi',
]);

export function toGoodsSegmentView(data, ctx) {
  return { ...data, summary: { ...data.summary,
    matched_by: labelOf(MATCHED_BY_LABEL, data.summary.matched_by),
    data_completeness: labelOf(DATA_COMPLETENESS_LABEL, data.summary.data_completeness),
  }, mall_id: mallIdOf(ctx) };
}
