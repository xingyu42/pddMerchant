import { validateEndpointSpec } from './endpoint-validator.js';

function warning({ code, severity = 'warning', message, field = null, suggestion = '', detail = null }) {
  return { code, severity, message, field, suggestion, detail };
}

function toFixtureNameSet(fixtureNames) {
  if (fixtureNames instanceof Set) return fixtureNames;
  if (Array.isArray(fixtureNames)) return new Set(fixtureNames);
  return null;
}

function pageFixtureNamesFor(fixtureNameSet, name) {
  if (!fixtureNameSet) return [];
  const pattern = new RegExp(`^${escapeRegExp(name)}\\.page\\d+\\.json$`);
  return [...fixtureNameSet].filter((fixtureName) => pattern.test(fixtureName));
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function payloadLookup(fixturePayloads) {
  if (fixturePayloads instanceof Map) return fixturePayloads;
  if (fixturePayloads && typeof fixturePayloads === 'object') {
    return {
      has: (key) => Object.prototype.hasOwnProperty.call(fixturePayloads, key),
      get: (key) => fixturePayloads[key],
    };
  }
  return null;
}

function cloneFixturePayload(value) {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function stableJson(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return undefined;
  }
}

function sameJsonShape(a, b) {
  const left = stableJson(a);
  const right = stableJson(b);
  return left !== undefined && right !== undefined && left === right;
}

function validateEndpointDiagnostics(spec, warnings) {
  const endpointResult = validateEndpointSpec(spec);
  for (const item of endpointResult.warnings) {
    if (item.severity !== 'error') continue;
    warnings.push(warning({
      code: 'ENDPOINT_SPEC_ERROR',
      severity: 'error',
      message: `${spec?.name ?? '<unknown>'}: endpoint spec diagnostic ${item.code}`,
      field: item.field,
      suggestion: item.suggestion,
      detail: item,
    }));
  }
  return endpointResult;
}

function validateFixtureNames(spec, warnings, fixtureNameSet) {
  if (!fixtureNameSet) return;
  const baseFixtureName = `${spec.name}.json`;
  if (!fixtureNameSet.has(baseFixtureName)) {
    warnings.push(warning({
      code: 'MISSING_BASE_FIXTURE',
      message: `${spec.name}: missing endpoint fixture ${baseFixtureName}`,
      field: 'fixture',
      suggestion: `Add test/fixtures/endpoints/${baseFixtureName} or document why this endpoint has no fixture coverage`,
    }));
  }

  const pageFixtures = pageFixtureNamesFor(fixtureNameSet, spec.name);
  if (pageFixtures.length > 0 && !spec.fixtureListKey) {
    warnings.push(warning({
      code: 'PAGINATED_FIXTURE_WITHOUT_LIST_KEY',
      message: `${spec.name}: page-specific fixtures exist but fixtureListKey is not declared`,
      field: 'fixtureListKey',
      suggestion: 'Declare fixtureListKey if page>=2 synthesis should work beyond checked-in page fixtures',
      detail: { pageFixtures },
    }));
  }
}

function validateFixturePayload(spec, warnings, rawFixture) {
  if (rawFixture && typeof rawFixture === 'object' && rawFixture.__throws) return;

  let acceptedByLiveContract = true;
  if (typeof spec.isSuccess === 'function') {
    acceptedByLiveContract = false;
    try {
      acceptedByLiveContract = spec.isSuccess(cloneFixturePayload(rawFixture)) === true;
    } catch (err) {
      warnings.push(warning({
        code: 'FIXTURE_IS_SUCCESS_THREW',
        severity: 'error',
        message: `${spec.name}: isSuccess threw for base fixture: ${err?.message ?? err}`,
        field: 'isSuccess',
        suggestion: 'Make the base fixture match live raw response shape or harden isSuccess',
      }));
    }
    if (!acceptedByLiveContract) {
      warnings.push(warning({
        code: 'BASE_FIXTURE_NOT_LIVE_SUCCESS',
        message: `${spec.name}: base fixture is not accepted by the live isSuccess contract`,
        field: 'fixture',
        suggestion: 'This usually means the fixture stores service-facing normalized data; keep it explicit or add a raw fixture',
      }));
    }
  }

  let normalized;
  try {
    normalized = typeof spec.normalize === 'function'
      ? spec.normalize(cloneFixturePayload(rawFixture))
      : { raw: cloneFixturePayload(rawFixture) };
  } catch (err) {
    if (!acceptedByLiveContract && spec.fixtureIsServiceFacing === true) {
      warnings.push(warning({
        code: 'FIXTURE_CLIENT_DATA_DIFFERS',
        message: `${spec.name}: normalized fixture intentionally bypasses the live raw normalizer`,
        field: 'normalize',
        suggestion: 'Keep this intentional difference documented, or split raw endpoint fixtures from service-facing fixtures',
        detail: { normalizeError: err?.code ?? err?.name ?? 'Error' },
      }));
      return;
    }
    warnings.push(warning({
      code: 'FIXTURE_NORMALIZE_THREW',
      severity: 'error',
      message: `${spec.name}: normalize threw for base fixture: ${err?.message ?? err}`,
      field: 'normalize',
      suggestion: 'Make the fixture shape compatible with the endpoint normalizer',
    }));
    return;
  }

  if (normalized === undefined) {
    warnings.push(warning({
      code: 'FIXTURE_NORMALIZE_UNDEFINED',
      severity: 'error',
      message: `${spec.name}: normalize returned undefined for base fixture`,
      field: 'normalize',
      suggestion: 'Return a stable object shape from normalize',
    }));
    return;
  }

  if (!sameJsonShape(rawFixture, normalized)) {
    warnings.push(warning({
      code: 'FIXTURE_CLIENT_DATA_DIFFERS',
      message: `${spec.name}: FixtureEndpointClient would return different data than runEndpoint fixture short-circuit`,
      field: 'normalize',
      suggestion: 'Keep this intentional difference documented, or split raw endpoint fixtures from service-facing fixtures',
    }));
  }
}

export function validateFixtureParity(spec, options = {}) {
  const warnings = [];
  const endpointResult = validateEndpointDiagnostics(spec, warnings);
  if (!spec || typeof spec !== 'object' || typeof spec.name !== 'string') {
    return { valid: false, warnings, endpoint: endpointResult };
  }

  const fixtureNameSet = toFixtureNameSet(options.fixtureNames);
  validateFixtureNames(spec, warnings, fixtureNameSet);

  const lookup = payloadLookup(options.fixturePayloads);
  if (lookup?.has(spec.name)) {
    validateFixturePayload(spec, warnings, lookup.get(spec.name));
  }

  return {
    valid: !warnings.some((item) => item.severity === 'error'),
    warnings,
    endpoint: endpointResult,
  };
}

export function collectFixtureParityDiagnostics(specs, options = {}) {
  return [...specs].map((spec) => ({
    spec,
    name: spec?.name ?? '<unknown>',
    ...validateFixtureParity(spec, options),
  }));
}

export function flattenFixtureParityWarnings(reports) {
  return reports.flatMap((report) =>
    report.warnings.map((item) => ({ endpoint: report.name, ...item })));
}
