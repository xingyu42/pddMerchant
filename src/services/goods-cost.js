import { listGoodsCosts, upsertGoodsCosts, removeGoodsCost } from '../infra/goods-cost-store.js';
import { costScope, validateCostEntry, validateCostGoodsId, validateCostSpec } from './goods-cost-input.js';
import { toGoodsCostEntry, costSetHeadline } from './views/goods-cost.js';
import { parseCostImport } from './goods-cost-import.js';

export async function listGoodsCostView(ctx, params = {}) {
  const scope = costScope(ctx);
  const goodsId = params.goods_id == null ? undefined : validateCostGoodsId(params.goods_id);
  const items = listGoodsCosts({ ...scope, goodsId }).map(toGoodsCostEntry);
  return { headline: [`已录入商品成本 ${items.length} 条`], items, total: items.length, mall_id: scope.mallId };
}

export async function setGoodsCostView(ctx, { confirm = false, ...input }) {
  const scope = costScope(ctx);
  const entry = validateCostEntry(input);
  const saved = confirm ? upsertGoodsCosts({ ...scope, entries: [entry] }).entries[0] : entry;
  return { headline: costSetHeadline(entry, !confirm), entry: toGoodsCostEntry(saved), dry_run: !confirm, mall_id: scope.mallId };
}

export async function removeGoodsCostView(ctx, { goods_id, spec, confirm = false }) {
  const scope = costScope(ctx);
  const goodsId = validateCostGoodsId(goods_id);
  const exactSpec = validateCostSpec(spec);
  const matched = listGoodsCosts({ ...scope, goodsId }).filter((entry) => entry.spec === exactSpec).length;
  const result = confirm ? removeGoodsCost({ ...scope, goodsId, spec: exactSpec }) : { matched_count: matched, removed_count: 0 };
  const sentence = confirm ? `已删除商品成本 ${result.removed_count} 条` : `预演删除商品成本，匹配 ${matched} 条`;
  return { headline: [sentence], goods_id: goodsId, spec: exactSpec, ...result, dry_run: !confirm, mall_id: scope.mallId };
}

export async function importGoodsCostView(ctx, { file, confirm = false }) {
  const scope = costScope(ctx);
  const entries = await parseCostImport(file);
  const existing = new Set(listGoodsCosts(scope).map((entry) => JSON.stringify([entry.goods_id, entry.spec])));
  const updated = entries.filter((entry) => existing.has(JSON.stringify([entry.goods_id, entry.spec]))).length;
  const result = confirm ? upsertGoodsCosts({ ...scope, entries })
    : { entries, inserted_count: entries.length - updated, updated_count: updated };
  return {
    headline: [`${confirm ? '已导入' : '预演导入'}成本 ${entries.length} 条，新增 ${result.inserted_count} 条、更新 ${result.updated_count} 条`],
    items: result.entries.map(toGoodsCostEntry), total: entries.length,
    inserted_count: result.inserted_count, updated_count: result.updated_count, dry_run: !confirm, mall_id: scope.mallId,
  };
}
