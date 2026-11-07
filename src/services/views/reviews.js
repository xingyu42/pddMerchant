import { toLocalDateTime, toFiniteNumber } from '../../infra/units.js';
import { text } from './_shared.js';
import { defineReport, reportHints } from '../operating-report.js';

export const REVIEWS_REPORT = defineReport({
  days: { choices: { 30: 1, 60: 5, 90: 4, 180: 3 }, default: 30,
    message: '--days 需为 {choices_or}', description: '评价窗口天数（{range}）' },
  hints: {
    keywords_unavailable: '评价标签聚合拉取失败', types_unavailable: '评价问题类型拉取失败',
    reviews_unavailable: '中差评列表拉取失败', list_truncated: '中差评列表已达 30 页采集上限，结果已截断',
  },
});

export const REVIEW_TAG_FIELDS = Object.freeze(['name', 'count']);
export const ISSUE_TYPE_FIELDS = Object.freeze(['name', 'positive_count', 'negative_count', 'share_pct']);
export const NEGATIVE_REVIEW_FIELDS = Object.freeze(['goods_id', 'reviewed_at', 'desc_score',
  'logistics_score', 'service_score', 'history_score', 'comment', 'append_comment', 'tags', 'replied', 'picture_count']);

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
  const issues = [...(issueTypes ?? [])].filter((item) => item.negative_count !== null)
    .sort((left, right) => right.negative_count - left.negative_count);
  if (issues.length) lines.push(`问题类型负面最多：${issues[0].name}`);
  return lines.length ? lines : [`近 ${days} 天评价数据缺失`];
}

export function toReviewsView({ keywords = null, types = null, reviews = null }, { days, hints = [], mallId = null }) {
  const keywordTags = keywordView(keywords);
  const issueTypes = issueView(types);
  const negativeReviews = reviews === null ? null : { items: reviews.items.map(reviewView),
    total: reviews.total, truncated: reviews.truncated };
  return { headline: headlines(days, keywordTags, issueTypes, negativeReviews), window_days: days,
    keyword_tags: keywordTags, issue_types: issueTypes, negative_reviews: negativeReviews,
    hints: reportHints(REVIEWS_REPORT, hints), mall_id: mallId };
}
