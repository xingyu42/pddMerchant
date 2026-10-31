import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { NAVIGATOR_INFO, NAVIGATOR_READY_DATE, NAVIGATOR_LIST } from '../../src/adapter/endpoints/experience.js';

const specs = [NAVIGATOR_INFO, NAVIGATOR_READY_DATE, NAVIGATOR_LIST];

describe('experience page-api contracts', () => {
  it('uses the signed page client and exact endpoint payloads', () => {
    for (const spec of specs) {
      assert.equal(spec.strategy, 'page-api');
      assert.equal(spec.nav.url, 'https://mms.pinduoduo.com/sycm/goods_quality/pilot_mall');
      assert.equal(spec.apiUrl, `/sydney/api/mallNavigator/queryUpgradeMallNavigator${{
        'experience.navigatorInfo': 'Info', 'experience.navigatorReadyDate': 'ReadyDate',
        'experience.navigatorList': 'List',
      }[spec.name]}`);
    }
    assert.deepEqual(NAVIGATOR_INFO.buildPayload({ mallId: 'noise' }), {});
    assert.deepEqual(NAVIGATOR_READY_DATE.buildPayload(), {});
    assert.deepEqual(NAVIGATOR_LIST.buildPayload({ beginDate: '2026-10-24', endDate: '2026-10-30', noise: 1 }),
      { beginDate: '2026-10-24', endDate: '2026-10-30' });
  });

  it('requires both success and the camelCase success code', () => {
    for (const spec of specs) {
      assert.equal(spec.isSuccess({ success: true, errorCode: 1000000 }), true);
      for (const raw of [null, {}, { success: true }, { success: false, errorCode: 1000000 },
        { success: true, errorCode: 0 }, { success: true, error_code: 1000000 }]) {
        assert.equal(spec.isSuccess(raw), false);
      }
      const error = spec.errorMapper({ success: false, errorCode: 40002, errorMsg: '请求失败' });
      assert.equal(error.code, 'E_BUSINESS');
      assert.equal(error.message, '请求失败');
    }
  });

  it('projects only confirmed fields for snapshot and trend', () => {
    const result = { mallId: 'SYN-MALL', mallName: 'SYN-NAME', imageUrl: 'https://example.invalid/x',
      mallStarToc: 4.5, avgDescRevScrRcatePct3m: 50, ptHelpRate1mRk: 52.92,
      ptHelpRate1mRkDesc: 1, ptHelpRate1m4p5Standard: 1, ptHelpRate1m5Standard: 0,
      ptHelpRate1mRkStage: 2, timestamp: '2026-10-29', pt: '2026-10-28',
      mallStarTomms: 4.6, scoreRk: 46.136, ptHelpRate1m: 0.0323,
      ptHelpRate1mNextPctThreshold: 0.03, ptHelpRate1mNextStarRkDesc: 1,
      normalFlag: true, delayData: null };
    assert.deepEqual(NAVIGATOR_INFO.normalize({ result }), {
      timestamp: '2026-10-29', mallStarTomms: 4.6, scoreRk: 46.136, ptHelpRate1m: 0.0323,
      ptHelpRate1mNextPctThreshold: 0.03, ptHelpRate1mNextStarRkDesc: 1, normalFlag: true, delayData: null,
    });
    assert.deepEqual(NAVIGATOR_LIST.normalize({ result: [result] }), [{
      pt: '2026-10-28', mallStarTomms: 4.6, scoreRk: 46.136, ptHelpRate1m: 0.0323,
      ptHelpRate1mNextPctThreshold: 0.03, ptHelpRate1mNextStarRkDesc: 1, normalFlag: true, delayData: null,
    }]);
    assert.equal(NAVIGATOR_READY_DATE.normalize({ result: '2026-10-30' }), '2026-10-30');
  });

  it('rejects missing result shapes instead of fabricating data', () => {
    for (const spec of specs) assert.throws(() => spec.normalize({}), { code: 'E_NETWORK' });
    assert.throws(() => NAVIGATOR_LIST.normalize({ result: [null] }), { code: 'E_NETWORK' });
    assert.throws(() => NAVIGATOR_READY_DATE.normalize({ result: '2026-02-30' }), { code: 'E_NETWORK' });
    assert.deepEqual(NAVIGATOR_LIST.normalize({ result: [] }), []);
  });
});
