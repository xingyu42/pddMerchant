export function mapPublishBusinessError(raw) {
  const code = raw?.error_code ?? raw?.errorCode;
  const msg = raw?.error_msg ?? raw?.errorMsg ?? '';
  if (code === 54001) return { code: 'E_RATE_LIMIT', message: msg || '操作太过频繁', exitCode: 4 };
  if (code === 1000) return { code: 'E_USAGE', message: msg || '参数错误', exitCode: 2 };
  if (code != null && code !== 0 && code !== 1000000) {
    return { code: 'E_BUSINESS', message: msg || `发布业务错误 (${code})`, exitCode: 6 };
  }
  return null;
}

function publishWriteIsSuccess(raw) {
  if (!raw || typeof raw !== 'object') return false;
  if (raw.success === true) return true;
  const code = raw.error_code ?? raw.errorCode;
  if (code === 0 || code === 1000000) return true;
  return false;
}

export const GOODS_PUBLISH_CREATE_DRAFT = {
  name: 'goods.publish.create_draft',
  urlPattern: /glide\/v2\/mms\/edit\/commit\/create_new/,
  nav: {
    url: (params) =>
      `https://mms.pinduoduo.com/goods/goods_add/index?type=add&from=category&catId=${params.cat_id}`,
    readyEl: '[class*="goods-edit"], [class*="form"], [class*="commit"]',
  },
  trigger: async (page, params) => {
    await page.evaluate(({ cat_id, cat_ids, cats }) => {
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
  isSuccess: publishWriteIsSuccess,
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
  normalize: (raw) => {
    const modules = raw?.modules ?? [];
    const propertys_tid = modules[0]?.id ?? null;
    return { modules, propertys_tid, raw };
  },
  isSuccess: (raw) => Array.isArray(raw?.modules),
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
    await page.evaluate(({ payload }) => {
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
    success: publishWriteIsSuccess(raw),
    raw,
  }),
  isSuccess: publishWriteIsSuccess,
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
    await page.evaluate(({ goods_commit_id, goods_id, floor_list }) => {
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
    success: publishWriteIsSuccess(raw),
    raw,
  }),
  isSuccess: publishWriteIsSuccess,
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
    await page.evaluate(({ goods_commit_id, goods_id }) => {
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
    success: publishWriteIsSuccess(raw),
    raw,
  }),
  isSuccess: publishWriteIsSuccess,
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
    await page.evaluate(() => {
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
  isSuccess: (raw) => Array.isArray(raw?.cost_template_list ?? raw?.result?.cost_template_list ?? raw?.result?.list),
  errorMapper: mapPublishBusinessError,
};
