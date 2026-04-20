import { scoreOrdersHealth } from './orders-health.js';
import { scoreInventoryHealth } from './inventory-health.js';
import { scorePromoHealth } from './promo-health.js';
import { scoreFunnelHealth } from './funnel-health.js';

const WEIGHTS = Object.freeze({
  orders: 0.40,
  inventory: 0.25,
  promo: 0.25,
  funnel: 0.10,
});

function shopStatusFromScore(score) {
  if (score == null) return 'partial';
  if (score >= 80) return 'green';
  if (score >= 50) return 'yellow';
  return 'red';
}

export function diagnoseShop({ orders, goods, promo, funnel } = {}) {
  const dimensions = {};
  if (orders !== undefined) dimensions.orders = scoreOrdersHealth(orders);
  if (goods !== undefined) dimensions.inventory = scoreInventoryHealth(goods);
  if (promo !== undefined) dimensions.promo = scorePromoHealth(promo);
  if (funnel !== undefined) dimensions.funnel = scoreFunnelHealth(funnel);

  let weightedSum = 0;
  let weightUsed = 0;
  for (const [name, dim] of Object.entries(dimensions)) {
    if (typeof dim.score === 'number') {
      const w = WEIGHTS[name] ?? 0;
      weightedSum += dim.score * w;
      weightUsed += w;
    }
  }

  const shopScore = weightUsed > 0 ? Math.round(weightedSum / weightUsed) : null;
  const shopStatus = shopStatusFromScore(shopScore);

  const issues = [];
  const hints = [];
  for (const [name, dim] of Object.entries(dimensions)) {
    for (const issue of dim.issues ?? []) issues.push({ dimension: name, message: issue });
    for (const hint of dim.hints ?? []) hints.push({ dimension: name, message: hint });
  }

  return {
    score: shopScore,
    status: shopStatus,
    dimensions,
    issues,
    hints,
    weight_used: Number(weightUsed.toFixed(2)),
  };
}

export {
  scoreOrdersHealth,
  scoreInventoryHealth,
  scorePromoHealth,
  scoreFunnelHealth,
  WEIGHTS,
};
