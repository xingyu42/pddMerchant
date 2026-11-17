import { responseShapeError } from '../../infra/errors.js';
import { pickFields } from './_shared.js';

function collection(result, key, endpoint) {
  if (!Array.isArray(result?.[key]) || result[key].some((item) => !item || typeof item !== 'object')) {
    throw responseShapeError(endpoint, `result.${key} array`);
  }
  return result[key];
}

// 真实账号实测：没有不满意标签的店铺 negativeKeywordList 为 null，按空列表读取；缺键仍按结构异常处理。
function keywordList(result, key) {
  return result?.[key] === null ? [] : collection(result, key, 'reviews.keywordAgg');
}

function reviewText(value) {
  if (typeof value === 'string') return value;
  return value?.comment ?? value?.content ?? value?.text ?? null;
}

function review(item) {
  return {
    ...pickFields(item, ['goodsId', 'createTime', 'descScore', 'logisticsScore', 'serviceScore', 'score', 'comment']),
    appendReview: reviewText(item.appendReview),
    keywords: Array.isArray(item.keywords) ? item.keywords.map((tag) =>
      typeof tag === 'string' ? tag : tag?.keywordName).filter((tag) => typeof tag === 'string') : [],
    replied: item.reply != null && (typeof item.reply === 'object'
      ? Object.keys(item.reply).length > 0 : String(item.reply).trim() !== ''),
    pictureCount: Array.isArray(item.pictures) ? item.pictures.length : 0,
  };
}

function endpoint(name, suffix, normalize) {
  return {
    name: `reviews.${name}`, strategy: 'page-api',
    nav: { url: 'https://mms.pinduoduo.com/goods/evaluation/index' },
    apiUrl: `/saturn/reviews/${suffix}`,
    buildPayload: ({ startTime, endTime, rangeType }) => ({ startTime, endTime, rangeType }),
    successRule: { mode: 'flag-or-code', codeField: 'errorCode', codes: [1000000] },
    errorMap: 'upstream',
    normalize,
  };
}

export const REVIEWS_KEYWORD_AGG = endpoint('keywordAgg', 'keywords/agg', (raw) =>
  Object.fromEntries(['positiveKeywordList', 'negativeKeywordList'].map((key) =>
    [key, keywordList(raw?.result, key).map((item) => pickFields(item, ['keywordName', 'num']))])));

export const REVIEWS_TYPE_AGG = endpoint('typeAgg', 'type/agg', (raw) => ({
  typeList: collection(raw?.result, 'typeList', 'reviews.typeAgg')
    .map((item) => pickFields(item, ['typeName', 'positive', 'negative', 'proportion'])),
}));

// 实测 pageSize 10–40 可用，49 起被拒（「仅支持查看近2000条评价」）；平台最多可查看近 2000 条。
export const REVIEWS_PAGE_SIZE = 40;
export const REVIEWS_VIEW_LIMIT = 2000;

export const REVIEWS_LIST = {
  ...endpoint('list', 'list', (raw) => {
    const total = raw?.result?.totalRows;
    if (total == null || !Number.isFinite(Number(total)) || Number(total) < 0) {
      throw responseShapeError('reviews.list', 'result.totalRows');
    }
    return { totalRows: Number(total), data: collection(raw.result, 'data', 'reviews.list').map(review) };
  }),
  fixtureListKey: 'result.data',
  // descScore 为字符串星级数组，缺省时上游返回全部星级；goodsId 缺省时为全店。
  buildPayload: ({ startTime, endTime, pageNo = 1, descScore, goodsId }) => ({ startTime, endTime, pageNo,
    pageSize: REVIEWS_PAGE_SIZE, ...(descScore ? { descScore } : {}), ...(goodsId ? { goodsId } : {}) }),
};
