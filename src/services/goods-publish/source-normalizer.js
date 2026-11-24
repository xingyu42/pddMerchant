import { PddCliError, ExitCodes } from '../../infra/errors.js';
import { parseYuanToFen } from '../../infra/units.js';

const MAX_SOURCE_PROPERTIES = 100;
const MAX_VALUES_PER_PROPERTY = 20;
const MAX_PROPERTY_TEXT_LENGTH = 200;

function normalizePropertyText(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/[‐‑‒–—―]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeSourceProperty(rawProperty) {
  const property = asObject(rawProperty);
  if (!property) return null;
  const name = normalizePropertyText(property.name ?? property.key ?? property.propertyName ?? property.property_name);
  const rawValues = property.values ?? property.valueList ?? property.value_list;
  if (!name || !Array.isArray(rawValues)) return null;
  const values = rawValues
    .slice(0, MAX_VALUES_PER_PROPERTY)
    .map((value) => normalizePropertyText(asObject(value)?.value ?? asObject(value)?.text ?? value))
    .filter((value) => value && value.length <= MAX_PROPERTY_TEXT_LENGTH);
  if (values.length === 0) return null;
  const refPid = property.refPid ?? property.ref_pid;
  const referenceId = property.referenceId ?? property.reference_id;
  return {
    name: name.slice(0, MAX_PROPERTY_TEXT_LENGTH),
    values: [...new Set(values)],
    refPid: refPid == null ? '' : normalizePropertyText(refPid),
    referenceId: referenceId == null ? '' : normalizePropertyText(referenceId),
  };
}

export function normalizeSourceGoodsProperties(rawProperties) {
  if (!Array.isArray(rawProperties)) return [];
  return rawProperties.slice(0, MAX_SOURCE_PROPERTIES).map(normalizeSourceProperty).filter(Boolean);
}

export const SOURCE_CACHE_VERSION = 4;

const GOODS_ID_RE = /^\d+$/;
const MAX_SKU_DIMENSIONS = 10;
const MAX_VALUES_PER_DIMENSION = 200;
const MAX_SOURCE_SKUS = 500;
const MAX_THUMB_URL_LENGTH = 2048;

function asObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function parseInteger(value) {
  if (typeof value === 'string' && !/^\d+$/.test(value.trim())) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : null;
}

function safePathname(rawUrl) {
  try {
    return new URL(rawUrl).pathname;
  } catch {
    return null;
  }
}

export function parseGoodsUrl(url) {
  if (!url || typeof url !== 'string') {
    throw new PddCliError({
      code: 'E_USAGE',
      message: '无效的商品链接或 ID',
      hint: '支持格式：商品链接 URL 或纯数字 goods_id',
      exitCode: ExitCodes.USAGE,
    });
  }

  const trimmed = url.trim();
  if (GOODS_ID_RE.test(trimmed)) return trimmed;

  try {
    const parsed = new URL(trimmed);
    const goodsId = parsed.searchParams.get('goods_id');
    if (goodsId && GOODS_ID_RE.test(goodsId)) return goodsId;
  } catch {
    // fall through to E_USAGE
  }

  throw new PddCliError({
    code: 'E_USAGE',
    message: `无法从链接中提取 goods_id: ${trimmed}`,
    hint: '确认链接包含 goods_id 参数，或直接传入数字 ID',
    exitCode: ExitCodes.USAGE,
  });
}

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

function normalizePriceCents(rawSku, centsKey, yuanKeys) {
  const explicitCents = rawSku?.[centsKey];
  if (explicitCents != null) return parseInteger(explicitCents);
  const yuanValue = yuanKeys.map((key) => rawSku?.[key]).find((value) => value != null);
  return parseYuanToFen(yuanValue);
}

function normalizeReferencePriceCents(source) {
  if (source?.sourceReferencePriceCents != null) {
    return parseInteger(source.sourceReferencePriceCents);
  }
  return parseYuanToFen(source?.linePrice ?? source?.line_price);
}

function normalizeThumbUrl(value, issues) {
  if (value == null || value === '') return '';
  if (typeof value !== 'string') {
    issues.add('sku_thumb_url_invalid');
    return '';
  }
  const normalized = value.trim();
  if (normalized.length > MAX_THUMB_URL_LENGTH) {
    issues.add('sku_thumb_url_invalid');
    return '';
  }
  return normalized;
}

function normalizeSku(rawSku, issues) {
  const sourceSkuId = String(rawSku?.sourceSkuId ?? rawSku?.skuID ?? rawSku?.skuId ?? '').trim();
  const sourcePriceCents = normalizePriceCents(rawSku, 'sourcePriceCents', ['groupPrice', 'group_price']);
  const sourceNormalPriceCents = normalizePriceCents(rawSku, 'sourceNormalPriceCents', ['normalPrice', 'normal_price']);
  const stock = parseInteger(rawSku?.stock ?? rawSku?.quantity ?? rawSku?.inventory);
  return {
    sourceSkuId,
    specValues: normalizeSpecValues(rawSku),
    sourcePriceCents,
    sourceNormalPriceCents,
    stock,
    thumbUrl: normalizeThumbUrl(rawSku?.thumbUrl ?? rawSku?.thumb_url, issues),
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
  const skus = rawSkus.slice(0, MAX_SOURCE_SKUS).map((sku) => normalizeSku(sku, issues));
  if (skuDimensions.length === 0 && skus.length === 1 && !skus[0].specValues) {
    skus[0].specValues = {};
  }
  if (skus.length === 0) issues.add('source_skus_missing');
  for (const sku of skus) {
    if (!sku.sourceSkuId) issues.add('source_sku_id_missing');
    if (sku.sourcePriceCents == null || sku.sourcePriceCents <= 0) issues.add('sku_price_invalid');
    if (sku.sourceNormalPriceCents == null || sku.sourceNormalPriceCents <= 0) issues.add('sku_normal_price_invalid');
    if (sku.stock == null || sku.stock < 0) issues.add('sku_stock_missing');
  }
  if (sourceReferencePriceCents == null || sourceReferencePriceCents <= 0) {
    issues.add('source_reference_price_invalid');
  }
  const maxNormalPriceCents = Math.max(0, ...skus.map((sku) => sku.sourceNormalPriceCents ?? 0));
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

function dimensionValueText(value) {
  return String(asObject(value)?.text ?? asObject(value)?.name ?? asObject(value)?.value ?? value ?? '').trim();
}

export function buildSkuPreviewPlan(snapshot) {
  const dimensions = Array.isArray(snapshot?.skuDimensions) ? snapshot.skuDimensions : [];
  const colorDimensions = dimensions.filter((dimension) => /颜色|花色/.test(String(dimension?.name ?? '')));
  if (colorDimensions.length === 0) return { ok: false, issues: ['sku_preview_color_dimension_missing'], plan: [] };
  if (colorDimensions.length !== 1) return { ok: false, issues: ['sku_preview_color_dimension_ambiguous'], plan: [] };

  const issues = new Set();
  const colorDimension = colorDimensions[0];
  const colorName = String(colorDimension.name).trim();
  const colors = (Array.isArray(colorDimension.values) ? colorDimension.values : [])
    .map(dimensionValueText)
    .filter(Boolean);
  const groupedUrls = new Map(colors.map((color) => [color, new Set()]));

  for (const sku of Array.isArray(snapshot?.skus) ? snapshot.skus : []) {
    const color = String(sku?.specValues?.[colorName] ?? '').trim();
    if (!groupedUrls.has(color)) {
      issues.add('sku_preview_mapping_missing');
      continue;
    }
    const thumbUrl = typeof sku?.thumbUrl === 'string' ? sku.thumbUrl.trim() : '';
    if (thumbUrl) groupedUrls.get(color).add(thumbUrl);
  }

  const plan = [];
  for (const color of colors) {
    const urls = [...groupedUrls.get(color)];
    if (urls.length === 0) issues.add('sku_preview_mapping_missing');
    else if (urls.length !== 1) issues.add('sku_preview_mapping_ambiguous');
    else plan.push({ merchantColor: color, sourceImageUrl: urls[0] });
  }
  const reusedUrls = new Set();
  for (const item of plan) {
    if (reusedUrls.has(item.sourceImageUrl)) issues.add('sku_preview_mapping_ambiguous');
    reusedUrls.add(item.sourceImageUrl);
  }
  return { ok: issues.size === 0, issues: [...issues], plan: issues.size === 0 ? plan : [] };
}

export function scoreSourceObservation(candidateData) {
  const source = candidateData?._decodedSkuSource ?? candidateData;
  const snapshot = normalizeSourceSkuSnapshot(source);
  return {
    source,
    snapshot,
    score: (snapshot.complete ? 1_000_000 : 0)
      + (snapshot.skuDimensions.length * 10_000)
      + (snapshot.skus.length * 10)
      - (snapshot.issues.length * 100),
  };
}

export function selectBestObservation(earlyData, finalData) {
  const earlyScored = earlyData ? scoreSourceObservation(earlyData) : null;
  const finalScored = scoreSourceObservation(finalData);
  const selectedSkuSource = earlyScored && earlyScored.score > finalScored.score
    ? earlyScored.source
    : finalScored.source;
  const data = finalData && typeof finalData === 'object' ? { ...finalData } : {};
  delete data._decodedSkuSource;
  return { data, selectedSkuSource };
}

function isPriceMasked(price) {
  if (price === null || price === undefined) return true;
  const str = String(price).trim();
  if (str === '' || !/^\d+(\.\d+)?$/.test(str)) return true;
  return Number(str) <= 0;
}

export function buildEmptyShellError(data, cooldownResult = {}) {
  return new PddCliError({
    code: 'E_RATE_LIMIT',
    message: '源商品页返回反爬空壳（未渲染商品数据，命中"打开APP"墙）',
    hint: '当前出口 IP/会话被 PDD H5 降级。可尝试更换网络出口或稍后重试；此为上游反爬拦截，非链接错误',
    detail: {
      fiberFound: data?._fiberFound ?? false,
      appWall: data?._appWall ?? true,
      bodyLen: data?._bodyLen ?? null,
      title: data?._title ?? null,
      reason: 'empty_shell',
      ...(cooldownResult.cooldownTriggered !== undefined
        ? {
          cooldown_triggered: cooldownResult.cooldownTriggered,
          cooldown_remaining_ms: cooldownResult.cooldownRemainingMs,
        }
        : {}),
    },
    exitCode: ExitCodes.RATE_LIMIT,
  });
}

function validateNormalizedSource(data, skuSnapshot = normalizeSourceSkuSnapshot(data)) {
  if (data?._fiberFound === false && data?._appWall === true) {
    throw buildEmptyShellError(data);
  }
  const missing = [];
  if (!data?.goodsName) missing.push('goodsName (title)');
  if (!data?.catID && !data?.catID3) missing.push('catID / catID3');
  if (!Array.isArray(data?.carousel) || data.carousel.length === 0) missing.push('carousel (轮播图)');

  if (missing.length > 0) {
    throw new PddCliError({
      code: 'E_BUSINESS',
      message: `商品数据不完整，缺少必填字段: ${missing.join(', ')}`,
      hint: '检查商品链接是否正确，或页面结构已变更',
      exitCode: ExitCodes.BUSINESS,
    });
  }

  if (!skuSnapshot.complete) {
    throw new PddCliError({
      code: 'E_SOURCE_SKU_UNAVAILABLE',
      message: '源商品规格、逐 SKU 价格或库存数据不完整',
      hint: '已在创建商家草稿前停止；不会使用统一价格、猜测库存或数组顺序继续上货',
      detail: {
        dimension_count: skuSnapshot.skuDimensions.length,
        sku_count: skuSnapshot.skus.length,
        issues: skuSnapshot.issues,
      },
      exitCode: ExitCodes.BUSINESS,
    });
  }
}

export function classifySourceObservation(observation, { earlyObservation = null, pageUrl = null } = {}) {
  const { data, selectedSkuSource } = selectBestObservation(earlyObservation, observation);
  const decodedSkuCount = Array.isArray(selectedSkuSource?.skus) ? selectedSkuSource.skus.length : 0;
  const skuSnapshot = normalizeSourceSkuSnapshot(selectedSkuSource ?? data);

  data.sourceReferencePriceCents = skuSnapshot.sourceReferencePriceCents;
  data.skuDimensions = skuSnapshot.skuDimensions;
  data.skus = skuSnapshot.skus;
  data.goodsProperties = Array.isArray(selectedSkuSource?.goodsProperties)
    ? selectedSkuSource.goodsProperties
    : (Array.isArray(data.goodsProperties) ? data.goodsProperties : []);

  if (data._fiberFound === false && data._appWall === true) {
    return {
      kind: 'empty_shell',
      signal: { type: 'empty-shell', phase: 'source-extract', reason: 'empty_shell' },
      data,
      skuSnapshot,
    };
  }

  const priceMasked = !skuSnapshot.complete && (isPriceMasked(data.price) || Boolean(data._maskHint));
  const skuMissing = decodedSkuCount === 0 && !String(data.skuText ?? '').trim();
  if (priceMasked || skuMissing) {
    const reason = priceMasked
      ? (data._maskHint ? 'app_redirect_placeholder' : 'price_masked')
      : 'sku_missing';
    return {
      kind: 'consumer_degradation',
      signal: {
        type: 'desensitized',
        phase: 'source-extract',
        reason,
        priceRaw: data.price ?? null,
        skuEmpty: skuMissing,
        dimensionCount: skuSnapshot.skuDimensions.length,
        skuCount: skuSnapshot.skus.length,
        skuIssues: skuSnapshot.issues,
        path: safePathname(pageUrl ?? data._url),
      },
      data,
      skuSnapshot,
    };
  }

  try {
    validateNormalizedSource(data, skuSnapshot);
  } catch (error) {
    return { kind: 'invalid', error, data, skuSnapshot };
  }

  return { kind: 'ok', source: data, skuSnapshot };
}

function cacheError(code, reason) {
  const error = new Error(`goods-publish source cache invalid: ${reason}`);
  error.code = code;
  return error;
}

export function normalizeCacheGoodsId(goodsId) {
  const normalized = String(goodsId ?? '').trim();
  if (!GOODS_ID_RE.test(normalized)) {
    throw cacheError('E_SOURCE_CACHE_KEY', 'goods_id must contain digits only');
  }
  return normalized;
}

function assertScalar(value, field) {
  if (value == null || value === '') return;
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw cacheError('E_SOURCE_CACHE_INVALID', `${field} must be a string or number`);
  }
}

function assertStringArray(value, field, { required = false } = {}) {
  if (!Array.isArray(value)) throw cacheError('E_SOURCE_CACHE_INVALID', `${field} must be an array`);
  if (required && value.length === 0) throw cacheError('E_SOURCE_CACHE_INVALID', `${field} must not be empty`);
  if (value.some((item) => typeof item !== 'string' || item.trim() === '')) {
    throw cacheError('E_SOURCE_CACHE_INVALID', `${field} must contain non-empty strings`);
  }
}

export function normalizeSourceForCache(goodsId, source) {
  const normalizedId = normalizeCacheGoodsId(goodsId);
  if (!asObject(source)) throw cacheError('E_SOURCE_CACHE_INVALID', 'source must be an object');

  const skuSnapshot = normalizeSourceSkuSnapshot(source);
  if (!skuSnapshot.complete) {
    throw cacheError('E_SOURCE_CACHE_INVALID', `structured SKU data is incomplete: ${skuSnapshot.issues.join(',')}`);
  }
  const skuPreviewPlan = buildSkuPreviewPlan(skuSnapshot);
  if (!skuPreviewPlan.ok) {
    throw cacheError('E_SOURCE_CACHE_INVALID', `SKU preview mapping is incomplete: ${skuPreviewPlan.issues.join(',')}`);
  }
  const goodsProperties = normalizeSourceGoodsProperties(source.goodsProperties ?? source.goodsProperty);
  if (goodsProperties.length === 0) {
    throw cacheError('E_SOURCE_CACHE_INVALID', 'structured goods properties are required');
  }

  const projected = {
    goodsID: source.goodsID == null ? normalizedId : String(source.goodsID),
    goodsName: source.goodsName,
    catID: source.catID ?? null,
    catID1: source.catID1 ?? null,
    catID2: source.catID2 ?? null,
    catID3: source.catID3 ?? null,
    price: source.price ?? null,
    sourceReferencePriceCents: skuSnapshot.sourceReferencePriceCents,
    carousel: Array.isArray(source.carousel) ? [...source.carousel] : source.carousel,
    skuText: source.skuText ?? '',
    skuDimensions: skuSnapshot.skuDimensions,
    skus: skuSnapshot.skus,
    goodsProperties,
    properties: source.properties ?? '',
    detailImgs: source.detailImgs === undefined
      ? []
      : (Array.isArray(source.detailImgs) ? [...source.detailImgs] : source.detailImgs),
  };

  if (projected.goodsID !== normalizedId) {
    throw cacheError('E_SOURCE_CACHE_INVALID', 'source goodsID does not match cache key');
  }
  if (typeof projected.goodsName !== 'string' || projected.goodsName.trim() === '') {
    throw cacheError('E_SOURCE_CACHE_INVALID', 'goodsName is required');
  }
  for (const field of ['catID', 'catID1', 'catID2', 'catID3', 'price']) {
    assertScalar(projected[field], field);
  }
  assertStringArray(projected.carousel, 'carousel', { required: true });
  assertStringArray(projected.detailImgs, 'detailImgs');
  if (typeof projected.skuText !== 'string') throw cacheError('E_SOURCE_CACHE_INVALID', 'skuText must be a string');
  if (typeof projected.properties !== 'string') throw cacheError('E_SOURCE_CACHE_INVALID', 'properties must be a string');

  try {
    validateNormalizedSource(projected, skuSnapshot);
  } catch (err) {
    const detail = err?.message ? `: ${err.message}` : '';
    const wrapped = cacheError('E_SOURCE_CACHE_INVALID', `source validation failed${detail}`);
    wrapped.cause = err;
    throw wrapped;
  }
  return projected;
}

export function serializeSourceCachePayload(goodsId, source, { cachedAt = new Date().toISOString() } = {}) {
  const normalizedId = normalizeCacheGoodsId(goodsId);
  const projected = normalizeSourceForCache(normalizedId, source);
  return `${JSON.stringify({
    version: SOURCE_CACHE_VERSION,
    goods_id: normalizedId,
    cached_at: cachedAt,
    source: projected,
  }, null, 2)}\n`;
}

export function parseSourceCachePayload(goodsId, raw) {
  const normalizedId = normalizeCacheGoodsId(goodsId);
  let payload;
  try {
    payload = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    throw cacheError('E_SOURCE_CACHE_INVALID', 'file is not valid JSON');
  }
  if (payload?.version !== SOURCE_CACHE_VERSION || String(payload?.goods_id ?? '') !== normalizedId) {
    throw cacheError('E_SOURCE_CACHE_INVALID', 'version or goods_id mismatch');
  }
  return normalizeSourceForCache(normalizedId, payload.source);
}
