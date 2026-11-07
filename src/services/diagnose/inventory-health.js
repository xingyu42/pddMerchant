import { toFiniteNumber } from '../../infra/units.js';
import { ratioPct } from '../../infra/metrics.js';
import { matchSales } from '../goods-sales-matcher.js';

const STALE_SAMPLE_LIMIT = 10;
const LOW_STOCK_THRESHOLD = 10;

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

function computeStale(orders30d, goods) {
  const { byGoods, matchedBy, ambiguous } = matchSales(goods, orders30d);
  const staleList = [];
  for (const { goods: bucket, unitsSold } of byGoods.values()) {
    const item = bucket[0];
    if (unitsSold === 0 && item.quantity > 0) {
      staleList.push({
        goods_id: item.goods_id,
        goods_name: item.raw_name || item.goods_name,
        quantity: item.quantity,
      });
    }
  }

  return {
    matched_by: matchedBy,
    stale_count: staleList.length,
    stale_sample: staleList.slice(0, STALE_SAMPLE_LIMIT),
    ambiguous_groups: ambiguous,
  };
}

function inventoryQuality(input) {
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

function stockDetail(goods) {
  const total = goods.length;
  const quantities = goods.map((item) => toFiniteNumber(item?.quantity));
  const missing = quantities.includes(null);
  const outOfStock = missing ? null : quantities.filter((quantity) => quantity === 0).length;
  const lowStock = missing ? null : quantities.filter((quantity) => quantity !== 0 && quantity < LOW_STOCK_THRESHOLD).length;
  return {
    total,
    out_of_stock_count: outOfStock,
    low_stock_count: lowStock,
    low_stock_threshold: LOW_STOCK_THRESHOLD,
    out_of_stock_rate_pct: ratioPct(outOfStock, total),
    low_or_out_rate_pct: missing ? null : ratioPct(outOfStock + lowStock, total),
  };
}

function ordersSkipReason(orders, truncated, ratelimited) {
  if (ratelimited) return 'ratelimited';
  if (truncated) return 'truncated';
  return Array.isArray(orders) ? null : 'missing';
}

export function summarizeInventory(input = {}) {
  const { goods, orders30d, goodsTotal, truncated = false, ratelimited = false } = input;
  const dataQuality = inventoryQuality(input);
  if (!Array.isArray(goods)) {
    return { status: 'partial', issues: ['无商品数据'], hints: ['执行 pdd goods list'], detail: { data_quality: dataQuality } };
  }
  const hints = [];
  const detail = { data_quality: dataQuality, ...stockDetail(goods) };
  if (Number.isFinite(goodsTotal) && goodsTotal > goods.length) {
    detail.reported_total = goodsTotal;
    hints.push(`当前仅分析前 ${goods.length} 件商品（共 ${goodsTotal} 件），统计可能不完整`);
  }
  if (!dataQuality.goods_complete) hints.push('商品扫描不完整，库存统计仅代表已采样本');
  const skipReason = ordersSkipReason(orders30d, truncated, ratelimited);
  if (skipReason) {
    Object.assign(detail, staleSkipDetail(skipReason));
    hints.push(staleSkipHint(skipReason));
  } else {
    const stale = computeStale(orders30d, goods);
    Object.assign(detail, stale);

    if (stale.ambiguous_groups.length > 0) {
      hints.push(`${stale.ambiguous_groups.length} 组商品因重名无法唯一匹配，已排除零销量统计`);
    }
  }

  return {
    status: !dataQuality.goods_complete || skipReason ? 'partial' : 'full',
    issues: [],
    hints,
    detail,
  };
}
