import { toFiniteNumber } from '../infra/units.js';

// 商品与订单扫描的完整性；goods/orders30d 缺失（非数组）视为未完整采集。
export function scanQuality(input) {
  const { goods, orders30d, goodsTotal, truncated = false, ratelimited = false,
    goodsScanTruncated = false, goodsScanRateLimited = false } = input;
  const goodsIncomplete = goodsScanTruncated || goodsScanRateLimited
    || (Number.isFinite(goodsTotal) && goodsTotal > (goods?.length ?? 0));
  return {
    goods_complete: Array.isArray(goods) && !goodsIncomplete,
    orders_complete: Array.isArray(orders30d) && !truncated && !ratelimited,
    goods_truncated: goodsScanTruncated,
    goods_ratelimited: goodsScanRateLimited,
    orders_truncated: truncated,
    orders_ratelimited: ratelimited,
  };
}

export function normalizeGoodsName(name) {
  return String(name ?? '').trim().normalize('NFKC');
}

export function readGoodsId(raw) {
  const id = raw?.goods_id ?? raw?.goodsId;
  if (typeof id === 'number' && Number.isFinite(id) && id > 0) return String(id);
  if (typeof id === 'string' && id.trim() && id.trim() !== '0') return id.trim();
  return null;
}

// 上游订单件数字段为 goods_number；缺件数时沿用单件订单口径。
function orderItem(raw) {
  const quantity = toFiniteNumber(raw?.quantity ?? raw?.goods_number ?? raw?.goods_quantity ?? raw?.goodsQuantity);
  return { goods_id: readGoodsId(raw), goods_name: normalizeGoodsName(raw?.goods_name ?? raw?.goodsName),
    quantity: quantity !== null && quantity > 0 ? quantity : 1 };
}

function extractItems(order) {
  if (!order || typeof order !== 'object') return [];
  const items = Array.isArray(order.items) && order.items.length > 0 ? order.items : [order];
  return items.map(orderItem).filter((item) => item.goods_name);
}

function inventoryItem(raw) {
  return { goods_id: readGoodsId(raw), goods_name: normalizeGoodsName(raw?.goods_name ?? raw?.goodsName),
    raw_name: String(raw?.goods_name ?? raw?.goodsName ?? ''), quantity: toFiniteNumber(raw?.quantity) };
}

function detectStrategy(orderItems, goodsItems) {
  if (goodsItems.length === 0 || goodsItems.some((item) => item.goods_id === null)) return 'goods_name';
  return orderItems.every((item) => item.goods_id !== null) ? 'goods_id' : 'goods_name';
}

function detectMatchedBy(strategy, orderItems, goodsItems) {
  if (strategy === 'goods_id') return strategy;
  // 一侧缺少 ID 时按名称回落，保留 mixed 兼容标记，中文翻译由 view 负责。
  const ordersHaveId = orderItems.some((item) => item.goods_id !== null);
  const goodsHaveId = goodsItems.some((item) => item.goods_id !== null);
  return ordersHaveId !== goodsHaveId ? 'mixed' : 'goods_name';
}

function goodsKey(item, strategy) {
  return strategy === 'goods_id' ? `id:${item.goods_id}` : `name:${item.goods_name}`;
}

function groupGoods(goods, strategy) {
  const buckets = new Map();
  for (const item of goods) {
    const key = goodsKey(item, strategy);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(item);
  }
  return buckets;
}

// byGoods: Map<匹配键, { goods: 归一化商品[], unitsSold }>；重名组独立返回，避免重复分配销量。
export function matchSales(goods, orders) {
  const goodsItems = goods.map(inventoryItem);
  const orderItems = (Array.isArray(orders) ? orders : []).flatMap(extractItems);
  const strategy = detectStrategy(orderItems, goodsItems);
  const matchedBy = detectMatchedBy(strategy, orderItems, goodsItems);
  const sales = new Map();
  for (const item of orderItems) {
    const key = goodsKey(item, strategy);
    sales.set(key, (sales.get(key) ?? 0) + item.quantity);
  }
  const byGoods = new Map();
  const ambiguous = [];
  const warnings = [];
  for (const [key, bucket] of groupGoods(goodsItems, strategy)) {
    if (strategy === 'goods_name' && bucket.length > 1) {
      const name = bucket[0].goods_name;
      ambiguous.push({ normalized_name: name, sku_count: bucket.length,
        sample_quantities: bucket.map((item) => item.quantity) });
      warnings.push(`重名商品 "${name}" (${bucket.length} 个) 无法唯一匹配，已排除统计`);
      continue;
    }
    byGoods.set(key, { goods: bucket, unitsSold: sales.get(key) ?? 0 });
  }
  return { byGoods, matchedBy, ambiguous, warnings };
}
