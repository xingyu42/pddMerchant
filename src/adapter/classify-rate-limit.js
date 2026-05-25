export function classifyRateLimit(raw, response) {
  if (response) {
    const status = typeof response.status === 'function' ? response.status() : response?.status;
    if (status === 429) return 'http-429';
  }

  if (raw != null && typeof raw === 'object') {
    const candidates = [
      raw.error_code,
      raw.errorCode,
      raw.code,
      raw.result?.error_code,
      raw.result?.errorCode,
    ];
    for (const c of candidates) {
      if (c != null && String(c) === '54001') return 'business-54001';
    }
  }

  return null;
}

const RISK_CODES = {
  '70031': 'captcha-required',
  '52101': 'risk-control',
  '10019': 'captcha-required',
  '9501': 'account-restricted',
};

export function classifyBusinessRisk(raw, response) {
  if (raw == null || typeof raw !== 'object') return null;

  const candidates = [
    raw.error_code,
    raw.errorCode,
    raw.code,
    raw.result?.error_code,
    raw.result?.errorCode,
  ];

  for (const c of candidates) {
    if (c != null) {
      const risk = RISK_CODES[String(c)];
      if (risk) return risk;
    }
  }

  const msg = raw.error_msg || raw.errorMsg || raw.message || '';
  if (/验证码|captcha|verify/i.test(msg)) return 'captcha-required';
  if (/风控|risk.?control|限制/i.test(msg)) return 'risk-control';
  if (/账号.*限制|account.*restrict/i.test(msg)) return 'account-restricted';

  return null;
}
