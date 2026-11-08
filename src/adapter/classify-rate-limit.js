export function readResponseStatus(response) {
  if (!response) return null;
  try {
    const status = typeof response.status === 'function' ? response.status() : response.status;
    return typeof status === 'number' ? status : null;
  } catch {
    return null;
  }
}

export function classifyRateLimit(raw, response) {
  if (readResponseStatus(response) === 429) return 'http-429';

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
