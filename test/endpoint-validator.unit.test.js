import { describe, test } from 'vitest';
import assert from 'node:assert/strict';
import { validateEndpointSpec } from '../src/adapter/endpoint-validator.js';

// --------------- helpers ---------------

function findWarning(result, code) {
  return result.warnings.find((w) => w.code === code);
}

function countBySeverity(result, severity) {
  return result.warnings.filter((w) => w.severity === severity).length;
}

// --------------- R1: Required Fields ---------------

describe('R1 — required fields', () => {
  test('missing name produces MISSING_NAME error', () => {
    const result = validateEndpointSpec({ urlPattern: /test/ });
    const w = findWarning(result, 'MISSING_NAME');
    assert.ok(w);
    assert.equal(w.severity, 'error');
    assert.equal(result.valid, false);
  });

  test('missing urlPattern produces MISSING_URL_PATTERN error', () => {
    const result = validateEndpointSpec({ name: 'test.endpoint' });
    const w = findWarning(result, 'MISSING_URL_PATTERN');
    assert.ok(w);
    assert.equal(w.severity, 'error');
  });

  test('non-string name produces MISSING_NAME error', () => {
    const result = validateEndpointSpec({ name: 123, urlPattern: /test/ });
    assert.ok(findWarning(result, 'MISSING_NAME'));
  });

  test('null spec produces MISSING_NAME error', () => {
    const result = validateEndpointSpec(null);
    assert.ok(findWarning(result, 'MISSING_NAME'));
    assert.equal(result.valid, false);
  });
});

// --------------- R2: Transport Strategy ---------------

describe('R2 — transport strategy inference', () => {
  test('buildPayload + apiUrl → fetch strategy, no ambiguity warning', () => {
    const result = validateEndpointSpec({
      name: 'test.fetch',
      urlPattern: /\/api\/test/,
      apiUrl: '/api/test',
      buildPayload: (params) => ({ id: params.id }),
      isSuccess: (raw) => raw?.success === true,
    });
    assert.equal(result.strategy, 'fetch');
    assert.ok(!findWarning(result, 'AMBIGUOUS_TRANSPORT'));
  });

  test('no buildPayload + no apiUrl → legacy strategy, no ambiguity warning', () => {
    const result = validateEndpointSpec({
      name: 'test.legacy',
      urlPattern: /test/,
      nav: { url: 'https://example.com' },
      isSuccess: (raw) => raw?.success === true,
      normalize: (raw) => ({ raw }),
    });
    assert.equal(result.strategy, 'legacy');
    assert.ok(!findWarning(result, 'AMBIGUOUS_TRANSPORT'));
  });

  test('buildPayload without apiUrl → ambiguous + AMBIGUOUS_TRANSPORT warning', () => {
    const result = validateEndpointSpec({
      name: 'test.ambiguous1',
      urlPattern: /test/,
      buildPayload: () => ({}),
      isSuccess: () => true,
    });
    assert.equal(result.strategy, 'ambiguous');
    const w = findWarning(result, 'AMBIGUOUS_TRANSPORT');
    assert.ok(w);
    assert.equal(w.severity, 'warning');
    assert.equal(w.field, 'apiUrl');
  });

  test('apiUrl without buildPayload → ambiguous + AMBIGUOUS_TRANSPORT warning', () => {
    const result = validateEndpointSpec({
      name: 'test.ambiguous2',
      urlPattern: /test/,
      apiUrl: '/api/test',
      isSuccess: () => true,
    });
    assert.equal(result.strategy, 'ambiguous');
    const w = findWarning(result, 'AMBIGUOUS_TRANSPORT');
    assert.ok(w);
    assert.equal(w.field, 'buildPayload');
  });

  test('empty apiUrl string is treated as no apiUrl', () => {
    const result = validateEndpointSpec({
      name: 'test.emptyUrl',
      urlPattern: /test/,
      apiUrl: '',
      buildPayload: () => ({}),
      isSuccess: () => true,
    });
    assert.equal(result.strategy, 'ambiguous');
  });
});

// --------------- R3: Fetch Mode ---------------

describe('R3 — fetch-mode validation', () => {
  test('buildPayload arity > 2 produces SUSPICIOUS_BUILD_PAYLOAD_ARITY info', () => {
    const result = validateEndpointSpec({
      name: 'test.arity',
      urlPattern: /\/api\/test/,
      apiUrl: '/api/test',
      buildPayload: (a, b, c) => ({ a, b, c }),
      isSuccess: () => true,
    });
    const w = findWarning(result, 'SUSPICIOUS_BUILD_PAYLOAD_ARITY');
    assert.ok(w);
    assert.equal(w.severity, 'info');
  });

  test('buildPayload arity <= 2 produces no arity warning', () => {
    const result = validateEndpointSpec({
      name: 'test.normalArity',
      urlPattern: /\/api\/test/,
      apiUrl: '/api/test',
      buildPayload: (params, ctx) => ({}),
      isSuccess: () => true,
    });
    assert.ok(!findWarning(result, 'SUSPICIOUS_BUILD_PAYLOAD_ARITY'));
  });

  test('apiUrl not starting with / produces INVALID_API_URL warning', () => {
    const result = validateEndpointSpec({
      name: 'test.badUrl',
      urlPattern: /test/,
      apiUrl: 'https://example.com/api/test',
      buildPayload: () => ({}),
      isSuccess: () => true,
    });
    const w = findWarning(result, 'INVALID_API_URL');
    assert.ok(w);
    assert.equal(w.severity, 'warning');
  });

  test('apiUrl starting with / produces no INVALID_API_URL warning', () => {
    const result = validateEndpointSpec({
      name: 'test.goodUrl',
      urlPattern: /\/api\/test/,
      apiUrl: '/api/test',
      buildPayload: () => ({}),
      isSuccess: () => true,
    });
    assert.ok(!findWarning(result, 'INVALID_API_URL'));
  });

  test('urlPattern not matching apiUrl produces URL_PATTERN_MISMATCH warning', () => {
    const result = validateEndpointSpec({
      name: 'test.mismatch',
      urlPattern: /completely-different-path/,
      apiUrl: '/api/v2/goods/list',
      buildPayload: () => ({}),
      isSuccess: () => true,
    });
    const w = findWarning(result, 'URL_PATTERN_MISMATCH');
    assert.ok(w);
    assert.equal(w.severity, 'warning');
  });

  test('urlPattern matching apiUrl produces no URL_PATTERN_MISMATCH', () => {
    const result = validateEndpointSpec({
      name: 'test.match',
      urlPattern: /vodka\/v2\/mms\/query\/display\/mall\/goodsList/,
      apiUrl: '/vodka/v2/mms/query/display/mall/goodsList',
      buildPayload: () => ({}),
      isSuccess: () => true,
    });
    assert.ok(!findWarning(result, 'URL_PATTERN_MISMATCH'));
  });
});

// --------------- R4: Legacy Mode ---------------

describe('R4 — legacy-mode validation', () => {
  test('requiredTrigger without trigger produces REQUIRED_TRIGGER_MISSING error', () => {
    const result = validateEndpointSpec({
      name: 'test.noTrigger',
      urlPattern: /test/,
      requiredTrigger: true,
      nav: { url: 'https://example.com' },
      isSuccess: () => true,
      normalize: (raw) => ({ raw }),
    });
    const w = findWarning(result, 'REQUIRED_TRIGGER_MISSING');
    assert.ok(w);
    assert.equal(w.severity, 'error');
    assert.equal(result.valid, false);
  });

  test('requiredTrigger with valid trigger produces no error', () => {
    const result = validateEndpointSpec({
      name: 'test.hasTrigger',
      urlPattern: /test/,
      requiredTrigger: true,
      trigger: async (page, params) => {},
      nav: { url: 'https://example.com' },
      isSuccess: () => true,
      normalize: (raw) => ({ raw }),
    });
    assert.ok(!findWarning(result, 'REQUIRED_TRIGGER_MISSING'));
  });

  test('trigger with 0 params produces TRIGGER_ARITY_SUSPICIOUS info', () => {
    const result = validateEndpointSpec({
      name: 'test.zeroArity',
      urlPattern: /test/,
      requiredTrigger: true,
      trigger: async () => {},
      nav: { url: 'https://example.com' },
      isSuccess: () => true,
      normalize: (raw) => ({ raw }),
    });
    const w = findWarning(result, 'TRIGGER_ARITY_SUSPICIOUS');
    assert.ok(w);
    assert.equal(w.severity, 'info');
  });

  test('legacy-mode without nav.url produces LEGACY_MISSING_NAV_URL warning', () => {
    const result = validateEndpointSpec({
      name: 'test.noNav',
      urlPattern: /test/,
      isSuccess: () => true,
      normalize: (raw) => ({ raw }),
    });
    const w = findWarning(result, 'LEGACY_MISSING_NAV_URL');
    assert.ok(w);
    assert.equal(w.severity, 'warning');
  });

  test('legacy-mode with nav.url produces no LEGACY_MISSING_NAV_URL', () => {
    const result = validateEndpointSpec({
      name: 'test.hasNav',
      urlPattern: /test/,
      nav: { url: 'https://example.com' },
      isSuccess: () => true,
      normalize: (raw) => ({ raw }),
    });
    assert.ok(!findWarning(result, 'LEGACY_MISSING_NAV_URL'));
  });
});

// --------------- R5: Response Contract ---------------

describe('R5 — response contract', () => {
  test('missing isSuccess produces MISSING_IS_SUCCESS warning', () => {
    const result = validateEndpointSpec({
      name: 'test.noIsSuccess',
      urlPattern: /test/,
      nav: { url: 'https://example.com' },
      normalize: (raw) => ({ raw }),
    });
    const w = findWarning(result, 'MISSING_IS_SUCCESS');
    assert.ok(w);
    assert.equal(w.severity, 'warning');
  });

  test('present isSuccess produces no MISSING_IS_SUCCESS', () => {
    const result = validateEndpointSpec({
      name: 'test.hasIsSuccess',
      urlPattern: /test/,
      nav: { url: 'https://example.com' },
      isSuccess: () => true,
      normalize: (raw) => ({ raw }),
    });
    assert.ok(!findWarning(result, 'MISSING_IS_SUCCESS'));
  });

  test('no errorMapper and no normalize produces MISSING_RESPONSE_HANDLERS info', () => {
    const result = validateEndpointSpec({
      name: 'test.noHandlers',
      urlPattern: /test/,
      nav: { url: 'https://example.com' },
      isSuccess: () => true,
    });
    const w = findWarning(result, 'MISSING_RESPONSE_HANDLERS');
    assert.ok(w);
    assert.equal(w.severity, 'info');
  });

  test('has normalize → no MISSING_RESPONSE_HANDLERS', () => {
    const result = validateEndpointSpec({
      name: 'test.hasNormalize',
      urlPattern: /test/,
      nav: { url: 'https://example.com' },
      isSuccess: () => true,
      normalize: (raw) => ({ raw }),
    });
    assert.ok(!findWarning(result, 'MISSING_RESPONSE_HANDLERS'));
  });

  test('errorMapper without isSuccess produces ERROR_MAPPER_WITHOUT_IS_SUCCESS', () => {
    const result = validateEndpointSpec({
      name: 'test.orphanMapper',
      urlPattern: /test/,
      nav: { url: 'https://example.com' },
      errorMapper: () => null,
      normalize: (raw) => ({ raw }),
    });
    const w = findWarning(result, 'ERROR_MAPPER_WITHOUT_IS_SUCCESS');
    assert.ok(w);
    assert.equal(w.severity, 'warning');
  });

  test('errorMapper with isSuccess produces no ERROR_MAPPER_WITHOUT_IS_SUCCESS', () => {
    const result = validateEndpointSpec({
      name: 'test.pairedMapper',
      urlPattern: /test/,
      nav: { url: 'https://example.com' },
      isSuccess: () => true,
      errorMapper: () => null,
      normalize: (raw) => ({ raw }),
    });
    assert.ok(!findWarning(result, 'ERROR_MAPPER_WITHOUT_IS_SUCCESS'));
  });
});

// --------------- R6: Navigation ---------------

describe('R6 — navigation contract', () => {
  test('nav.url as number produces INVALID_NAV_URL_TYPE error', () => {
    const result = validateEndpointSpec({
      name: 'test.badNav',
      urlPattern: /test/,
      nav: { url: 42 },
      isSuccess: () => true,
      normalize: (raw) => ({ raw }),
    });
    const w = findWarning(result, 'INVALID_NAV_URL_TYPE');
    assert.ok(w);
    assert.equal(w.severity, 'error');
  });

  test('nav.url as string is valid', () => {
    const result = validateEndpointSpec({
      name: 'test.stringNav',
      urlPattern: /test/,
      nav: { url: 'https://example.com' },
      isSuccess: () => true,
      normalize: (raw) => ({ raw }),
    });
    assert.ok(!findWarning(result, 'INVALID_NAV_URL_TYPE'));
  });

  test('nav.url as function is valid', () => {
    const result = validateEndpointSpec({
      name: 'test.fnNav',
      urlPattern: /test/,
      nav: { url: (params) => `https://example.com/${params.id}` },
      isSuccess: () => true,
      normalize: (raw) => ({ raw }),
    });
    assert.ok(!findWarning(result, 'INVALID_NAV_URL_TYPE'));
  });

  test('non-string readyEl produces INVALID_READY_EL warning', () => {
    const result = validateEndpointSpec({
      name: 'test.badReadyEl',
      urlPattern: /test/,
      nav: { url: 'https://example.com', readyEl: 123 },
      isSuccess: () => true,
      normalize: (raw) => ({ raw }),
    });
    const w = findWarning(result, 'INVALID_READY_EL');
    assert.ok(w);
    assert.equal(w.severity, 'warning');
  });

  test('string readyEl is valid', () => {
    const result = validateEndpointSpec({
      name: 'test.goodReadyEl',
      urlPattern: /test/,
      nav: { url: 'https://example.com', readyEl: 'button' },
      isSuccess: () => true,
      normalize: (raw) => ({ raw }),
    });
    assert.ok(!findWarning(result, 'INVALID_READY_EL'));
  });

  test('no nav at all produces no R6 warnings', () => {
    const result = validateEndpointSpec({
      name: 'test.noNav',
      urlPattern: /test/,
      apiUrl: '/api/test',
      buildPayload: () => ({}),
      isSuccess: () => true,
    });
    assert.ok(!findWarning(result, 'INVALID_NAV_URL_TYPE'));
    assert.ok(!findWarning(result, 'INVALID_READY_EL'));
  });
});

// --------------- Edge cases ---------------

describe('edge cases', () => {
  test('empty spec produces multiple errors', () => {
    const result = validateEndpointSpec({});
    assert.equal(result.valid, false);
    assert.ok(countBySeverity(result, 'error') >= 1);
    assert.ok(findWarning(result, 'MISSING_NAME'));
    assert.ok(findWarning(result, 'MISSING_URL_PATTERN'));
  });

  test('fully valid fetch spec produces zero errors and zero warnings', () => {
    const result = validateEndpointSpec({
      name: 'test.perfect',
      urlPattern: /\/api\/test/,
      apiUrl: '/api/test',
      buildPayload: (params, ctx) => ({ id: params.id }),
      isSuccess: (raw) => raw?.success === true,
      normalize: (raw) => ({ data: raw?.result, raw }),
      nav: { url: 'https://example.com', readyEl: 'table' },
    });
    assert.equal(result.valid, true);
    assert.equal(result.strategy, 'fetch');
    assert.equal(countBySeverity(result, 'error'), 0);
    assert.equal(countBySeverity(result, 'warning'), 0);
  });

  test('fully valid legacy spec produces zero errors', () => {
    const result = validateEndpointSpec({
      name: 'test.perfectLegacy',
      urlPattern: /test/,
      requiredTrigger: true,
      trigger: async (page, params, ctx) => {},
      nav: { url: 'https://example.com', readyEl: 'body' },
      isSuccess: (raw) => raw?.success === true,
      normalize: (raw) => ({ raw }),
      errorMapper: () => null,
    });
    assert.equal(result.valid, true);
    assert.equal(result.strategy, 'legacy');
    assert.equal(countBySeverity(result, 'error'), 0);
  });

  test('warning schema has required fields', () => {
    const result = validateEndpointSpec({});
    for (const w of result.warnings) {
      assert.equal(typeof w.code, 'string');
      assert.ok(['error', 'warning', 'info'].includes(w.severity));
      assert.equal(typeof w.message, 'string');
      assert.ok('field' in w);
      assert.ok('suggestion' in w);
    }
  });
});
