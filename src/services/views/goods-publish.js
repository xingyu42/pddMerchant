// 上货结果视图（输出契约 v2）：live 与 fixture 两条流程的结果统一投影为同一形状。
import { labelOf } from '../../infra/units.js';
import { text, toFiniteNumber } from './_shared.js';

export const PUBLISH_STATUS_LABEL = Object.freeze({ draft: '草稿', submitted: '已提交' });

export const PUBLISH_VIEW_FIELDS = Object.freeze([
  'headline', 'goods_id', 'goods_commit_id', 'source_goods_id', 'status', 'cost_template_id',
  'source_title', 'category_path', 'property_mapping', 'sku_preview_count', 'image_transform_enabled',
  'mall_id',
]);

function toPropertyMapping(mapping) {
  if (!mapping || typeof mapping !== 'object') return null;
  return {
    mapped_count: toFiniteNumber(mapping.mapped_count),
    skipped_count: toFiniteNumber(mapping.skipped_count),
  };
}

function publishHeadline(view) {
  const source = view.source_goods_id ? `（来源商品 ${view.source_goods_id}）` : '';
  const first = view.status === PUBLISH_STATUS_LABEL.submitted
    ? `已提交发布：商品 ${view.goods_id}${source}`
    : `已保存草稿：商品 ${view.goods_id}${source}，未提交发布`;
  const category = view.category_path ? `，类目 ${view.category_path}` : '';
  const headline = [first, `运费模板 ${view.cost_template_id ?? '未记录'}${category}`];
  const mapping = view.property_mapping;
  if (mapping) headline.push(`属性映射 ${mapping.mapped_count} 项，跳过 ${mapping.skipped_count} 项`);
  return headline;
}

// result：services/goods-publish.js 内部流程返回（不含 warnings）；缺失项输出 null。
// 提交失败会在内部流程抛错，故「已提交」即代表提交成功，不再回显 submit 结果。
export function toPublishView(result, { sourceGoodsId = null, mallId = null } = {}) {
  const view = {
    goods_id: text(result?.goods_id),
    goods_commit_id: text(result?.goods_commit_id),
    source_goods_id: text(result?.source_goods_id ?? sourceGoodsId),
    status: labelOf(PUBLISH_STATUS_LABEL, result?.status),
    cost_template_id: text(result?.cost_template_id),
    source_title: text(result?.source_title),
    category_path: text(result?.category_path),
    property_mapping: toPropertyMapping(result?.property_mapping),
    sku_preview_count: toFiniteNumber(result?.sku_preview_count),
    image_transform_enabled: result?.image_transform == null ? null : result.image_transform === 'enabled',
    mall_id: mallId,
  };
  return { headline: publishHeadline(view), ...view };
}
