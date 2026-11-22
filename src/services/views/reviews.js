import { toLocalDateTime, toFiniteNumber, round } from '../../infra/units.js';
import { text } from './_shared.js';
import { defineReport, reportHints } from '../operating-report.js';

export const REVIEWS_REPORT = defineReport({
  days: { choices: { 30: 1, 60: 5, 90: 4, 180: 3 }, default: 30,
    message: '--days 需为 {choices_or}', description: '评价窗口天数（{range}）' },
  hints: {
    keywords_unavailable: '评价标签聚合拉取失败', types_unavailable: '评价问题类型拉取失败',
    reviews_unavailable: '中差评列表拉取失败', list_truncated: '中差评列表已达平台可查看的近 2000 条上限，结果已截断',
    goods_scores_unavailable: '商品评分拉取失败', goods_scores_truncated: '商品评分列表已达 200 个商品上限，结果已截断',
  },
});

export const GOODS_REVIEWS_REPORT = defineReport({
  days: { min: 1, max: 365, default: 30, separator: '–', message: '--days 需为 {range} 的整数',
    description: '评价窗口天数（{range}，默认 {default}）' },
  hints: { list_truncated: '评价列表已达平台可查看的近 2000 条上限，结果已截断' },
});

export const REVIEW_TAG_FIELDS = Object.freeze(['name', 'count']);
export const ISSUE_TYPE_FIELDS = Object.freeze(['name', 'positive_count', 'negative_count', 'share_pct']);
export const REVIEW_FIELDS = Object.freeze(['goods_id', 'reviewed_at', 'desc_score',
  'logistics_score', 'service_score', 'history_score', 'comment', 'append_comment', 'tags', 'replied', 'picture_count']);
export const GOODS_REVIEWS_FILTER_FIELDS = Object.freeze(['mode', 'min_length']);
export const DEFAULT_GOODS_REVIEWS_FILTER = Object.freeze({ mode: 'substantive', min_length: 1 });

// 商品评分取自数据中心「近30日存在有效评价的商品」，窗口由平台固定，与 --days 无关。
const GOODS_SCORES_CALIBER = '数据中心-评价数据';
const GOODS_SCORES_WINDOW_DAYS = 30;
export const GOODS_SCORES_FIELDS = Object.freeze(['caliber', 'window_days', 'items', 'total', 'truncated']);
export const GOODS_SCORE_FIELDS = Object.freeze(['goods_id', 'goods_name', 'review_count',
  'desc_score_avg', 'logistics_score_avg', 'service_score_avg']);

function maskedText(value) {
  return typeof value === 'string' ? value.replace(/1[3-9]\d{9}/g,
    (phone) => `${phone.slice(0, 3)}****${phone.slice(-4)}`) : null;
}

function reviewView(item) {
  const score = toFiniteNumber(item.score);
  const historical = score !== null && score !== 0;
  return { goods_id: text(item.goodsId), reviewed_at: toLocalDateTime(item.createTime),
    desc_score: historical ? null : toFiniteNumber(item.descScore),
    logistics_score: historical ? null : toFiniteNumber(item.logisticsScore),
    service_score: historical ? null : toFiniteNumber(item.serviceScore), history_score: historical ? score : null,
    comment: maskedText(item.comment), append_comment: maskedText(item.appendReview),
    tags: (item.keywords ?? []).filter((tag) => typeof tag === 'string'), replied: item.replied ?? null,
    picture_count: item.pictureCount ?? null };
}

function keywordView(keywords) {
  if (keywords === null) return null;
  const tags = (items) => items.map((item) => ({ name: text(item.keywordName), count: toFiniteNumber(item.num) }));
  return { positive: tags(keywords.positiveKeywordList), negative: tags(keywords.negativeKeywordList) };
}

function issueView(types) {
  return types === null ? null : types.typeList.map((item) => ({ name: text(item.typeName),
    positive_count: toFiniteNumber(item.positive), negative_count: toFiniteNumber(item.negative),
    share_pct: toFiniteNumber(item.proportion) }));
}

function headlines(days, keywordTags, issueTypes, reviews) {
  const lines = reviews === null ? [] : [`近 ${days} 天中差评 ${reviews.total} 条`];
  const tags = [...(keywordTags?.negative ?? [])].sort((left, right) => (right.count ?? 0) - (left.count ?? 0)).slice(0, 3);
  if (tags.length) lines.push(`不满意标签前 3：${tags.map((tag) => `${tag.name}(${tag.count})`).join('、')}`);
  const issues = [...(issueTypes ?? [])].filter((item) => item.negative_count > 0)
    .sort((left, right) => right.negative_count - left.negative_count);
  if (issues.length) lines.push(`问题类型负面最多：${issues[0].name}`);
  if (lines.length) return lines;
  // 列表缺失且没有可报的负面项：已取到的聚合如实陈述为 0，全部缺失才报数据缺失。
  const zeros = [keywordTags && '不满意标签 0 个',
    issueTypes?.length && issueTypes.every((item) => item.negative_count === 0) && '各问题类型负面数均为 0'].filter(Boolean);
  return [zeros.length ? `近 ${days} 天${zeros.join('，')}` : `近 ${days} 天评价数据缺失`];
}

// 平台对没有有效评价的商品返回均分 0，按缺失输出 null。
function goodsScoreView(item) {
  const count = toFiniteNumber(item.goodsUnfkUndfltRevCnt1m);
  const average = (value) => (count === null || count === 0 ? null : round(value));
  return { goods_id: text(item.goodsId), goods_name: text(item.goodsName), review_count: count,
    desc_score_avg: average(item.avgDescRevScr1m), logistics_score_avg: average(item.avgLgstRevScr1m),
    service_score_avg: average(item.avgServRevScr1m) };
}

function goodsScoresView(scores) {
  return scores === null ? null : { caliber: GOODS_SCORES_CALIBER, window_days: GOODS_SCORES_WINDOW_DAYS,
    items: scores.items.map(goodsScoreView), total: scores.total, truncated: scores.truncated };
}

function reviewList(reviews) {
  return { items: reviews.items.map(reviewView), total: reviews.total, truncated: reviews.truncated };
}

export function toReviewsView({ keywords = null, types = null, reviews = null, goodsScores = null },
  { days, hints = [], mallId = null }) {
  const keywordTags = keywordView(keywords);
  const issueTypes = issueView(types);
  const negativeReviews = reviews === null ? null : reviewList(reviews);
  const scores = goodsScoresView(goodsScores);
  const headline = headlines(days, keywordTags, issueTypes, negativeReviews);
  if (scores) {
    headline.push(`近 ${GOODS_SCORES_WINDOW_DAYS} 日有效评价商品 ${scores.items.filter((item) => item.review_count > 0).length} 个`);
  }
  return { headline, window_days: days,
    keyword_tags: keywordTags, issue_types: issueTypes, negative_reviews: negativeReviews, goods_scores: scores,
    hints: reportHints(REVIEWS_REPORT, hints), mall_id: mallId };
}

const PLATFORM_PLACEHOLDER_COMMENTS = new Set([
  '该用户未填写文字评价',
  '该用户觉得商品较好',
  '该用户觉得商品很好，给出了5星好评',
  '该用户觉得商品稍有不足',
  '该用户觉得商品不符合预期',
  '该用户觉得商品一般',
  '该用户觉得商品很好，给出去了5星好评',
]);

function validCharCount(textValue, { isMain = false, status = null } = {}) {
  if (typeof textValue !== 'string') return 0;
  const trimmed = textValue.trim();
  if (!trimmed) return 0;
  if (isMain && (status === 4 || PLATFORM_PLACEHOLDER_COMMENTS.has(trimmed))) return 0;
  const letters = trimmed.match(/\p{L}/gu);
  if (!letters || letters.length === 0) return 0;
  if (letters.length >= 2) {
    const lower = letters.map((char) => char.toLowerCase());
    if (lower.every((char) => char === lower[0])) return 0;
  }
  return letters.length;
}

function isNegativeReview(item) {
  const score = toFiniteNumber(item.score);
  const descScore = toFiniteNumber(item.descScore);
  const effectiveScore = score !== null && score !== 0 ? score : descScore;
  return effectiveScore !== null && effectiveScore <= 3;
}

const GOODS_REVIEW_FILTER_MODES = Object.freeze({
  substantive: Object.freeze({
    label: '实质内容',
    keep: (item) => validCharCount(item.comment, { isMain: true, status: item.status }) >= 1
      || validCharCount(item.appendReview) >= 1 || isNegativeReview(item),
    headline: (base, count) => `${base}，实质内容 ${count} 条`,
  }),
  min_length: Object.freeze({
    label: '最小字数',
    keep: (item, minLength) => validCharCount(item.comment, { isMain: true, status: item.status }) >= minLength
      || validCharCount(item.appendReview) >= minLength,
    headline: (base, count, minLength) => `${base}，有效字数 ≥ ${minLength} 字 ${count} 条`,
  }),
  all: Object.freeze({
    label: '全部',
    keep: () => true,
    headline: (base) => base,
  }),
});

function starsLabel(stars) {
  return stars ? ` ${stars.join('、')} 星` : '全部星级';
}

export function toGoodsReviewsView(reviews, { days, goodsId = null, stars = null,
  filter = DEFAULT_GOODS_REVIEWS_FILTER, hints = [], mallId = null }) {
  const modeSpec = Object.hasOwn(GOODS_REVIEW_FILTER_MODES, filter?.mode)
    ? GOODS_REVIEW_FILTER_MODES[filter.mode]
    : GOODS_REVIEW_FILTER_MODES.substantive;
  const fetchedCount = reviews.items.length;
  const items = reviews.items.filter((item) => modeSpec.keep(item, filter.min_length)).map(reviewView);
  const filteredOutCount = fetchedCount - items.length;
  const scope = goodsId ? `商品 ${goodsId} 的` : '';
  const base = `近 ${days} 天${scope}${starsLabel(stars)}评价 ${reviews.total} 条`;
  const headline = [modeSpec.headline(base, items.length, filter.min_length)];
  if (reviews.truncated) headline.push(`已采集 ${fetchedCount} 条，结果已截断`);
  return {
    headline,
    items,
    total: reviews.total,
    fetched_count: fetchedCount,
    filtered_out_count: filteredOutCount,
    truncated: reviews.truncated,
    filter: { mode: modeSpec.label, min_length: filter.min_length },
    window_days: days,
    goods_id: goodsId,
    stars: stars ? stars.map(Number) : null,
    hints: reportHints(GOODS_REVIEWS_REPORT, hints),
    mall_id: mallId,
  };
}
