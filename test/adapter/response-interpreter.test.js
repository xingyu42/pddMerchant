import { it, vi } from 'vitest';
import assert from 'node:assert/strict';
import { interpretResponse, mapWriteBusinessError, readBusinessError } from '../../src/adapter/response-interpreter.js';
import { PddCliError } from '../../src/infra/errors.js';
import { TRAFFIC_READY_TIME, TRAFFIC_OVERVIEW, GOODS_TRAFFIC_LIST } from '../../src/adapter/endpoints/traffic.js';
import { CS_OVERVIEW, CS_MONTH_TREND } from '../../src/adapter/endpoints/customer-service.js';
import { NAVIGATOR_INFO, NAVIGATOR_READY_DATE, NAVIGATOR_LIST } from '../../src/adapter/endpoints/experience.js';
import { REVIEWS_LIST, REVIEWS_KEYWORD_AGG, REVIEWS_TYPE_AGG } from '../../src/adapter/endpoints/reviews.js';
import { ORDER_LIST, ORDER_DETAIL, ORDER_STATS } from '../../src/adapter/endpoints/orders.js';
import { GOODS_LIST, GOODS_AD_STRATEGY, GOODS_UPDATE_STATUS, GOODS_UPDATE_PRICE,
  GOODS_UPDATE_STOCK, GOODS_UPDATE_TITLE } from '../../src/adapter/endpoints/goods.js';
import { GOODS_PUBLISH_CREATE_DRAFT, GOODS_PUBLISH_EDIT_DRAFT, GOODS_PUBLISH_SAVE_DECORATION,
  GOODS_PUBLISH_SUBMIT, GOODS_PUBLISH_TEMPLATE, GOODS_PUBLISH_COST_TEMPLATE_LIST,
  SAVE_DRAFT_SUCCESS_RULE, mapPublishBusinessError } from '../../src/adapter/endpoints/goods-publish.js';
import { PROMO_ENTITY_REPORT, PROMO_HOURLY_REPORT } from '../../src/adapter/endpoints/promo.js';
import { GOODS_PROMOTION_LIST } from '../../src/adapter/endpoints/promo-goods.js';
import { clickSaveDraft } from '../../src/adapter/goods-publish/form-filler.js';

const GROUPS = {
  reports: [TRAFFIC_READY_TIME, TRAFFIC_OVERVIEW, GOODS_TRAFFIC_LIST, CS_OVERVIEW, CS_MONTH_TREND,
    NAVIGATOR_INFO, NAVIGATOR_READY_DATE, NAVIGATOR_LIST],
  reviews: [REVIEWS_LIST, REVIEWS_KEYWORD_AGG, REVIEWS_TYPE_AGG],
  flag: [ORDER_LIST, ORDER_STATS, GOODS_LIST, GOODS_AD_STRATEGY],
  write: [GOODS_UPDATE_STATUS, GOODS_UPDATE_PRICE, GOODS_UPDATE_STOCK, GOODS_UPDATE_TITLE,
    GOODS_PUBLISH_CREATE_DRAFT, GOODS_PUBLISH_EDIT_DRAFT, GOODS_PUBLISH_SAVE_DECORATION, GOODS_PUBLISH_SUBMIT, ORDER_DETAIL],
  draft: [{ name: 'ui.saveDraft', successRule: SAVE_DRAFT_SUCCESS_RULE }],
  result: [PROMO_ENTITY_REPORT, PROMO_HOURLY_REPORT],
  nonNullResult: [GOODS_PROMOTION_LIST],
};

const SUCCESS_ROWS = [
  ['empty', {}, []],
  ['null', null, []],
  ['flag', { success: true }, ['reviews', 'flag', 'write', 'draft']],
  ['string flag', { success: 'true' }, []],
  ['result', { result: {} }, ['result', 'nonNullResult']],
  ['null result', { result: null }, ['result']],
  ['failed result', { success: false, result: {} }, []],
  ['camel zero', { errorCode: 0 }, ['write']],
  ['snake zero', { error_code: 0 }, ['write']],
  ['camel million', { errorCode: 1000000 }, ['reviews', 'write']],
  ['snake million', { error_code: 1000000 }, ['write', 'draft']],
  ['false camel zero', { success: false, errorCode: 0 }, ['write']],
  ['false camel million', { success: false, errorCode: 1000000 }, ['reviews', 'write']],
  ['false snake million', { success: false, error_code: 1000000 }, ['write', 'draft']],
  ['true camel zero', { success: true, errorCode: 0 }, ['reports', 'reviews', 'flag', 'write', 'draft']],
  ['true camel million', { success: true, errorCode: 1000000 }, ['reports', 'reviews', 'flag', 'write', 'draft']],
  ['true snake million', { success: true, error_code: 1000000 }, ['reviews', 'flag', 'write', 'draft']],
  ['unknown with flag', { success: true, errorCode: 1 }, ['reviews', 'flag', 'write', 'draft']],
  ['risk with flag', { success: true, errorCode: 40002 }, ['reviews', 'flag', 'write', 'draft']],
  ['string zero', { errorCode: '0' }, []],
  ['string million', { error_code: '1000000' }, []],
  ['true string million', { success: true, errorCode: '1000000' }, ['reviews', 'flag', 'write', 'draft']],
  ['dual casing precedence', { success: false, error_code: 0, errorCode: 1000000 }, ['reviews', 'write']],
  ['true dual casing precedence', { success: true, error_code: 4001, errorCode: 0 },
    ['reports', 'reviews', 'flag', 'write', 'draft']],
];

function successCases([label, raw, accepted]) {
  return Object.entries(GROUPS).map(([group, specs]) => ({
    label: `${group}: ${label}`, specs, raw,
    code: accepted.includes(group) ? null : raw === null ? 'E_NETWORK' : 'E_BUSINESS',
  }));
}

const ERROR_PROFILES = [
  { specs: GROUPS.reports, business: 'E_BUSINESS', http: 'E_BUSINESS', usage: 'E_BUSINESS',
    httpUsage: 'E_BUSINESS', httpRate: 'E_BUSINESS' },
  { specs: GROUPS.reviews, business: 'E_BUSINESS', http: 'E_BUSINESS', usage: 'E_BUSINESS',
    httpUsage: 'E_BUSINESS', httpRate: 'E_BUSINESS' },
  { specs: [GOODS_UPDATE_PRICE, GOODS_PUBLISH_SUBMIT], business: 'E_BUSINESS', http: 'E_BUSINESS', usage: 'E_USAGE',
    httpUsage: 'E_USAGE', httpRate: 'E_RATE_LIMIT' },
  { specs: [ORDER_DETAIL], business: 'E_BUSINESS', http: 'E_NETWORK', usage: 'E_USAGE',
    httpUsage: 'E_USAGE', httpRate: 'E_RATE_LIMIT' },
  { specs: [ORDER_LIST], business: 'E_BUSINESS', http: 'E_NETWORK', usage: 'E_BUSINESS',
    httpUsage: 'E_NETWORK', httpRate: 'E_NETWORK' },
];

function errorCases(field, value, profile) {
  const business = value === 1000 ? profile.usage : value === 54001 ? 'E_RATE_LIMIT' : profile.business;
  const http = value === 1000 ? profile.httpUsage : value === 54001 ? profile.httpRate : profile.http;
  return [[200, business], [401, 'E_AUTH_EXPIRED'], [403, 'E_AUTH_EXPIRED'],
    [429, 'E_RATE_LIMIT'], [500, http]]
    .map(([status, code]) => ({
      label: `${profile.specs[0].name}: ${field}=${value}, HTTP ${status}`,
      specs: profile.specs, raw: { success: false, [field]: value }, status, code,
      classification: status === 200 ? { 40002: 'high-frequency-or-risk-control', 54001: 'business-54001' }[value] : undefined,
    }));
}

const BUSINESS_CASES = ['error_code', 'errorCode'].flatMap((field) =>
  [1000, 40002, 54001, 9876].flatMap((value) => ERROR_PROFILES.flatMap((profile) => errorCases(field, value, profile))));

const SPECIAL_CASES = [
  { label: '54001 precedes success and mapper', specs: [GOODS_PUBLISH_SUBMIT],
    raw: { success: true, error_code: 54001 }, code: 'E_RATE_LIMIT', classification: 'business-54001' },
  { label: 'nested rate limit', specs: [ORDER_LIST], raw: { success: true, result: { errorCode: '54001' } },
    code: 'E_RATE_LIMIT', classification: 'business-54001' },
  { label: 'risk-like codes retain the endpoint success override', specs: [ORDER_LIST],
    raw: { success: true, errorCode: 70031 }, code: null },
  { label: 'template shape accepts a bare template', specs: [GOODS_PUBLISH_TEMPLATE],
    raw: { id: 1, modules: [{ id: 2, propertys: [{ id: 3, pid: 4, name: '材质', values: [] }] }] }, code: null },
  { label: 'template shape rejects missing template', specs: [GOODS_PUBLISH_TEMPLATE], raw: {}, code: 'E_BUSINESS' },
  { label: 'cost template top-level array', specs: [GOODS_PUBLISH_COST_TEMPLATE_LIST], raw: { cost_template_list: [] }, code: null },
  { label: 'cost template nested array', specs: [GOODS_PUBLISH_COST_TEMPLATE_LIST], raw: { result: { list: [] } }, code: null },
  { label: 'cost template rejects a success flag alone', specs: [GOODS_PUBLISH_COST_TEMPLATE_LIST],
    raw: { success: true }, code: 'E_BUSINESS' },
  { label: 'default returns raw when no normalizer', specs: [{ name: 'default' }],
    raw: { success: true, errorCode: 0 }, code: null, noNormalize: true },
  { label: 'upstream business message and hint stay verbatim', specs: GROUPS.reports,
    raw: { errorCode: 9876, errorMsg: '请求失败' }, code: 'E_BUSINESS', message: '请求失败', hint: '请求失败' },
  { label: 'default business message keeps the endpoint prefix', specs: [ORDER_LIST],
    raw: { error_code: 9876, error_msg: '请求失败' }, code: 'E_BUSINESS',
    message: 'orders.list: 请求失败', hint: '请求失败' },
];

const EXIT_CODES = { E_NETWORK: 5, E_AUTH_EXPIRED: 3, E_RATE_LIMIT: 4, E_BUSINESS: 6, E_USAGE: 2 };

function assertVerdict(spec, entry) {
  const normalize = vi.fn(() => ({ normalized: true }));
  const actualSpec = { ...spec, normalize: entry.noNormalize ? undefined : normalize };
  const context = { status: entry.status ?? 200, raw: entry.raw, retries: 3, url: '/synthetic', params: { page: 2 } };
  if (!entry.code) {
    assert.deepEqual(interpretResponse(actualSpec, context), entry.noNormalize ? { raw: entry.raw } : { normalized: true });
    if (!entry.noNormalize) assert.deepEqual(normalize.mock.calls, [[entry.raw, { page: 2 }]]);
    return;
  }
  assert.throws(() => interpretResponse(actualSpec, context), (error) => {
    assert.ok(error instanceof PddCliError, spec.name);
    assert.equal(error.code, entry.code, spec.name);
    assert.equal(error.exitCode, EXIT_CODES[entry.code], spec.name);
    if (entry.message) assert.equal(error.message, entry.message);
    if (entry.hint) assert.equal(error.hint, entry.hint);
    if (entry.classification) assert.equal(error.detail.classification, entry.classification, spec.name);
    if (entry.classification === 'high-frequency-or-risk-control') assert.match(error.hint, /请求签名异常/);
    return true;
  });
  assert.equal(normalize.mock.calls.length, 0, spec.name);
}

it.each([...SUCCESS_ROWS.flatMap(successCases), ...BUSINESS_CASES, ...SPECIAL_CASES])('$label', (entry) => {
  for (const spec of entry.specs) assertVerdict(spec, entry);
});

it.each(['error_code', 'errorCode'])('keeps direct write/publish mapper differences for %s', (field) => {
  assert.equal(mapWriteBusinessError({ [field]: 54001 }).code, 'E_RATE_LIMIT');
  assert.equal(mapPublishBusinessError({ [field]: 54001 }).code, 'E_RATE_LIMIT');
  assert.equal(mapWriteBusinessError({ [field]: 1000 }).message, '参数错误');
  assert.equal(mapPublishBusinessError({ [field]: 1000 }).message, '参数错误');
  assert.equal(mapWriteBusinessError({ [field]: 9876 }).message, '业务错误 (9876)');
  assert.equal(mapPublishBusinessError({ [field]: 9876 }).message, '发布业务错误 (9876)');
  assert.equal(mapWriteBusinessError({ [field]: 9876, error_msg: '找不到' }).code, 'E_NOT_FOUND');
  assert.equal(mapPublishBusinessError({ [field]: 9876, error_msg: '找不到' }).code, 'E_BUSINESS');
  assert.equal(mapWriteBusinessError({ [field]: 0 }), null);
  assert.equal(mapPublishBusinessError({ [field]: 1000000 }), null);
  assert.deepEqual(readBusinessError({ [field]: 40002, errorMsg: '请求失败' }), { code: '40002', message: '请求失败' });
});

it.each([
  [{ success: true }, true], [{ error_code: 1000000 }, true],
  [{ success: false, error_code: 1000000 }, true], [{ success: true, error_code: 40002 }, true],
  [{ errorCode: 1000000 }, false], [{ error_code: 0 }, false], [{ error_code: '1000000' }, false],
])('preserves the UI draft-save verdict for %j', async (raw, accepted) => {
  const page = {
    waitForSelector: async () => ({ click: async () => {} }),
    waitForResponse: async () => ({ json: async () => raw }),
  };
  const pending = clickSaveDraft(page, null);
  if (accepted) {
    const result = await pending;
    assert.deepEqual(result, { ...raw, payload_validation: null, verification: { ok: true, issues: [], skipped: true } });
    return;
  }
  await assert.rejects(pending, { code: 'E_BUSINESS', message: '保存草稿失败', exitCode: 6 });
});
