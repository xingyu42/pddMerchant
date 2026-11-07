import { evaluateInMainWorld } from '../browser.js';
import { normalizeGoodsPropertyTemplate } from '../goods-publish/property-mapper.js';
import { isSuccessfulResponse, mapWriteBusinessError, WRITE_SUCCESS_RULE } from '../response-interpreter.js';

export function mapPublishBusinessError(raw) {
  return mapWriteBusinessError(raw, { notFound: false, businessLabel: '发布业务错误' });
}

export const SAVE_DRAFT_SUCCESS_RULE = { mode: 'flag-or-code', codeField: 'error_code', codes: [1000000] };

export const GOODS_PUBLISH_CREATE_DRAFT = {
  name: 'goods.publish.create_draft',
  urlPattern: /glide\/v2\/mms\/edit\/commit\/create_new/,
  nav: {
    url: (params) =>
      `https://mms.pinduoduo.com/goods/goods_add/index?type=add&from=category&catId=${params.cat_id}`,
    readyEl: '[class*="goods-edit"], [class*="form"], [class*="commit"]',
  },
  trigger: async (page, params) => {
    await evaluateInMainWorld(page, ({ cat_id, cat_ids, cats }) => {
      return fetch('/glide/v2/mms/edit/commit/create_new', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cat_id, cat_ids, cats }),
      });
    }, { cat_id: params.cat_id, cat_ids: params.cat_ids, cats: params.cats });
  },
  requiredTrigger: true,
  normalize: (raw) => ({
    goods_commit_id: String(raw?.goods_commit_id ?? raw?.result?.goods_commit_id ?? ''),
    goods_id: raw?.goods_id ?? raw?.result?.goods_id ?? null,
    raw,
  }),
  successRule: WRITE_SUCCESS_RULE,
  errorMapper: mapPublishBusinessError,
};

export const GOODS_PUBLISH_TEMPLATE = {
  name: 'goods.publish.template',
  urlPattern: /draco-ms\/mms\/template\/mall/,
  nav: {
    url: (params) =>
      params.goods_commit_id
        ? `https://mms.pinduoduo.com/goods/goods_add/index?type=add&from=category&id=${params.goods_commit_id}&goods_id=${params.goods_id}`
        : `https://mms.pinduoduo.com/goods/goods_add/index?type=add&from=category&catId=${params.cat_id}`,
    readyEl: '[class*="goods-edit"], [class*="form"]',
  },
  trigger: async () => {
    // 页面导航到编辑页时自动加载属性模板
  },
  normalize: normalizeGoodsPropertyTemplate,
  successRule: (raw) => normalizeGoodsPropertyTemplate(raw).ok,
  errorMapper: mapPublishBusinessError,
};

export const GOODS_PUBLISH_EDIT_DRAFT = {
  name: 'goods.publish.edit_draft',
  urlPattern: /glide\/mms\/goodsCommit\/action\/edit/,
  nav: {
    url: (params) =>
      `https://mms.pinduoduo.com/goods/goods_add/index?type=add&from=category&id=${params.goods_commit_id}&goods_id=${params.goods_id}`,
    readyEl: '[class*="goods-edit"], [class*="form"]',
  },
  trigger: async (page, params) => {
    await page.waitForTimeout(2000);
    await evaluateInMainWorld(page, ({ payload }) => {
      return fetch('/glide/mms/goodsCommit/action/edit', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    }, { payload: params.payload });
  },
  requiredTrigger: true,
  normalize: (raw) => ({
    success: isSuccessfulResponse(raw, WRITE_SUCCESS_RULE),
    raw,
  }),
  successRule: WRITE_SUCCESS_RULE,
  errorMapper: mapPublishBusinessError,
};

export const GOODS_PUBLISH_SAVE_DECORATION = {
  name: 'goods.publish.save_decoration',
  urlPattern: /glide\/forward\/gorse\/.*\/decoration\/commit\/save/,
  nav: {
    url: (params) =>
      `https://mms.pinduoduo.com/goods/goods_add/index?type=add&from=category&id=${params.goods_commit_id}&goods_id=${params.goods_id}`,
    readyEl: '[class*="goods-edit"], [class*="form"]',
  },
  trigger: async (page, params) => {
    await evaluateInMainWorld(page, ({ goods_commit_id, goods_id, floor_list }) => {
      return fetch('/glide/forward/gorse/mms/goods/decoration/commit/save', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ goods_commit_id, goods_id, floor_list }),
      });
    }, {
      goods_commit_id: params.goods_commit_id,
      goods_id: params.goods_id,
      floor_list: params.floor_list,
    });
  },
  requiredTrigger: true,
  normalize: (raw) => ({
    success: isSuccessfulResponse(raw, WRITE_SUCCESS_RULE),
    raw,
  }),
  successRule: WRITE_SUCCESS_RULE,
  errorMapper: mapPublishBusinessError,
};

export const GOODS_PUBLISH_SUBMIT = {
  name: 'goods.publish.submit',
  urlPattern: /glide\/v2\/mms\/edit\/commit\/submit/,
  nav: {
    url: (params) =>
      `https://mms.pinduoduo.com/goods/goods_add/index?type=add&from=category&id=${params.goods_commit_id}&goods_id=${params.goods_id}`,
    readyEl: '[class*="goods-edit"], [class*="form"]',
  },
  trigger: async (page, params) => {
    await evaluateInMainWorld(page, ({ goods_commit_id, goods_id }) => {
      return fetch('/glide/v2/mms/edit/commit/submit', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ goods_commit_id, goods_id }),
      });
    }, {
      goods_commit_id: params.goods_commit_id,
      goods_id: params.goods_id,
    });
  },
  requiredTrigger: true,
  normalize: (raw) => ({
    success: isSuccessfulResponse(raw, WRITE_SUCCESS_RULE),
    raw,
  }),
  successRule: WRITE_SUCCESS_RULE,
  errorMapper: mapPublishBusinessError,
};

export const GOODS_PUBLISH_COST_TEMPLATE_LIST = {
  name: 'goods.publish.cost_template_list',
  urlPattern: /express_inf\/cost_template\/get_list/,
  nav: {
    url: 'https://mms.pinduoduo.com/goods/goods_add/index',
    readyEl: '[class*="goods-edit"], [class*="form"]',
  },
  trigger: async (page) => {
    await evaluateInMainWorld(page, () => {
      return fetch('/express_inf/cost_template/get_list', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
    });
  },
  requiredTrigger: true,
  normalize: (raw) => ({
    templates: raw?.cost_template_list ?? raw?.result?.cost_template_list ?? raw?.result?.list ?? [],
    raw,
  }),
  successRule: (raw) => Array.isArray(raw?.cost_template_list ?? raw?.result?.cost_template_list ?? raw?.result?.list),
  errorMapper: mapPublishBusinessError,
};
