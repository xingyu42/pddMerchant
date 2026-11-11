import { responseShapeError } from '../../infra/errors.js';
import { pickFields } from './_shared.js';

function collection(result, key, endpoint) {
  if (!Array.isArray(result?.[key]) || result[key].some((item) => !item || typeof item !== 'object')) {
    throw responseShapeError(endpoint, `result.${key} array`);
  }
  return result[key];
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
    [key, collection(raw?.result, key, 'reviews.keywordAgg').map((item) => pickFields(item, ['keywordName', 'num']))])));

export const REVIEWS_TYPE_AGG = endpoint('typeAgg', 'type/agg', (raw) => ({
  typeList: collection(raw?.result, 'typeList', 'reviews.typeAgg')
    .map((item) => pickFields(item, ['typeName', 'positive', 'negative', 'proportion'])),
}));

export const REVIEWS_LIST = {
  ...endpoint('list', 'list', (raw) => {
    const total = raw?.result?.totalRows;
    if (total == null || !Number.isFinite(Number(total)) || Number(total) < 0) {
      throw responseShapeError('reviews.list', 'result.totalRows');
    }
    return { totalRows: Number(total), data: collection(raw.result, 'data', 'reviews.list').map(review) };
  }),
  fixtureListKey: 'result.data',
  buildPayload: ({ startTime, endTime, pageNo = 1 }) =>
    ({ startTime, endTime, pageNo, pageSize: 10, descScore: ['1', '2', '3'] }),
};
