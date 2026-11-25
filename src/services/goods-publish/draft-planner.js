import { PddCliError, ExitCodes } from '../../infra/errors.js';
import { parseYuanToFen } from '../../infra/units.js';
import {
  checkDiscountRateValue,
  validateFullCountDiscountRate,
  fullCountDiscountPayloadValue,
} from '../../adapter/goods-publish/draft-contract.js';
import {
  normalizeTemplateText,
  normalizeTemplatePropertyName,
  normalizeGoodsPropertyTemplate,
  mergeDynamicPropertyTemplate,
} from '../../adapter/goods-publish/property-template.js';
import {
  buildSkuPreviewPlan,
  normalizeSourceGoodsProperties,
} from './source-normalizer.js';

const MAX_DYNAMIC_PROPERTY_ROUNDS = 5;
const PROPERTY_NAME_ALIASES = new Map([
  ['面料/材质', ['面料俗称', '材质']],
]);

const PRICING_DEFAULTS = Object.freeze({
  maxSkuRatio: 5,
  maxGroupSourceRatio: 3.0,
});

function parsePositiveIntegerCents(explicitValue, yuanCandidates) {
  if (explicitValue != null) {
    if (typeof explicitValue === 'string' && !/^\d+$/.test(explicitValue.trim())) return null;
    const cents = Number(explicitValue);
    return Number.isSafeInteger(cents) && cents > 0 ? cents : null;
  }
  const yuan = yuanCandidates.find((value) => value != null);
  const cents = parseYuanToFen(yuan);
  return cents != null && cents > 0 ? cents : null;
}

function parseNonNegativeStock(value) {
  if (value == null) return null;
  if (typeof value === 'string' && !/^\d+$/.test(value.trim())) return null;
  const stock = Number(value);
  return Number.isSafeInteger(stock) && stock >= 0 ? stock : null;
}

function buildSingleSkuPricing(sku, warnings) {
  const sourcePriceCents = parsePositiveIntegerCents(
    sku?.sourcePriceCents,
    [sku?.groupPrice, sku?.group_price],
  );
  const sourceNormalPriceCents = parsePositiveIntegerCents(
    sku?.sourceNormalPriceCents,
    [sku?.normalPrice, sku?.normal_price],
  );
  const stock = parseNonNegativeStock(sku?.stock ?? sku?.quantity ?? sku?.inventory);
  if (sourcePriceCents == null) warnings.push('source_price_invalid');
  if (sourceNormalPriceCents == null) warnings.push('source_normal_price_invalid');
  if (stock == null) warnings.push('source_stock_missing');
  return {
    sourceSkuId: sku?.sourceSkuId ?? sku?.skuID ?? sku?.skuId ?? '',
    specValues: sku?.specValues,
    sourcePriceCents: sourcePriceCents ?? 0,
    groupPrice: ((sourcePriceCents ?? 0) / 100).toFixed(2),
    singlePrice: ((sourceNormalPriceCents ?? 0) / 100).toFixed(2),
    stock,
  };
}

export function buildPricingPlan(source) {
  const warnings = [];
  const sourceSkus = Array.isArray(source?.skus) ? source.skus : [];
  const referenceCents = parsePositiveIntegerCents(
    source?.sourceReferencePriceCents,
    [source?.linePrice, source?.line_price],
  );
  if (referenceCents == null) warnings.push('source_reference_price_invalid');

  if (sourceSkus.length === 0) {
    warnings.push('source_skus_missing');
    return {
      sourcePrice: 0,
      groupPrice: '0.00',
      singlePrice: '0.00',
      marketPrice: '0.00',
      skuPrices: [],
      skuPricing: [],
      warnings: [...new Set(warnings)],
    };
  }

  const skuPricing = sourceSkus.map((sku) => buildSingleSkuPricing(sku, warnings));
  const first = skuPricing[0];
  return {
    sourcePrice: first.sourcePriceCents / 100,
    groupPrice: first.groupPrice,
    singlePrice: first.singlePrice,
    marketPrice: referenceCents != null ? (referenceCents / 100).toFixed(2) : '0.00',
    skuPrices: skuPricing.map((sku) => sku.groupPrice),
    skuPricing,
    warnings: [...new Set(warnings)],
  };
}

function validateSkuPricingList(skuPricing, errors) {
  if (!Array.isArray(skuPricing)) return;
  if (skuPricing.length === 0) {
    errors.push('source SKU pricing missing');
    return;
  }
  const combinations = new Set();
  for (const sku of skuPricing) {
    const skuLabel = sku?.sourceSkuId || 'unknown';
    const skuGroup = Number.parseFloat(sku?.groupPrice);
    const skuSingle = Number.parseFloat(sku?.singlePrice);
    if (!sku?.sourceSkuId) errors.push('source SKU id missing');
    if (!Number.isFinite(skuGroup) || !Number.isFinite(skuSingle) || skuGroup <= 0 || skuSingle <= 0) {
      errors.push(`SKU price invalid (${skuLabel})`);
    } else if (skuGroup > skuSingle) {
      errors.push(`SKU groupPrice > singlePrice (${skuLabel})`);
    }
    if (!Number.isSafeInteger(sku?.stock) || sku.stock < 0) {
      errors.push(`SKU stock missing (${skuLabel})`);
    }
    const specEntries = Object.entries(sku?.specValues ?? {})
      .map(([name, value]) => [String(name).trim(), String(value).trim()])
      .filter(([name, value]) => name && value)
      .sort(([left], [right]) => left.localeCompare(right));
    if (skuPricing.length > 1 && specEntries.length === 0) {
      errors.push(`SKU specification missing (${skuLabel})`);
    } else if (specEntries.length > 0) {
      const key = specEntries.map(([name, value]) => `${name}=${value}`).join('|');
      if (combinations.has(key)) errors.push(`SKU specification duplicate (${skuLabel})`);
      combinations.add(key);
    }
  }
}

function maxSinglePriceCentsOf(single, skuPricing) {
  const candidates = [Number.isFinite(single) ? Math.round(single * 100) : 0];
  if (Array.isArray(skuPricing)) {
    for (const sku of skuPricing) {
      const fen = parseYuanToFen(sku?.singlePrice);
      if (fen != null) candidates.push(fen);
      else {
        const parsed = Number.parseFloat(sku?.singlePrice);
        if (Number.isFinite(parsed)) candidates.push(Math.round(parsed * 100));
      }
    }
  }
  return Math.max(0, ...candidates);
}

function appendPricingWarnings(plan, group, constraints, warnings) {
  const maxRatio = constraints.maxSkuRatio ?? PRICING_DEFAULTS.maxSkuRatio;
  if (Array.isArray(plan.skuPrices) && plan.skuPrices.length > 1) {
    const prices = plan.skuPrices
      .map((price) => Number.parseFloat(price))
      .filter((price) => Number.isFinite(price) && price > 0);
    if (prices.length > 1) {
      const ratio = Math.max(...prices) / Math.min(...prices);
      if (ratio > maxRatio) warnings.push(`SKU price ratio ${ratio.toFixed(1)} exceeds limit ${maxRatio}`);
    }
  }
  const maxGroupRatio = constraints.maxGroupSourceRatio ?? PRICING_DEFAULTS.maxGroupSourceRatio;
  if (plan.sourcePrice > 0 && group > 0) {
    const ratio = group / plan.sourcePrice;
    if (ratio > maxGroupRatio) {
      warnings.push(`group/source ratio ${ratio.toFixed(2)} exceeds max ${maxGroupRatio}`);
    }
  }
}

export function validatePricingPlan(plan, constraints = {}) {
  if (!plan || typeof plan !== 'object') {
    return { ok: false, errors: ['pricing plan missing'], warnings: [] };
  }
  const errors = [];
  const warnings = [];
  const group = Number.parseFloat(plan.groupPrice);
  const single = Number.parseFloat(plan.singlePrice);
  const market = Number.parseFloat(plan.marketPrice);
  if (!Number.isFinite(group)) errors.push(`groupPrice (${plan.groupPrice}) is not a number`);
  if (!Number.isFinite(single)) errors.push(`singlePrice (${plan.singlePrice}) is not a number`);
  if (!Number.isFinite(market)) errors.push(`marketPrice (${plan.marketPrice}) is not a number`);

  validateSkuPricingList(plan.skuPricing, errors);
  if (Number.isFinite(group) && Number.isFinite(single) && group > single) {
    errors.push(`groupPrice (${plan.groupPrice}) > singlePrice (${plan.singlePrice})`);
  }

  const maxSingleCents = maxSinglePriceCentsOf(single, plan.skuPricing);
  const marketCents = parseYuanToFen(plan.marketPrice) ?? (Number.isFinite(market) ? Math.round(market * 100) : null);
  if (!Number.isFinite(market) || market <= 0 || marketCents == null || marketCents <= 0) {
    errors.push(`marketPrice (${plan.marketPrice}) must be positive`);
  } else if (marketCents <= maxSingleCents) {
    errors.push(`marketPrice (${plan.marketPrice}) must be greater than max singlePrice (${(maxSingleCents / 100).toFixed(2)})`);
  }

  const discountRate = constraints.twoPiecesDiscount ?? constraints.fullCountDiscountRate ?? plan.twoPiecesDiscount;
  if (discountRate !== undefined && !checkDiscountRateValue(discountRate)) {
    errors.push('twoPiecesDiscount must be between 0.50 and 0.99 in 0.01 increments');
  }

  appendPricingWarnings(plan, group, constraints, warnings);
  return { ok: errors.length === 0, errors, warnings };
}

function sourceEvidenceError(issues, detail = {}) {
  return new PddCliError({
    code: 'E_BUSINESS',
    message: '源商品属性或 SKU 颜色预览图证据不完整',
    hint: '已在创建商家草稿前停止；不会从详情文本、SKU 顺序或相近名称猜测',
    detail: { issues, ...detail },
    exitCode: ExitCodes.BUSINESS,
  });
}

export function planPreDraftPublish(source, { fullCountDiscountRate, pricingConstraints } = {}) {
  const fullCountDiscount = fullCountDiscountRate !== undefined
    ? validateFullCountDiscountRate(fullCountDiscountRate)
    : null;

  const goodsProperties = normalizeSourceGoodsProperties(
    source?.goodsProperties ?? source?.goodsProperty,
  );
  const preview = buildSkuPreviewPlan({
    skuDimensions: source?.skuDimensions,
    skus: source?.skus,
  });
  const evidenceIssues = [];
  if (goodsProperties.length === 0) evidenceIssues.push('source_properties_missing');
  evidenceIssues.push(...preview.issues);
  if (evidenceIssues.length > 0) {
    throw sourceEvidenceError([...new Set(evidenceIssues)], {
      property_count: goodsProperties.length,
      preview_color_count: preview.plan.length,
    });
  }

  const normalizedSource = { ...source, goodsProperties };
  const pricingPlan = buildPricingPlan(normalizedSource);
  const pricingValidation = validatePricingPlan(pricingPlan, {
    ...pricingConstraints,
    ...(fullCountDiscount ? { twoPiecesDiscount: fullCountDiscount.rate } : {}),
  });
  if (!pricingValidation.ok) {
    throw new PddCliError({
      code: 'E_BUSINESS',
      message: `定价验证失败: ${pricingValidation.errors.join('; ')}`,
      hint: '已在创建商家草稿前停止；请检查源商品价格、参考价与 SKU 库存规格',
      detail: {
        issues: ['pricing_plan_invalid'],
        errors: pricingValidation.errors,
      },
      exitCode: ExitCodes.BUSINESS,
    });
  }

  return {
    source: normalizedSource,
    skuPreviewPlan: preview.plan,
    pricingPlan,
    pricingValidation,
    fullCountDiscount,
  };
}

function normalizeSourceValue(value) {
  const normalized = normalizeTemplateText(value);
  // 仅处理源站偶发的 “棉/棉” 重复写法；无斜杠或各段不一致时保留原样。
  if (!normalized.includes('/')) return normalized;
  const parts = normalized.split('/').map(normalizeTemplateText).filter(Boolean);
  if (parts.length > 1 && new Set(parts).size === 1) return parts[0];
  return normalized;
}

function propertyCandidates(sourceProperty, templateProperties) {
  const sourceName = normalizeTemplatePropertyName(sourceProperty.name);
  const aliasTargets = PROPERTY_NAME_ALIASES.get(sourceName);
  const candidates = [];
  if (sourceProperty.refPid) {
    const byRefPid = templateProperties.filter((item) => item.refPid === sourceProperty.refPid);
    if (byRefPid.length > 1) return null;
    if (byRefPid.length === 1) candidates.push(byRefPid[0]);
    if (byRefPid.length === 1 && !aliasTargets) return candidates;
  }
  const targetNames = aliasTargets ?? [sourceName];
  for (const targetName of targetNames) {
    const matches = templateProperties.filter(
      (item) => normalizeTemplatePropertyName(item.name) === targetName,
    );
    if (matches.length > 1) return null;
    if (matches.length === 1) candidates.push(matches[0]);
  }
  return [...new Map(candidates.map((item) => [String(item.templatePid), item])).values()];
}

function matchPropertyValues(sourceProperty, templateProperty) {
  const selected = [];
  if (templateProperty.controlType === 0 && templateProperty.values.length === 0) {
    for (const rawValue of sourceProperty.values) {
      const text = normalizeSourceValue(rawValue);
      if (text) selected.push({ vid: null, value: text });
    }
    const uniqueFree = [...new Map(selected.map((item) => [item.value, item])).values()];
    return uniqueFree.length > 0 && uniqueFree.length <= templateProperty.chooseMaxNum
      ? uniqueFree
      : null;
  }

  for (const rawValue of sourceProperty.values) {
    const expected = normalizeSourceValue(rawValue);
    const matches = templateProperty.values.filter(
      (candidate) => normalizeTemplateText(candidate.value) === expected,
    );
    if (matches.length !== 1) return null;
    selected.push(matches[0]);
  }
  const unique = [...new Map(selected.map((item) => [String(item.vid), item])).values()];
  if (unique.length === 0 || unique.length > templateProperty.chooseMaxNum) return null;
  return unique;
}

function criticalPropertyIssue(property) {
  if (property.required) return 'required_property_unmapped';
  if (property.important) return 'important_property_unmapped';
  return null;
}

function toPlannedProperty(templateProperty, sourceProperty, values) {
  return {
    templateModuleId: templateProperty.templateModuleId,
    templatePid: templateProperty.templatePid,
    pid: templateProperty.pid,
    refPid: templateProperty.refPid,
    name: templateProperty.name,
    sourceName: sourceProperty.name,
    required: templateProperty.required,
    important: templateProperty.important,
    controlType: templateProperty.controlType,
    valueType: templateProperty.valueType,
    chooseMaxNum: templateProperty.chooseMaxNum,
    values,
  };
}

export function buildInitialPropertyPlan(rawSourceProperties, rawTemplate) {
  const template = rawTemplate?.ok === true && Array.isArray(rawTemplate?.properties)
    ? rawTemplate
    : normalizeGoodsPropertyTemplate(rawTemplate);
  if (!template.ok) {
    return { ok: false, issues: ['property_template_invalid'], warnings: [], plan: [], skippedCount: 0 };
  }

  const sourceProperties = normalizeSourceGoodsProperties(rawSourceProperties);
  const issues = new Set();
  const matchedTemplatePids = new Set();
  const plan = [];
  let skippedCount = 0;

  if (sourceProperties.length === 0) issues.add('source_properties_missing');
  for (const sourceProperty of sourceProperties) {
    const candidates = propertyCandidates(sourceProperty, template.properties);
    if (!candidates || candidates.length === 0) {
      skippedCount += 1;
      continue;
    }
    for (const templateProperty of candidates) {
      matchedTemplatePids.add(String(templateProperty.templatePid));
      const values = matchPropertyValues(sourceProperty, templateProperty);
      if (!values) {
        const issue = criticalPropertyIssue(templateProperty);
        if (issue) issues.add(issue);
        else skippedCount += 1;
        continue;
      }
      plan.push(toPlannedProperty(templateProperty, sourceProperty, values));
    }
  }

  for (const templateProperty of template.properties) {
    if (matchedTemplatePids.has(String(templateProperty.templatePid))) continue;
    const issue = criticalPropertyIssue(templateProperty);
    if (issue) issues.add(issue);
  }
  const warnings = skippedCount > 0 ? ['property_mapping_partial'] : [];
  return {
    ok: issues.size === 0,
    issues: [...issues],
    warnings,
    plan: issues.size === 0 ? plan : [],
    skippedCount,
    propertysTid: template.propertysTid,
  };
}

export function propertyMappingError(mapping) {
  return new PddCliError({
    code: 'E_BUSINESS',
    message: '商品属性无法与商家后台模板安全匹配',
    hint: '平台必填或重要属性缺失，或属性模板结构已变化；不会自动选择相近候选',
    detail: {
      issues: mapping.issues,
      mapped_property_count: mapping.plan?.length ?? 0,
      skipped_property_count: mapping.skippedCount ?? 0,
    },
    exitCode: ExitCodes.BUSINESS,
  });
}

export function reconcileDynamicTemplate({
  sourceProperties,
  baseTemplate,
  mappedTemplatePids,
  candidateTemplate,
  candidateDefinitions,
  visibleLabels = null,
}) {
  const mergedTemplate = candidateDefinitions !== undefined
    ? mergeDynamicPropertyTemplate(baseTemplate, candidateDefinitions, visibleLabels)
    : candidateTemplate;

  if (mergedTemplate?.ok !== true) {
    return {
      ok: false,
      converged: false,
      issues: mergedTemplate?.issues ?? ['dynamic_property_template_invalid'],
      template: baseTemplate,
      propertyPlan: null,
      addedPlan: [],
      nextMappedTemplatePids: mappedTemplatePids,
    };
  }

  const nextPlan = buildInitialPropertyPlan(sourceProperties, mergedTemplate);
  if (!nextPlan.ok) {
    return {
      ok: false,
      converged: false,
      issues: nextPlan.issues,
      template: mergedTemplate,
      propertyPlan: nextPlan,
      addedPlan: [],
      nextMappedTemplatePids: mappedTemplatePids,
    };
  }

  const known = mappedTemplatePids instanceof Set
    ? mappedTemplatePids
    : new Set((mappedTemplatePids ?? []).map(String));
  const addedPlan = nextPlan.plan.filter((property) => !known.has(String(property.templatePid)));
  const nextMappedTemplatePids = new Set(known);
  for (const property of addedPlan) {
    nextMappedTemplatePids.add(String(property.templatePid));
  }

  return {
    ok: true,
    converged: addedPlan.length === 0,
    issues: [],
    template: mergedTemplate,
    propertyPlan: nextPlan,
    addedPlan,
    nextMappedTemplatePids,
  };
}

export async function convergeDynamicProperties({
  sourceProperties,
  initialTemplate,
  initialPlan,
  readDynamicTemplate,
  fillDependentProperties,
  maxRounds = MAX_DYNAMIC_PROPERTY_ROUNDS,
}) {
  let currentTemplate = initialTemplate;
  let currentPlan = initialPlan;
  let mappedTemplatePids = new Set(
    (initialPlan?.plan ?? []).map((property) => String(property.templatePid)),
  );

  for (let round = 0; round < maxRounds; round += 1) {
    const candidateTemplate = await readDynamicTemplate(currentTemplate);
    const step = reconcileDynamicTemplate({
      sourceProperties,
      baseTemplate: currentTemplate,
      mappedTemplatePids,
      candidateTemplate,
    });
    if (!step.ok) {
      throw propertyMappingError({
        issues: step.issues,
        plan: currentPlan.plan,
        skippedCount: currentPlan.skippedCount,
      });
    }
    currentTemplate = step.template;
    currentPlan = step.propertyPlan;
    mappedTemplatePids = step.nextMappedTemplatePids;
    if (step.converged) {
      return { template: currentTemplate, propertyPlan: currentPlan };
    }
    await fillDependentProperties(step.addedPlan);
  }

  throw propertyMappingError({
    issues: ['dynamic_property_template_unstable'],
    plan: currentPlan.plan,
    skippedCount: currentPlan.skippedCount,
  });
}

export {
  normalizeGoodsPropertyTemplate,
  mergeDynamicPropertyTemplate,
  validateFullCountDiscountRate,
  fullCountDiscountPayloadValue,
};
