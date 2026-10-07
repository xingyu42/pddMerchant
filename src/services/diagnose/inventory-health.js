import { toPct } from '../../infra/units.js';

const STALE_SAMPLE_LIMIT = 10;
const LOW_STOCK_THRESHOLD = 10;

export function normalizeGoodsName(name) {
  return String(name ?? '').trim().normalize('NFKC');
}

function readGoodsId(raw) {
  const id = raw?.goods_id ?? raw?.goodsId;
  if (typeof id === 'number' && Number.isFinite(id) && id > 0) return String(id);
  if (typeof id === 'string') {
    const trimmed = id.trim();
    if (trimmed.length > 0 && trimmed !== '0') return trimmed;
  }
  return null;
}

// 上游订单件数字段为 goods_number（research/upstream-schema-2026-10.md §1）
function readQuantity(raw, fallback = 1) {
  const q = Number(raw?.quantity ?? raw?.goods_number ?? raw?.goods_quantity ?? raw?.goodsQuantity);
  if (Number.isFinite(q) && q > 0) return q;
  return fallback;
}

export function extractItems(order) {
  if (!order || typeof order !== 'object') return [];
  const out = [];
  const nested = Array.isArray(order.items) ? order.items : null;
  if (nested && nested.length > 0) {
    for (const item of nested) {
      const name = normalizeGoodsName(item?.goods_name ?? item?.goodsName);
      if (!name) continue;
      out.push({
        goods_id: readGoodsId(item),
        goods_name: name,
        quantity: readQuantity(item, 1),
      });
    }
    return out;
  }
  const flatName = normalizeGoodsName(order.goods_name ?? order.goodsName);
  if (!flatName) return out;
  out.push({
    goods_id: readGoodsId(order),
    goods_name: flatName,
    quantity: readQuantity(order, 1),
  });
  return out;
}

function inventoryItem(g) {
  return {
    goods_id: readGoodsId(g),
    goods_name: normalizeGoodsName(g?.goods_name ?? g?.goodsName),
    raw_name: String(g?.goods_name ?? g?.goodsName ?? ''),
    quantity: Number(g?.quantity ?? 0),
  };
}

export function buildGoodsKey(item, strategy) {
  if (strategy === 'goods_id' && item.goods_id != null && item.goods_id !== '') {
    return `id:${item.goods_id}`;
  }
  return `name:${normalizeGoodsName(item.goods_name)}`;
}

function detectStrategy(orderItems, goodsItems) {
  if (goodsItems.length === 0) return 'goods_name';
  const goodsAllHaveId = goodsItems.every((g) => g.goods_id != null);
  if (!goodsAllHaveId) return 'goods_name';
  if (orderItems.length === 0) return 'goods_id';
  return orderItems.every((it) => it.goods_id != null) ? 'goods_id' : 'goods_name';
}

function detectMatchedBy(strategy, orderItems, goodsItems) {
  if (strategy === 'goods_id') return 'goods_id';
  // strategy='goods_name': 若一边有 id 另一边无，标 'mixed' 提示降级
  const ordersHaveAnyId = orderItems.some((it) => it.goods_id != null);
  const goodsHaveAnyId = goodsItems.some((g) => g.goods_id != null);
  if (ordersHaveAnyId !== goodsHaveAnyId) return 'mixed';
  return 'goods_name';
}

function staleSkipDetail(reason) {
  const detail = {
    stale_count: null,
    stale_sample: null,
    ambiguous_groups: [],
    matched_by: null,
  };
  if (reason === 'truncated') detail.truncated = true;
  return detail;
}

function staleSkipHint(reason) {
  if (reason === 'truncated') return '30 天订单量超出扫描上限 (500 条)，已跳过零销量统计';
  if (reason === 'ratelimited') return '零销量统计因订单采集限流而跳过';
  return '未提供 30 天订单数据，跳过零销量统计';
}

function computeStale(orders30d, goodsItems) {
  const orderItems = orders30d.flatMap(extractItems);
  const strategy = detectStrategy(orderItems, goodsItems);
  const matchedBy = detectMatchedBy(strategy, orderItems, goodsItems);

  const soldCount = new Map();
  for (const item of orderItems) {
    const key = buildGoodsKey(item, strategy);
    soldCount.set(key, (soldCount.get(key) ?? 0) + item.quantity);
  }

  const buckets = new Map();
  for (const g of goodsItems) {
    const key = buildGoodsKey(g, strategy);
    const arr = buckets.get(key) ?? [];
    arr.push(g);
    buckets.set(key, arr);
  }

  const ambiguousGroups = [];
  const staleList = [];
  for (const [key, bucket] of buckets) {
    if (bucket.length > 1 && key.startsWith('name:')) {
      ambiguousGroups.push({
        normalized_name: key.slice(5),
        sku_count: bucket.length,
        sample_quantities: bucket.map((b) => b.quantity),
      });
      continue;
    }
    const g = bucket[0];
    const sold = soldCount.get(key) ?? 0;
    if (sold === 0 && g.quantity > 0) {
      staleList.push({
        goods_id: g.goods_id,
        goods_name: g.raw_name || g.goods_name,
        quantity: g.quantity,
      });
    }
  }

  return {
    matched_by: matchedBy,
    stale_count: staleList.length,
    stale_sample: staleList.slice(0, STALE_SAMPLE_LIMIT),
    ambiguous_groups: ambiguousGroups,
  };
}

export function summarizeInventory({
  goods,
  orders30d,
  truncated = false,
  ratelimited = false,
  goodsTotal,
  goodsScanTruncated = false,
  goodsScanRateLimited = false,
} = {}) {
  const goodsIncomplete = goodsScanTruncated || goodsScanRateLimited
    || (Number.isFinite(goodsTotal) && goodsTotal > (goods?.length ?? 0));
  const dataQuality = {
    goods_complete: Array.isArray(goods) && !goodsIncomplete,
    orders_complete: Array.isArray(orders30d) && !truncated && !ratelimited,
    goods_truncated: goodsScanTruncated,
    goods_ratelimited: goodsScanRateLimited,
    orders_truncated: truncated,
    orders_ratelimited: ratelimited,
  };
  if (!Array.isArray(goods)) {
    return {
      status: 'partial',
      issues: ['无商品数据'],
      hints: ['执行 pdd goods list'],
      detail: { data_quality: dataQuality },
    };
  }

  const issues = [];
  const hints = [];
  const total = goods.length;
  let outOfStock = 0;
  let lowStock = 0;

  for (const g of goods) {
    const qty = Number(g?.quantity ?? 0);
    if (qty === 0) outOfStock += 1;
    else if (qty < LOW_STOCK_THRESHOLD) lowStock += 1;
  }

  const detail = {
    data_quality: dataQuality,
    total,
    out_of_stock_count: outOfStock,
    low_stock_count: lowStock,
    low_stock_threshold: LOW_STOCK_THRESHOLD,
    out_of_stock_rate_pct: total > 0 ? toPct(outOfStock / total) : null,
    low_or_out_rate_pct: total > 0 ? toPct((outOfStock + lowStock) / total) : null,
  };

  if (Number.isFinite(goodsTotal) && goodsTotal > total) {
    detail.reported_total = goodsTotal;
    hints.push(`当前仅分析前 ${total} 件商品（共 ${goodsTotal} 件），统计可能不完整`);
  }
  if (goodsIncomplete) hints.push('商品扫描不完整，库存统计仅代表已采样本');

  const ordersProvided = Array.isArray(orders30d);
  const skipReason = ratelimited
    ? 'ratelimited'
    : truncated
      ? 'truncated'
      : !ordersProvided
        ? 'missing'
        : null;

  if (skipReason) {
    Object.assign(detail, staleSkipDetail(skipReason));
    hints.push(staleSkipHint(skipReason));
  } else {
    const goodsItems = goods.map(inventoryItem);
    const stale = computeStale(orders30d, goodsItems);
    Object.assign(detail, stale);

    if (stale.ambiguous_groups.length > 0) {
      hints.push(`${stale.ambiguous_groups.length} 组商品因重名无法唯一匹配，已排除零销量统计`);
    }
  }

  return {
    status: goodsIncomplete || skipReason ? 'partial' : 'full',
    issues,
    hints,
    detail,
  };
}
