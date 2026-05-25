const DEFAULTS = {
  maxSkuRatio: 5,
  minGroupSourceRatio: 1.02,
  maxGroupSourceRatio: 3.0,
  singleMultiplier: 1.15,
  marketMultiplier: 1.8,
};

export function buildPricingPlan(source, opts = {}) {
  const cfg = { ...DEFAULTS, ...opts };
  const sourcePrice = parseFloat(source.price) || 0;
  const warnings = [];

  if (sourcePrice <= 0) {
    warnings.push('source_price_invalid');
    return { sourcePrice: 0, groupPrice: '0.00', singlePrice: '0.00', marketPrice: '0.00', skuPrices: [], warnings };
  }

  const groupPrice = (sourcePrice * cfg.minGroupSourceRatio).toFixed(2);
  const singlePrice = (sourcePrice * cfg.singleMultiplier).toFixed(2);
  const marketPrice = (sourcePrice * cfg.marketMultiplier).toFixed(2);

  return {
    sourcePrice,
    groupPrice,
    singlePrice,
    marketPrice,
    skuPrices: [],
    warnings,
  };
}

export function validatePricingPlan(plan, constraints = {}) {
  const maxRatio = constraints.maxSkuRatio ?? DEFAULTS.maxSkuRatio;
  const errors = [];
  const warnings = [];

  const group = parseFloat(plan.groupPrice) || 0;
  const single = parseFloat(plan.singlePrice) || 0;
  const market = parseFloat(plan.marketPrice) || 0;

  if (group > single) errors.push(`groupPrice (${plan.groupPrice}) > singlePrice (${plan.singlePrice})`);
  if (single > market) errors.push(`singlePrice (${plan.singlePrice}) > marketPrice (${plan.marketPrice})`);

  if (plan.skuPrices && plan.skuPrices.length > 1) {
    const prices = plan.skuPrices.map(p => parseFloat(p)).filter(p => p > 0);
    if (prices.length > 1) {
      const max = Math.max(...prices);
      const min = Math.min(...prices);
      if (min > 0 && max / min > maxRatio) {
        warnings.push(`SKU price ratio ${(max / min).toFixed(1)} exceeds limit ${maxRatio}`);
      }
    }
  }

  if (plan.sourcePrice > 0 && group > 0) {
    const ratio = group / plan.sourcePrice;
    if (ratio > (constraints.maxGroupSourceRatio ?? DEFAULTS.maxGroupSourceRatio)) {
      warnings.push(`group/source ratio ${ratio.toFixed(2)} exceeds max ${constraints.maxGroupSourceRatio ?? DEFAULTS.maxGroupSourceRatio}`);
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
  };
}
