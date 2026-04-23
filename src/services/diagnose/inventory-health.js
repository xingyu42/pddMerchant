const STALE_SAMPLE_LIMIT = 10;
const LOW_STOCK_THRESHOLD = 10;

function clampScore(n) {
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function statusFromScore(score) {
  if (score == null) return 'partial';
  if (score >= 80) return 'green';
  if (score >= 50) return 'yellow';
  return 'red';
}

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

function readQuantity(raw, fallback = 1) {
  const q = Number(raw?.quantity ?? raw?.goods_quantity ?? raw?.goodsQuantity);
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
  if (reason === 'truncated') return '30 天订单量超出扫描上限 (500 条)，已跳过滞销分析；stock-level alert 仍有效';
  if (reason === 'ratelimited') return '滞销分析因限流中断已跳过';
  return '未提供 30 天订单数据，跳过滞销分析';
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
        goods_name: g.raw_name || g.goods_name,
        units_sold_30d: 0,
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

export function scoreInventoryHealth({
  goods,
  orders30d,
  truncated = false,
  ratelimited = false,
  goodsTotal,
} = {}) {
  if (!Array.isArray(goods) || goods.length === 0) {
    return {
      score: null,
      status: 'partial',
      issues: ['无商品数据'],
      hints: ['执行 pdd goods list'],
      detail: {},
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

  const outRate = outOfStock / total;
  const lowOrOutRate = (outOfStock + lowStock) / total;
  let score = 100;

  if (outRate > 0.05) {
    score -= 40;
    issues.push(`${outOfStock} 商品缺货（${(outRate * 100).toFixed(1)}%）`);
    hints.push('补货或下架缺货商品');
  } else if (outOfStock > 0) {
    score -= 10;
    issues.push(`${outOfStock} 商品缺货`);
    hints.push('及时补货');
  }

  if (lowOrOutRate > 0.30) {
    score -= 30;
    issues.push(`${outOfStock + lowStock} 商品低库存（${(lowOrOutRate * 100).toFixed(1)}%，>30%）`);
    hints.push('设置库存预警阈值');
  } else if (lowOrOutRate > 0.10) {
    score -= 15;
    issues.push(`${outOfStock + lowStock} 商品低库存（${(lowOrOutRate * 100).toFixed(1)}%）`);
  }

  const detail = {
    total,
    out_of_stock: outOfStock,
    low_stock: lowStock,
    out_of_stock_rate: Number(outRate.toFixed(4)),
    low_or_out_rate: Number(lowOrOutRate.toFixed(4)),
  };

  if (Number.isFinite(goodsTotal) && goodsTotal > total) {
    detail.total_reported = goodsTotal;
    hints.push(`当前仅分析前 ${total} 件商品（共 ${goodsTotal} 件），统计可能不完整`);
  }

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

    if (stale.stale_count > 0) {
      const staleRate = stale.stale_count / total;
      if (staleRate > 0.30) {
        score -= 30;
        issues.push(`${stale.stale_count} 商品疑似滞销（${(staleRate * 100).toFixed(1)}%，>30%）`);
        hints.push('考虑下架或降价滞销商品');
      } else if (staleRate > 0.10) {
        score -= 15;
        issues.push(`${stale.stale_count} 商品疑似滞销（${(staleRate * 100).toFixed(1)}%）`);
      } else {
        score -= 5;
        issues.push(`${stale.stale_count} 商品疑似滞销`);
      }
    }
    if (stale.ambiguous_groups.length > 0) {
      hints.push(`${stale.ambiguous_groups.length} 组商品因重名无法判断滞销，已排除`);
    }
  }

  const finalScore = clampScore(score);
  return {
    score: finalScore,
    status: statusFromScore(finalScore),
    issues,
    hints,
    detail,
  };
}
