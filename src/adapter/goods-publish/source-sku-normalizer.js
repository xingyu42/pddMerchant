function asObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

const MAX_SKU_DIMENSIONS = 10;
const MAX_VALUES_PER_DIMENSION = 200;
const MAX_SOURCE_SKUS = 500;

function normalizeDimensionValue(rawValue) {
  if (typeof rawValue === 'string' || typeof rawValue === 'number') {
    const text = String(rawValue).trim();
    return text ? { id: text, text } : null;
  }
  const value = asObject(rawValue);
  if (!value) return null;
  const text = String(value.text ?? value.name ?? value.value ?? value.label ?? '').trim();
  if (!text) return null;
  const id = String(value.id ?? value.valueId ?? value.specValueId ?? text).trim();
  return { id, text };
}

function normalizeDimensions(source, issues) {
  const candidates = [source?.skuDimensions, source?.sku_dimensions, source?.skuProperty, source?.newOptions];
  const rawDimensions = candidates.find((candidate) => Array.isArray(candidate) && candidate.length > 0) ?? [];
  if (rawDimensions.length > MAX_SKU_DIMENSIONS) issues.add('sku_dimension_limit_exceeded');
  return rawDimensions.slice(0, MAX_SKU_DIMENSIONS).map((rawDimension) => {
    const dimension = asObject(rawDimension);
    if (!dimension) return null;
    const name = String(dimension.name ?? dimension.key ?? dimension.specName ?? '').trim();
    const rawValues = dimension.values ?? dimension.options ?? dimension.children ?? dimension.valueList;
    if (!name || !Array.isArray(rawValues)) return null;
    if (rawValues.length > MAX_VALUES_PER_DIMENSION) issues.add('sku_dimension_value_limit_exceeded');
    const values = rawValues.slice(0, MAX_VALUES_PER_DIMENSION).map(normalizeDimensionValue).filter(Boolean);
    return values.length > 0 ? { name, values } : null;
  }).filter(Boolean);
}

function normalizeSpecValues(rawSku) {
  const direct = asObject(rawSku?.specValues) ?? asObject(rawSku?.spec_values);
  if (direct) {
    return Object.fromEntries(Object.entries(direct).map(([name, value]) => [
      String(name).trim(),
      String(asObject(value)?.text ?? asObject(value)?.name ?? asObject(value)?.value ?? value).trim(),
    ]));
  }
  const list = rawSku?.specs ?? rawSku?.properties;
  if (!Array.isArray(list)) return null;
  const entries = list.map((item) => {
    const record = asObject(item);
    if (!record) return null;
    const name = String(record.name ?? record.key ?? record.specName ?? record.spec_name
      ?? record.specKey ?? record.spec_key ?? '').trim();
    const value = String(record.text ?? record.value ?? record.label ?? record.specValue
      ?? record.spec_value ?? record.value_name ?? '').trim();
    return name && value ? [name, value] : null;
  }).filter(Boolean);
  return entries.length > 0 ? Object.fromEntries(entries) : null;
}

function parseInteger(value) {
  if (typeof value === 'string' && !/^\d+$/.test(value.trim())) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : null;
}

function parseYuanToCents(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  if (typeof value === 'number' && !Number.isFinite(value)) return null;
  const text = String(value).trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) return null;
  const [whole, fraction = ''] = text.split('.');
  if (whole.length > 14) return null;
  const cents = (BigInt(whole) * 100n) + BigInt(fraction.padEnd(2, '0'));
  return cents <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(cents) : null;
}

function normalizePriceCents(rawSku, centsKey, yuanKeys) {
  const explicitCents = rawSku?.[centsKey];
  if (explicitCents != null) return parseInteger(explicitCents);
  const yuanValue = yuanKeys.map((key) => rawSku?.[key]).find((value) => value != null);
  return parseYuanToCents(yuanValue);
}

function normalizeReferencePriceCents(source) {
  if (source?.sourceReferencePriceCents != null) {
    return parseInteger(source.sourceReferencePriceCents);
  }
  return parseYuanToCents(source?.linePrice ?? source?.line_price);
}

function normalizeSku(rawSku) {
  const sourceSkuId = String(rawSku?.sourceSkuId ?? rawSku?.skuID ?? rawSku?.skuId ?? '').trim();
  const sourcePriceCents = normalizePriceCents(
    rawSku,
    'sourcePriceCents',
    ['groupPrice', 'group_price'],
  );
  const sourceNormalPriceCents = normalizePriceCents(
    rawSku,
    'sourceNormalPriceCents',
    ['normalPrice', 'normal_price'],
  );
  const stock = parseInteger(rawSku?.stock ?? rawSku?.quantity ?? rawSku?.inventory);
  return {
    sourceSkuId,
    specValues: normalizeSpecValues(rawSku),
    sourcePriceCents,
    sourceNormalPriceCents,
    stock,
  };
}

function validateCombinations(dimensions, skus, issues) {
  if (dimensions.length === 0 && skus.length > 1) issues.add('sku_dimensions_missing');
  const allowed = new Map(dimensions.map((dimension) => [
    dimension.name,
    new Set(dimension.values.map((value) => value.text)),
  ]));
  const combinations = new Set();
  for (const sku of skus) {
    if (!sku.specValues || dimensions.some((dimension) => !sku.specValues[dimension.name])) {
      issues.add('sku_spec_values_missing');
      continue;
    }
    if (dimensions.some((dimension) => !allowed.get(dimension.name).has(sku.specValues[dimension.name]))) {
      issues.add('sku_spec_value_unknown');
      continue;
    }
    const key = dimensions.map((dimension) => `${dimension.name}=${sku.specValues[dimension.name]}`).join('|');
    if (combinations.has(key)) issues.add('sku_combination_duplicate');
    combinations.add(key);
  }
  const expected = dimensions.reduce((count, dimension) => count * dimension.values.length, 1);
  if (dimensions.length > 0 && expected !== skus.length) issues.add('sku_combination_count_mismatch');
}

export function normalizeSourceSkuSnapshot(source) {
  const issues = new Set();
  const skuDimensions = normalizeDimensions(source, issues);
  const rawSkus = Array.isArray(source?.skus) ? source.skus : [];
  const sourceReferencePriceCents = normalizeReferencePriceCents(source);
  if (rawSkus.length > MAX_SOURCE_SKUS) issues.add('source_sku_limit_exceeded');
  const skus = rawSkus.slice(0, MAX_SOURCE_SKUS).map(normalizeSku);
  if (skuDimensions.length === 0 && skus.length === 1 && !skus[0].specValues) {
    skus[0].specValues = {};
  }
  if (skus.length === 0) issues.add('source_skus_missing');
  for (const sku of skus) {
    if (!sku.sourceSkuId) issues.add('source_sku_id_missing');
    if (sku.sourcePriceCents == null || sku.sourcePriceCents <= 0) issues.add('sku_price_invalid');
    if (sku.sourceNormalPriceCents == null || sku.sourceNormalPriceCents <= 0) {
      issues.add('sku_normal_price_invalid');
    }
    if (sku.stock == null || sku.stock < 0) issues.add('sku_stock_missing');
  }
  if (sourceReferencePriceCents == null || sourceReferencePriceCents <= 0) {
    issues.add('source_reference_price_invalid');
  }
  const maxNormalPriceCents = Math.max(
    0,
    ...skus.map((sku) => sku.sourceNormalPriceCents ?? 0),
  );
  if (sourceReferencePriceCents > 0 && sourceReferencePriceCents <= maxNormalPriceCents) {
    issues.add('source_reference_price_not_above_single');
  }
  validateCombinations(skuDimensions, skus, issues);
  return {
    complete: issues.size === 0,
    issues: [...issues],
    sourceReferencePriceCents,
    skuDimensions,
    skus,
  };
}
