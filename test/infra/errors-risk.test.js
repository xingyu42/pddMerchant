import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { riskControlDetected, captchaDetected, loginRedirectDetected, PddCliError, ExitCodes } from '../../src/infra/errors.js';

describe('risk control error helpers', () => {
  it('riskControlDetected returns PddCliError with E_RISK_CONTROL code', () => {
    const err = riskControlDetected({ phase: 'form', url: 'https://mms.pinduoduo.com' });
    assert(err instanceof PddCliError);
    assert.equal(err.code, 'E_RISK_CONTROL');
    assert.equal(err.exitCode, ExitCodes.RATE_LIMIT);
    assert.equal(err.detail.phase, 'form');
  });

  it('captchaDetected returns PddCliError with E_CAPTCHA_DOM code', () => {
    const err = captchaDetected({ type: 'slider', selectors: ['div.slider'] });
    assert(err instanceof PddCliError);
    assert.equal(err.code, 'E_CAPTCHA_DOM');
    assert.equal(err.exitCode, ExitCodes.RATE_LIMIT);
  });

  it('loginRedirectDetected returns PddCliError with E_AUTH_EXPIRED code', () => {
    const err = loginRedirectDetected({ url: 'https://mms.pinduoduo.com/login' });
    assert(err instanceof PddCliError);
    assert.equal(err.code, 'E_AUTH_EXPIRED');
    assert.equal(err.exitCode, ExitCodes.AUTH);
  });
});
