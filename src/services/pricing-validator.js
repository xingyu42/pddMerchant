const DEFAULTS = {
  maxSkuRatio: 5,
  minGroupSourceRatio: 1.02,
  maxGroupSourceRatio: 3.0,
  singleMultiplier: 1.15,
  marketMultiplier: 1.8,
};

export function buildPricingPlan(source, opts = {}) {
  const cfg = { ...DEFAULTS, ...opts };
  const warnings = [];
  const sourceSkus = Array.isArray(source?.skus) ? source.skus : [];

  if (sourceSkus.length === 0) {
    warnings.push('source_skus_missing');
    return {
      sourcePrice: 0,
      groupPrice: '0.00',
      singlePrice: '0.00',
      marketPrice: '0.00',
      skuPrices: [],
      skuPricing: [],
      warnings,
    };
  }

  const skuPricing = sourceSkus.map((sku) => {
    const sourcePriceCents = Number(sku.sourcePriceCents);
    const sourcePrice = Number.isSafeInteger(sourcePriceCents) && sourcePriceCents > 0
      ? sourcePriceCents / 100
      : 0;
    if (sourcePrice <= 0) warnings.push('source_price_invalid');
    if (!Number.isSafeInteger(sku.stock) || sku.stock < 0) warnings.push('source_stock_missing');
    return {
      sourceSkuId: sku.sourceSkuId,
      specValues: sku.specValues,
      sourcePriceCents: sourcePrice > 0 ? sourcePriceCents : 0,
      groupPrice: (sourcePrice * cfg.minGroupSourceRatio).toFixed(2),
      singlePrice: (sourcePrice * cfg.singleMultiplier).toFixed(2),
      stock: Number.isSafeInteger(sku.stock) && sku.stock >= 0 ? sku.stock : null,
    };
  });
  const first = skuPricing[0];
  const marketPrice = Math.max(
    ...skuPricing.map((sku) => (sku.sourcePriceCents / 100) * cfg.marketMultiplier),
  ).toFixed(2);

  return {
    sourcePrice: first.sourcePriceCents / 100,
    groupPrice: first.groupPrice,
    singlePrice: first.singlePrice,
    marketPrice,
    skuPrices: skuPricing.map((sku) => sku.groupPrice),
    skuPricing,
    warnings: [...new Set(warnings)],
  };
}

export function validatePricingPlan(plan, constraints = {}) {
  const maxRatio = constraints.maxSkuRatio ?? DEFAULTS.maxSkuRatio;
  const errors = [];
  const warnings = [];

  const group = parseFloat(plan.groupPrice) || 0;
  const single = parseFloat(plan.singlePrice) || 0;
  const market = parseFloat(plan.marketPrice) || 0;

  if (Array.isArray(plan.skuPricing)) {
    if (plan.skuPricing.length === 0) errors.push('source SKU pricing missing');
    const combinations = new Set();
    for (const sku of plan.skuPricing) {
      const skuGroup = parseFloat(sku.groupPrice) || 0;
      const skuSingle = parseFloat(sku.singlePrice) || 0;
      if (!sku.sourceSkuId) errors.push('source SKU id missing');
      if (skuGroup <= 0 || skuSingle <= 0) errors.push(`SKU price invalid (${sku.sourceSkuId ?? 'unknown'})`);
      if (skuGroup > skuSingle) errors.push(`SKU groupPrice > singlePrice (${sku.sourceSkuId ?? 'unknown'})`);
      if (!Number.isSafeInteger(sku.stock) || sku.stock < 0) {
        errors.push(`SKU stock missing (${sku.sourceSkuId ?? 'unknown'})`);
      }
      const specEntries = Object.entries(sku.specValues ?? {})
        .map(([name, value]) => [String(name).trim(), String(value).trim()])
        .filter(([name, value]) => name && value)
        .sort(([left], [right]) => left.localeCompare(right));
      if (plan.skuPricing.length > 1 && specEntries.length === 0) {
        errors.push(`SKU specification missing (${sku.sourceSkuId ?? 'unknown'})`);
      } else if (specEntries.length > 0) {
        const key = specEntries.map(([name, value]) => `${name}=${value}`).join('|');
        if (combinations.has(key)) errors.push(`SKU specification duplicate (${sku.sourceSkuId ?? 'unknown'})`);
        combinations.add(key);
      }
    }
  }

  if (group > single) errors.push(`groupPrice (${plan.groupPrice}) > singlePrice (${plan.singlePrice})`);
  if (single > market) errors.push(`singlePrice (${plan.singlePrice}) > marketPrice (${plan.marketPrice})`);
  if (Array.isArray(plan.skuPricing) && plan.skuPricing.some((sku) => Number(sku.singlePrice) > market)) {
    errors.push(`marketPrice (${plan.marketPrice}) is below a SKU singlePrice`);
  }

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
