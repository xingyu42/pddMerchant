const DEFAULTS = {
  maxSkuRatio: 5,
  maxGroupSourceRatio: 3.0,
};

export function buildPricingPlan(source) {
  const warnings = [];
  const sourceSkus = Array.isArray(source?.skus) ? source.skus : [];
  const sourceReferencePriceCents = Number(source?.sourceReferencePriceCents);
  const hasValidReferencePrice = Number.isSafeInteger(sourceReferencePriceCents)
    && sourceReferencePriceCents > 0;
  if (!hasValidReferencePrice) warnings.push('source_reference_price_invalid');

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
    const sourceNormalPriceCents = Number(sku.sourceNormalPriceCents);
    const sourcePrice = Number.isSafeInteger(sourcePriceCents) && sourcePriceCents > 0
      ? sourcePriceCents / 100
      : 0;
    const sourceNormalPrice = Number.isSafeInteger(sourceNormalPriceCents)
      && sourceNormalPriceCents > 0
      ? sourceNormalPriceCents / 100
      : 0;
    if (sourcePrice <= 0) warnings.push('source_price_invalid');
    if (sourceNormalPrice <= 0) warnings.push('source_normal_price_invalid');
    if (!Number.isSafeInteger(sku.stock) || sku.stock < 0) warnings.push('source_stock_missing');
    return {
      sourceSkuId: sku.sourceSkuId,
      specValues: sku.specValues,
      sourcePriceCents: sourcePrice > 0 ? sourcePriceCents : 0,
      groupPrice: sourcePrice.toFixed(2),
      singlePrice: sourceNormalPrice.toFixed(2),
      stock: Number.isSafeInteger(sku.stock) && sku.stock >= 0 ? sku.stock : null,
    };
  });
  const first = skuPricing[0];
  const marketPrice = hasValidReferencePrice
    ? (sourceReferencePriceCents / 100).toFixed(2)
    : '0.00';

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

  const group = Number.parseFloat(plan.groupPrice);
  const single = Number.parseFloat(plan.singlePrice);
  const market = Number.parseFloat(plan.marketPrice);
  if (!Number.isFinite(group)) errors.push(`groupPrice (${plan.groupPrice}) is not a number`);
  if (!Number.isFinite(single)) errors.push(`singlePrice (${plan.singlePrice}) is not a number`);
  if (!Number.isFinite(market)) errors.push(`marketPrice (${plan.marketPrice}) is not a number`);

  if (Array.isArray(plan.skuPricing)) {
    if (plan.skuPricing.length === 0) errors.push('source SKU pricing missing');
    const combinations = new Set();
    for (const sku of plan.skuPricing) {
      const skuGroup = Number.parseFloat(sku.groupPrice);
      const skuSingle = Number.parseFloat(sku.singlePrice);
      if (!sku.sourceSkuId) errors.push('source SKU id missing');
      if (!Number.isFinite(skuGroup) || !Number.isFinite(skuSingle) || skuGroup <= 0 || skuSingle <= 0) {
        errors.push(`SKU price invalid (${sku.sourceSkuId ?? 'unknown'})`);
      }
      if (Number.isFinite(skuGroup) && Number.isFinite(skuSingle) && skuGroup > skuSingle) {
        errors.push(`SKU groupPrice > singlePrice (${sku.sourceSkuId ?? 'unknown'})`);
      }
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

  if (Number.isFinite(group) && Number.isFinite(single) && group > single) {
    errors.push(`groupPrice (${plan.groupPrice}) > singlePrice (${plan.singlePrice})`);
  }
  const maxSinglePrice = Math.max(
    Number.isFinite(single) ? single : 0,
    ...(Array.isArray(plan.skuPricing)
      ? plan.skuPricing.map((sku) => {
        const value = Number.parseFloat(sku.singlePrice);
        return Number.isFinite(value) ? value : 0;
      })
      : []),
  );
  if (!Number.isFinite(market) || market <= 0) {
    errors.push(`marketPrice (${plan.marketPrice}) must be positive`);
  } else if (market <= maxSinglePrice) {
    errors.push(`marketPrice (${plan.marketPrice}) must be greater than max singlePrice (${maxSinglePrice.toFixed(2)})`);
  }

  if (plan.skuPrices && plan.skuPrices.length > 1) {
    const prices = plan.skuPrices.map((p) => Number.parseFloat(p)).filter((p) => Number.isFinite(p) && p > 0);
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
