import { isoToLocalDateTime, yuanFromFen } from '../../infra/units.js';
import { COST_SCOPE_LABEL } from './labels.js';

export const GOODS_COST_ENTRY_FIELDS = Object.freeze([
  'goods_id', 'spec', 'purchase_yuan', 'packaging_yuan', 'courier_yuan',
  'insurance_yuan', 'technical_service_yuan', 'updated_at',
]);

export function toGoodsCostEntry(entry) {
  return {
    goods_id: entry.goods_id ?? null, spec: entry.spec ?? null,
    purchase_yuan: yuanFromFen(entry.purchase_fen), packaging_yuan: yuanFromFen(entry.packaging_fen),
    courier_yuan: yuanFromFen(entry.courier_fen), insurance_yuan: yuanFromFen(entry.insurance_fen),
    technical_service_yuan: yuanFromFen(entry.technical_service_fen),
    updated_at: isoToLocalDateTime(entry.updated_at),
  };
}

export function costSetHeadline(entry, dryRun) {
  const label = COST_SCOPE_LABEL[entry.spec == null ? 'default' : 'spec'];
  return [`${dryRun ? '预演录入' : '已录入'}商品 ${entry.goods_id} 的${label}成本`];
}
