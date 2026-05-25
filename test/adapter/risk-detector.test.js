import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { detectPageRisk, assertNoRiskControl } from '../../src/adapter/goods-publish/risk-detector.js';
import { PddCliError } from '../../src/infra/errors.js';

function mockPage(url, visibleSelectors = []) {
  return {
    url: () => url,
    locator: (sel) => ({
      first: () => ({
        isVisible: async ({ timeout } = {}) => visibleSelectors.includes(sel),
      }),
    }),
  };
}

describe('detectPageRisk', () => {
  it('returns not detected for normal page', async () => {
    const page = mockPage('https://mms.pinduoduo.com/goods/edit');
    const result = await detectPageRisk(page);
    assert.equal(result.detected, false);
    assert.equal(result.type, null);
  });

  it('detects login redirect', async () => {
    const page = mockPage('https://mms.pinduoduo.com/login');
    const result = await detectPageRisk(page);
    assert.equal(result.detected, true);
    assert.equal(result.type, 'login-redirect');
  });

  it('detects captcha element', async () => {
    const page = mockPage('https://mms.pinduoduo.com/goods', ['div[class*="captcha"]']);
    const result = await detectPageRisk(page);
    assert.equal(result.detected, true);
    assert.equal(result.type, 'captcha');
  });

  it('detects slider element', async () => {
    const page = mockPage('https://mms.pinduoduo.com/goods', ['div[class*="slider"]']);
    const result = await detectPageRisk(page);
    assert.equal(result.detected, true);
    assert.equal(result.type, 'slider');
  });

  it('detects risk modal', async () => {
    const page = mockPage('https://mms.pinduoduo.com/goods', ['div[class*="risk"]']);
    const result = await detectPageRisk(page);
    assert.equal(result.detected, true);
    assert.equal(result.type, 'risk-modal');
  });

  it('includes phase info', async () => {
    const page = mockPage('https://mms.pinduoduo.com/login');
    const result = await detectPageRisk(page, { phase: 'category' });
    assert.equal(result.phase, 'category');
  });
});

describe('assertNoRiskControl', () => {
  it('does not throw on normal page', async () => {
    const page = mockPage('https://mms.pinduoduo.com/goods/edit');
    await assertNoRiskControl(page);
  });

  it('throws PddCliError on login redirect', async () => {
    const page = mockPage('https://mms.pinduoduo.com/login');
    await assert.rejects(
      () => assertNoRiskControl(page),
      (err) => {
        assert(err instanceof PddCliError);
        assert.equal(err.code, 'E_AUTH_EXPIRED');
        return true;
      }
    );
  });

  it('throws PddCliError on captcha', async () => {
    const page = mockPage('https://mms.pinduoduo.com/goods', ['div[class*="captcha"]']);
    await assert.rejects(
      () => assertNoRiskControl(page),
      (err) => {
        assert(err instanceof PddCliError);
        assert.equal(err.code, 'E_CAPTCHA_DOM');
        return true;
      }
    );
  });
});
