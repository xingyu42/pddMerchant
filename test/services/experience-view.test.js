import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { toExperienceView, EXPERIENCE_INDICATOR_FIELDS, EXPERIENCE_TREND_ITEM_FIELDS,
  EXPERIENCE_SNAPSHOT_FIELDS } from '../../src/services/views/experience.js';

function sample(overrides = {}) {
  return { timestamp: '2026-10-29', mallStarTomms: 4.6, mallStarTommsChange: 0,
    mallStarTommsNext: 4.7, mallStarTommsNextPct: 50, scoreRk: 46.136,
    scoreDsc: '良', mallStarDesc: '已超越40%同行', stplName: '母婴',
    ptHelpRate1m: 0.0323, aprsIn3minRplyUsrRto1m: 0.5, rfSignTime1m: 27.77,
    rfProcTime1m: null, dsr3m: null, posTypeRto1m: 0.9091, seriousInferiorRto1m: 0.0013,
    adjNfkAvgCfmSignTime1m: 2.04, lgstMergeFine1m: 0.0194, gmvRk: 22.24,
    aprsIn3minRplyUsrRto1mNextPctThreshold: 0.8, aprsIn3minRplyUsrRto1mNextStarRkDesc: 1,
    rfSignTime1mNextPctThreshold: 3.995, rfSignTime1mNextStarRkDesc: 0,
    gmvRkNextPctThreshold: 50, gmvRkNextStarRkDesc: 2,
    rfProcTime1mNextStarRkDesc: 0, isRps: false, isRequireRps: true, isRpsNextStarRkDesc: 1,
    ...overrides };
}

const window = { start_date: '2026-10-24', end_date: '2026-10-30', days: 7 };

describe('shop experience view', () => {
  it('maps all ten indicators and converts values and thresholds consistently', () => {
    const view = toExperienceView(sample());
    assert.deepEqual(view.indicators.map((item) => [item.key, item.dimension, item.name, item.value, item.unit]), [
      ['platform_help_rate_pct', '售后服务', '近30天平台求助率', 3.23, '百分比'],
      ['manual_reply_3min_rate_pct', '售后服务', '近30天3分钟人工回复率', 50, '百分比'],
      ['refund_in_transit_hours', '售后服务', '近30天在途订单退款时长', 27.77, '小时'],
      ['refund_after_return_hours', '售后服务', '近30天商家签收退货后平均退款时长', null, '小时'],
      ['review_score_rank', '商品品质', '近90天用户评价得分排名', null, '平台原值'],
      ['positive_review_rate_pct', '商品品质', '近30天积极评论率', 90.91, '百分比'],
      ['serious_inferior_rate_pct', '商品品质', '近30天严重劣质率', 0.13, '百分比'],
      ['group_to_sign_days', '物流服务', '近30天成团-签收时效', 2.04, '天'],
      ['logistics_violation_rate_pct', '物流服务', '近30天物流综合违规处理率', 1.94, '百分比'],
      ['shop_activity_pct', '店铺活跃', '近30天店铺活跃度', 22.24, '百分比'],
    ]);
    assert.deepEqual(view.indicators[1], { key: 'manual_reply_3min_rate_pct', dimension: '售后服务',
      name: '近30天3分钟人工回复率', value: 50, unit: '百分比', next_star_threshold: 80, next_star_status: '未达标' });
    assert.equal(view.indicators[2].next_star_threshold, 4);
    assert.equal(view.indicators[2].next_star_status, '已达标');
    assert.equal(view.indicators[3].next_star_status, null);
    assert.equal(view.indicators[9].next_star_threshold, 50);
    assert.equal(view.indicators[9].next_star_status, null);
    assert.deepEqual(view.consumer_experience_plan, { enabled: false, required: true, next_star_status: '未达标' });
  });

  it('retains snapshot facts, sorts sparse trends and projects exact whitelists', () => {
    const info = sample();
    const trend = { ...window, items: [{ ...info, pt: '2026-10-30' }, { ...info, pt: '2026-10-24' }] };
    const view = toExperienceView(info, { trend, mallId: 'context-id' });
    assert.deepEqual(view.snapshot, { stat_date: '2026-10-29', star: 4.6, star_change: 0, next_star: 4.7,
      next_star_rank_pct: 50, score_rank_pct: 46.14, score_grade: '良', star_text: '已超越40%同行', industry: '母婴' });
    assert.deepEqual(view.trend.items.map((item) => item.date), ['2026-10-24', '2026-10-30']);
    assert.equal(view.trend.items[0].manual_reply_3min_rate_pct, 50);
    assert.equal(view.trend.items[0].refund_after_return_hours, null);
    assert.equal(view.mall_id, 'context-id');
    assert.equal(view.status, '数据完整');
    assert.deepEqual(Object.keys(view.snapshot), EXPERIENCE_SNAPSHOT_FIELDS);
    for (const item of view.indicators) assert.deepEqual(Object.keys(item), EXPERIENCE_INDICATOR_FIELDS);
    for (const item of view.trend.items) assert.deepEqual(Object.keys(item), EXPERIENCE_TREND_ITEM_FIELDS);
    assert.deepEqual(toExperienceView({ ...info, mallId: 'secret', mallName: 'secret', imageUrl: 'secret',
      mallStarToc: 5, ptHelpRate1mRk: 100, avgDescRevScrRcatePct3m: 90 }, { trend, mallId: 'context-id' }), view);
  });

  it('emits factual headlines with missing fragments omitted and at most three lines', () => {
    assert.deepEqual(toExperienceView(sample()).headline, [
      '店铺综合体验星级 4.6 星（较前1天 0），下一星级 4.7 星',
      '领航员综合分行业排名 46.14%，平台评级「良」',
      '考核指标 10 项，已达标 1 项、未达标 1 项',
    ]);
    const missing = toExperienceView({});
    assert.deepEqual(missing.headline, ['店铺综合体验星级数据缺失', '考核指标 10 项，已达标 0 项、未达标 0 项']);
    assert.ok(Object.values(missing.snapshot).every((value) => value === null));
    assert.ok(missing.indicators.every((item) => item.value === null && item.next_star_status === null));
    assert.deepEqual(missing.consumer_experience_plan, { enabled: null, required: null, next_star_status: null });
  });

  it('keeps zero values and platform statuses without deriving a verdict', () => {
    const view = toExperienceView(sample({ ptHelpRate1m: 0, ptHelpRate1mNextPctThreshold: 0,
      ptHelpRate1mNextStarRkDesc: 1, rfProcTime1m: 0, rfProcTime1mNextStarRkDesc: 7,
      isRpsNextStarRkDesc: null }));
    assert.equal(view.indicators[0].value, 0);
    assert.equal(view.indicators[0].next_star_threshold, 0);
    assert.equal(view.indicators[0].next_star_status, '未达标');
    assert.equal(view.indicators[3].next_star_status, null);
    assert.equal(view.consumer_experience_plan.next_star_status, null);
  });

  it('marks missing trends partial and adds delay hints without changing completeness', () => {
    const partial = toExperienceView(sample(), { hints: ['trend_unavailable'] });
    assert.equal(partial.trend, null);
    assert.equal(partial.status, '数据不完整');
    assert.deepEqual(partial.hints, ['趋势数据拉取失败']);
    for (const markers of [{ normalFlag: false }, { delayData: '' }, { delayData: '延迟' }]) {
      const view = toExperienceView(sample(markers), { trend: { ...window, items: [] } });
      assert.equal(view.status, '数据完整');
      assert.deepEqual(view.hints, ['平台标记数据延迟']);
    }
    const view = toExperienceView(sample(), { trend: { ...window, items: [sample({ pt: '2026-10-30', normalFlag: false })] } });
    assert.deepEqual(view.hints, ['平台标记数据延迟']);
  });
});
