import { readBusinessError } from '../run-endpoint.js';
import { ExitCodes, responseShapeError } from '../../infra/errors.js';

function project(item, fields) {
  return Object.fromEntries(fields.filter((field) => Object.hasOwn(item, field))
    .map((field) => [field, item[field]]));
}

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
    ...project(item, ['goodsId', 'createTime', 'descScore', 'logisticsScore', 'serviceScore', 'score', 'comment']),
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
    name: `reviews.${name}`, fixtureIsServiceFacing: true, strategy: 'page-api',
    nav: { url: 'https://mms.pinduoduo.com/goods/evaluation/index' },
    apiUrl: `/saturn/reviews/${suffix}`,
    buildPayload: ({ startTime, endTime, rangeType }) => ({ startTime, endTime, rangeType }),
    isSuccess: (raw) => raw?.success === true || raw?.errorCode === 1000000,
    errorMapper(raw) {
      const error = readBusinessError(raw);
      return error ? { code: 'E_BUSINESS', message: error.message, exitCode: ExitCodes.BUSINESS } : null;
    },
    normalize,
  };
}

export const REVIEWS_KEYWORD_AGG = endpoint('keywordAgg', 'keywords/agg', (raw) =>
  Object.fromEntries(['positiveKeywordList', 'negativeKeywordList'].map((key) =>
    [key, collection(raw?.result, key, 'reviews.keywordAgg').map((item) => project(item, ['keywordName', 'num']))])));

export const REVIEWS_TYPE_AGG = endpoint('typeAgg', 'type/agg', (raw) => ({
  typeList: collection(raw?.result, 'typeList', 'reviews.typeAgg')
    .map((item) => project(item, ['typeName', 'positive', 'negative', 'proportion'])),
}));

export const REVIEWS_LIST = {
  ...endpoint('list', 'list', (raw) => {
    const total = raw?.result?.totalRows;
    if (total == null || !Number.isFinite(Number(total)) || Number(total) < 0) {
      throw responseShapeError('reviews.list', 'result.totalRows');
    }
    return { totalRows: Number(total), data: collection(raw.result, 'data', 'reviews.list').map(review) };
  }),
  fixtureListKey: 'data',
  buildPayload: ({ startTime, endTime, pageNo = 1 }) =>
    ({ startTime, endTime, pageNo, pageSize: 10, descScore: ['1', '2', '3'] }),
};
