import { PddCliError, ExitCodes } from '../../infra/errors.js';
import { parseYuanToFen } from '../../infra/units.js';
import { fullCountDiscountPayloadValue } from './draft-planner.js';

const DRAFT_DETAIL_SUCCESS_CODES = new Set(['0', '1000000']);

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function valueType(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function normalizeSkuSpecValue(value) {
  const normalized = String(value ?? '').trim().toLowerCase().replace(/\s+/g, '');
  return /^\d+(?:\.\d+)?(?:cm|厘米)$/.test(normalized)
    ? normalized.replace(/(?:cm|厘米)$/, '')
    : normalized;
}

function normalizePropertyText(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/[‐‑‒–—―]/g, '-')
    .replace(/\s+/g, '')
    .replace(/^重要/, '')
    .trim();
}

function readSpecText(spec) {
  if (typeof spec === 'string') return spec;
  if (Array.isArray(spec)) return spec.map(readSpecText).join('|');
  if (spec && typeof spec === 'object') return Object.values(spec).map(readSpecText).join('|');
  return String(spec ?? '');
}

function toPriceCents(price) {
  const fen = parseYuanToFen(price);
  if (fen != null) return fen > 0 ? fen : null;
  const value = Number(price);
  return Number.isFinite(value) && value > 0 ? Math.round(value * 100) : null;
}

function matchExpectedSku(rawSkus, expectedSku, usedIndexes) {
  const expectedValues = Object.values(expectedSku.specValues ?? {})
    .map(normalizeSkuSpecValue)
    .filter(Boolean);
  for (let index = 0; index < rawSkus.length; index += 1) {
    if (usedIndexes.has(index)) continue;
    const tokens = readSpecText(rawSkus[index]?.spec)
      .split(/[|,，;/\s]+/)
      .map(normalizeSkuSpecValue)
      .filter(Boolean);
    if (expectedValues.every((value) => tokens.includes(value))) return index;
  }
  return -1;
}

function scalarValues(value) {
  if (Array.isArray(value)) return value.flatMap(scalarValues);
  if (value && typeof value === 'object') return Object.values(value).flatMap(scalarValues);
  if (value == null) return [];
  return [String(value)];
}

function rawPropertyMatches(rawProperty, expectedProperty, expectedValue) {
  const idsMatch = String(rawProperty?.template_pid ?? '') === String(expectedProperty.templatePid)
    && String(rawProperty?.template_module_id ?? '') === String(expectedProperty.templateModuleId)
    && String(rawProperty?.pid ?? '') === String(expectedProperty.pid);
  if (!idsMatch) return false;
  const vids = scalarValues(rawProperty?.vid);
  if (expectedProperty.controlType === 1) {
    return vids.includes(String(expectedValue.vid));
  }
  const values = scalarValues(rawProperty?.value).map(normalizePropertyText).filter(Boolean);
  const valueMatches = values.includes(normalizePropertyText(expectedValue.value));
  if (expectedValue.vid != null) {
    return vids.includes(String(expectedValue.vid)) && valueMatches;
  }
  return valueMatches;
}

function expectedSkuColor(expectedSku) {
  const entries = Object.entries(expectedSku?.specValues ?? {})
    .filter(([name]) => /颜色|花色/.test(name));
  return entries.length === 1 ? normalizeSkuSpecValue(entries[0][1]) : '';
}

function validateHeaderAndPricingFields(payload, skus, options, issues) {
  const gallery = Array.isArray(payload?.gallery) ? payload.gallery : [];
  if (!String(payload?.goods_name ?? '').trim()) issues.add('title_empty');
  if (gallery.length === 0) issues.add('no_images');

  const templateId = payload?.cost_template_id ?? payload?.costTemplateId;
  if (!templateId) issues.add('no_cost_template');
  else if (options.expectedCostTemplateId != null && String(templateId) !== String(options.expectedCostTemplateId)) {
    issues.add('cost_template_mismatch');
  }

  if (options.expectedFullCountDiscountRate != null) {
    const expectedDiscount = fullCountDiscountPayloadValue(options.expectedFullCountDiscountRate);
    const actualDiscount = payload?.two_pieces_discount;
    if (actualDiscount == null || actualDiscount === '') issues.add('full_count_discount_missing');
    else if (Number(actualDiscount) !== expectedDiscount) issues.add('full_count_discount_mismatch');
  }

  if (skus.length === 0) issues.add('no_skus');
  for (const sku of skus) {
    if (!(Number(sku?.multi_price) > 0)) issues.add('sku_group_price_invalid');
    if (!(Number(sku?.price) > 0)) issues.add('sku_single_price_invalid');
    const stock = sku?.quantity_delta ?? sku?.quantity;
    if (!Number.isSafeInteger(Number(stock)) || Number(stock) < 0) issues.add('sku_stock_missing');
  }
  return gallery;
}

function validateExpectedProperties(goodsProperties, expectedProperties, issues) {
  let expectedCount = 0;
  let matchedCount = 0;
  let enumeratedCount = 0;
  if (!expectedProperties) {
    return { expectedCount, matchedCount, enumeratedCount };
  }
  if (goodsProperties.length === 0 && expectedProperties.length > 0) {
    issues.add('goods_properties_missing');
  }
  for (const property of expectedProperties) {
    for (const value of property.values ?? []) {
      expectedCount += 1;
      if (property.controlType === 1) enumeratedCount += 1;
      if (goodsProperties.some((rawProperty) => rawPropertyMatches(rawProperty, property, value))) {
        matchedCount += 1;
      } else {
        issues.add('goods_property_mismatch');
      }
    }
  }
  return { expectedCount, matchedCount, enumeratedCount };
}

function validateExpectedSkus(skus, expectedSkus, expectedSkuPreviewPlan, issues) {
  const expectedPreview = Array.isArray(expectedSkuPreviewPlan)
    ? new Map(expectedSkuPreviewPlan.map((item) => [
        normalizeSkuSpecValue(item.merchantColor),
        String(item.uploadedImageUrl ?? '').trim(),
      ]))
    : null;
  if (!expectedSkus) {
    if (expectedPreview) issues.add('sku_thumb_url_mismatch');
    return;
  }
  if (expectedSkus.length !== skus.length) issues.add('sku_combination_count_mismatch');
  const usedIndexes = new Set();
  for (const expectedSku of expectedSkus) {
    const index = matchExpectedSku(skus, expectedSku, usedIndexes);
    if (index < 0) {
      issues.add('sku_combination_mismatch');
      continue;
    }
    usedIndexes.add(index);
    const rawSku = skus[index];
    if (Number(rawSku.multi_price) !== toPriceCents(expectedSku.groupPrice)) issues.add('sku_group_price_mismatch');
    if (Number(rawSku.price) !== toPriceCents(expectedSku.singlePrice)) issues.add('sku_single_price_mismatch');
    const stock = Number(rawSku.quantity_delta ?? rawSku.quantity);
    if (stock !== expectedSku.stock) issues.add('sku_stock_mismatch');
    if (expectedPreview) {
      const expectedThumb = expectedPreview.get(expectedSkuColor(expectedSku)) ?? '';
      const actualThumb = String(rawSku.thumb_url ?? '').trim();
      if (!actualThumb) issues.add('sku_thumb_url_missing');
      else if (!expectedThumb || actualThumb !== expectedThumb) issues.add('sku_thumb_url_mismatch');
    }
  }
}

export function validateDraftEditPayload(body, options = {}) {
  const issues = new Set();
  const payload = typeof body === 'string' ? JSON.parse(body) : body;
  const goodsProperties = Array.isArray(payload?.goods_properties) ? payload.goods_properties : [];
  const skus = Array.isArray(payload?.skus) ? payload.skus : [];
  const gallery = validateHeaderAndPricingFields(payload, skus, options, issues);

  const expectedProperties = Array.isArray(options.expectedPropertyPlan) ? options.expectedPropertyPlan : null;
  const propSummary = validateExpectedProperties(goodsProperties, expectedProperties, issues);

  const expectedSkus = Array.isArray(options.expectedSkuPricing) ? options.expectedSkuPricing : null;
  validateExpectedSkus(skus, expectedSkus, options.expectedSkuPreviewPlan, issues);

  return {
    ok: issues.size === 0,
    issues: [...issues],
    summary: {
      gallery_count: gallery.length,
      goods_property_count: goodsProperties.length,
      goods_property_expected_value_count: propSummary.expectedCount,
      goods_property_expected_enumerated_value_count: propSummary.enumeratedCount,
      goods_property_matched_value_count: propSummary.matchedCount,
      sku_count: skus.length,
      sku_thumb_count: skus.filter((sku) => String(sku?.thumb_url ?? '').trim()).length,
    },
  };
}

function costTemplateBodyError(message) {
  return new PddCliError({
    code: 'E_BUSINESS',
    message,
    hint: '确认草稿保存请求仍为 JSON 格式，并包含可注入的编辑 payload',
    exitCode: ExitCodes.BUSINESS,
  });
}

function parseOutgoingBody(postData) {
  if (postData == null || postData === '') {
    throw costTemplateBodyError('保存草稿请求体为空，无法写入运费模板');
  }
  if (typeof postData === 'object' && !Array.isArray(postData)) {
    return structuredClone(postData);
  }
  try {
    const parsed = JSON.parse(postData);
    if (!isObject(parsed)) throw new Error('not object');
    return parsed;
  } catch {
    throw costTemplateBodyError('保存草稿请求体不是 JSON，无法写入运费模板');
  }
}

export function prepareEditPayload(postData, options = {}) {
  const body = parseOutgoingBody(postData);
  const costTemplateId = options.costTemplateId;
  if (costTemplateId != null && String(costTemplateId).trim() !== '') {
    body.cost_template_id = costTemplateId;
  }
  const nextPostData = JSON.stringify(body);
  let validation = null;

  if (options.strictPayload) {
    validation = validateDraftEditPayload(body, {
      expectedCostTemplateId: options.expectedCostTemplateId ?? costTemplateId,
      expectedSkuPricing: options.expectedSkuPricing,
      expectedPropertyPlan: options.expectedPropertyPlan,
      expectedSkuPreviewPlan: options.expectedSkuPreviewPlan,
      expectedFullCountDiscountRate: options.expectedFullCountDiscountRate,
    });
    if (!validation.ok) {
      throw new PddCliError({
        code: 'E_BUSINESS',
        message: `保存草稿请求校验失败: ${validation.issues.join('; ')}`,
        hint: '页面表单状态与源商品数据不一致，已在请求发出前停止',
        detail: { issues: validation.issues, ...validation.summary },
        exitCode: ExitCodes.BUSINESS,
      });
    }
  }

  return { body, postData: nextPostData, validation };
}

function resolveDraftDetailCandidate(payload) {
  if (!isObject(payload)) return { candidate: null, path: null, resultValue: undefined };
  if (Object.hasOwn(payload, 'result')) {
    const resultValue = payload.result;
    if (!isObject(resultValue)) return { candidate: null, path: null, resultValue };
    if (isObject(resultValue.data)) return { candidate: resultValue.data, path: 'result.data', resultValue };
    return { candidate: resultValue, path: 'result', resultValue };
  }
  if (Object.hasOwn(payload, 'data')) {
    const dataValue = payload.data;
    if (!isObject(dataValue)) return { candidate: null, path: null, resultValue: dataValue };
    if (isObject(dataValue.result)) return { candidate: dataValue.result, path: 'data.result', resultValue: dataValue };
    return { candidate: dataValue, path: 'data', resultValue: dataValue };
  }
  const hasDraftField = ['goods_name', 'goodsName', 'cost_template_id', 'costTemplateId', 'gallery']
    .some((key) => Object.hasOwn(payload, key));
  return hasDraftField
    ? { candidate: payload, path: 'root', resultValue: payload }
    : { candidate: null, path: null, resultValue: undefined };
}

export function normalizeDraftDetailResponse(response) {
  const wrapped = isObject(response) && Object.hasOwn(response, 'payload');
  const payload = wrapped ? response.payload : response;
  const httpStatus = wrapped ? response.http_status ?? null : null;
  const httpOk = wrapped ? response.http_ok !== false : true;
  const errorCode = isObject(payload) ? payload.error_code ?? payload.errorCode ?? null : null;
  const successFlag = isObject(payload) && typeof payload.success === 'boolean' ? payload.success : null;
  const businessFailed = successFlag === false
    || (errorCode != null && !DRAFT_DETAIL_SUCCESS_CODES.has(String(errorCode)));
  const { candidate, path, resultValue } = resolveDraftDetailCandidate(payload);

  const observation = {
    http_status: httpStatus,
    business_success: successFlag,
    error_code: errorCode,
    result_type: valueType(resultValue),
    candidate_path: path,
    field_keys: candidate ? Object.keys(candidate).sort().slice(0, 50) : [],
    reason: null,
  };

  if (!httpOk || businessFailed || !candidate) {
    observation.reason = !httpOk
      ? 'http_failure'
      : (businessFailed ? 'business_failure' : 'result_unavailable');
    return { available: false, data: null, observation };
  }

  const data = {
    goods_name: candidate.goods_name ?? candidate.goodsName ?? '',
    cost_template_id: candidate.cost_template_id ?? candidate.costTemplateId ?? null,
    gallery: candidate.gallery ?? [],
  };
  if (Object.hasOwn(candidate, 'two_pieces_discount')) data.two_pieces_discount = candidate.two_pieces_discount;
  else if (Object.hasOwn(candidate, 'twoPiecesDiscount')) data.two_pieces_discount = candidate.twoPiecesDiscount;
  return { available: true, data, observation };
}

function collectDraftIssues(detail, expectedCostTemplateId, expectedFullCountDiscountRate) {
  const issues = [];
  if (!detail.goods_name) issues.push('title_empty');
  const actualTemplateId = detail.cost_template_id ?? detail.costTemplateId;
  if (!actualTemplateId) issues.push('no_cost_template');
  else if (expectedCostTemplateId != null && String(actualTemplateId) !== String(expectedCostTemplateId)) {
    issues.push('cost_template_mismatch');
  }
  if (expectedFullCountDiscountRate != null) {
    const expectedDiscount = fullCountDiscountPayloadValue(expectedFullCountDiscountRate);
    const hasActualDiscount = Object.hasOwn(detail, 'two_pieces_discount')
      || Object.hasOwn(detail, 'twoPiecesDiscount');
    const actualDiscount = detail.two_pieces_discount ?? detail.twoPiecesDiscount;
    if (hasActualDiscount && Number(actualDiscount) !== expectedDiscount) {
      issues.push('full_count_discount_mismatch');
    }
  }
  if (!Array.isArray(detail.gallery) || detail.gallery.length === 0) issues.push('no_images');
  return issues;
}

function assertDraftVerification(verification, goodsCommitId) {
  if (verification.ok) return;
  throw new PddCliError({
    code: 'E_BUSINESS',
    message: `草稿校验失败: ${verification.issues.join('; ')}`,
    hint: '保存草稿后关键字段缺失，已阻止继续提交发布',
    detail: { goods_commit_id: goodsCommitId ?? null, issues: verification.issues },
    exitCode: ExitCodes.BUSINESS,
  });
}

export function verifyDraftDetail(response, options = {}) {
  if (response instanceof Error || response?.transportError === true) {
    return {
      ok: true,
      issues: [],
      skipped: true,
      warnings: ['draft_verification_unavailable'],
      observation: {
        http_status: null,
        business_success: null,
        error_code: response?.code ?? null,
        result_type: 'undefined',
        candidate_path: null,
        field_keys: [],
        reason: 'transport_error',
      },
    };
  }

  const normalized = normalizeDraftDetailResponse(response);
  if (!normalized.available) {
    return {
      ok: true,
      issues: [],
      skipped: true,
      warnings: ['draft_verification_unavailable'],
      observation: normalized.observation,
    };
  }

  const issues = collectDraftIssues(
    normalized.data,
    options.expectedCostTemplateId,
    options.expectedFullCountDiscountRate,
  );
  const result = {
    ok: issues.length === 0,
    issues,
    skipped: false,
    warnings: [],
    observation: normalized.observation,
  };
  if (options.strictVerify) assertDraftVerification(result, options.goodsCommitId);
  return result;
}
