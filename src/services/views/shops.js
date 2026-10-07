// 店铺视图（输出契约 v2）：mall-reader 归一后的店铺记录 → { mall_id, name, is_current }
import { labelOf } from '../../infra/units.js';
import { text } from './_shared.js';
import { MALL_SOURCE_LABEL } from './labels.js';

export const SHOP_VIEW_FIELDS = Object.freeze(['mall_id', 'name', 'is_current']);

// 记录可能已由 normalizeMallRecord 归一（id/name），也兼容上游别名；is_current 以当前店铺 ID 为准
export function toShopView(record, activeId) {
  const mallId = text(record?.id ?? record?.mall_id ?? record?.mallId);
  return {
    mall_id: mallId,
    name: text(record?.name ?? record?.mall_name ?? record?.mallName),
    is_current: activeId != null && mallId === String(activeId),
  };
}

// 店铺名缺失时只陈述 ID，不拼接占位名
function describeCurrent(mallId, name) {
  if (!mallId) return '未能识别当前店铺';
  return name ? `当前店铺：${name}（${mallId}）` : `当前店铺 ID ${mallId}（未获取到店铺名）`;
}

export function toShopListView(records, activeId) {
  const items = (Array.isArray(records) ? records : []).map((record) => toShopView(record, activeId));
  const current = items.find((item) => item.is_current);
  return {
    headline: [`共 ${items.length} 个店铺；${describeCurrent(current?.mall_id, current?.name)}`],
    items,
    total: items.length,
  };
}

export function toCurrentShopView(mallCtx) {
  const mallId = text(mallCtx?.activeId);
  const name = text(mallCtx?.activeName);
  return {
    headline: [describeCurrent(mallId, name)],
    mall_id: mallId,
    name,
    source: labelOf(MALL_SOURCE_LABEL, mallCtx?.source),
  };
}
