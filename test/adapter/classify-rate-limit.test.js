import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { classifyRateLimit, classifyBusinessRisk } from '../../src/adapter/classify-rate-limit.js';

describe('classifyRateLimit (existing behavior)', () => {
  it('returns http-429 for 429 status', () => {
    assert.equal(classifyRateLimit({}, { status: 429 }), 'http-429');
  });

  it('returns business-54001 for error_code 54001', () => {
    assert.equal(classifyRateLimit({ error_code: 54001 }), 'business-54001');
  });

  it('returns null for normal response', () => {
    assert.equal(classifyRateLimit({ success: true }), null);
  });
});

describe('classifyBusinessRisk', () => {
  it('detects captcha-required from code 70031', () => {
    assert.equal(classifyBusinessRisk({ error_code: 70031 }), 'captcha-required');
  });

  it('detects risk-control from code 52101', () => {
    assert.equal(classifyBusinessRisk({ error_code: 52101 }), 'risk-control');
  });

  it('detects captcha from code 10019', () => {
    assert.equal(classifyBusinessRisk({ error_code: 10019 }), 'captcha-required');
  });

  it('detects account-restricted from code 9501', () => {
    assert.equal(classifyBusinessRisk({ error_code: 9501 }), 'account-restricted');
  });

  it('detects captcha from error message', () => {
    assert.equal(classifyBusinessRisk({ error_msg: '请完成验证码验证' }), 'captcha-required');
  });

  it('detects risk-control from error message', () => {
    assert.equal(classifyBusinessRisk({ error_msg: '触发风控限制' }), 'risk-control');
  });

  it('returns null for normal response', () => {
    assert.equal(classifyBusinessRisk({ success: true }), null);
  });

  it('returns null for null input', () => {
    assert.equal(classifyBusinessRisk(null), null);
  });

  it('handles nested error codes', () => {
    assert.equal(classifyBusinessRisk({ result: { error_code: 52101 } }), 'risk-control');
  });
});
