/**
 * Endpoint Spec Validator
 *
 * Warning-first diagnostics that catch endpoint authoring mistakes before live
 * Playwright execution. Pure function, no side effects, testable in isolation.
 *
 * Warning Codes
 * ─────────────
 *
 * ## Required Fields (R1)
 * - MISSING_NAME          [error]   Spec must have a string `name`.
 * - MISSING_URL_PATTERN   [error]   Spec must have `urlPattern` for XHR collector.
 *
 * ## Transport Strategy (R2)
 * - AMBIGUOUS_TRANSPORT   [warning] Has `buildPayload` or `apiUrl` but not both.
 *
 * ## Fetch Mode (R3)
 * - SUSPICIOUS_BUILD_PAYLOAD_ARITY [info]    `buildPayload` arity > 2.
 * - INVALID_API_URL       [warning] `apiUrl` should start with `/`.
 * - URL_PATTERN_MISMATCH  [warning] `urlPattern` may not match `apiUrl` path.
 *
 * ## Legacy Mode (R4)
 * - REQUIRED_TRIGGER_MISSING       [error]   `requiredTrigger` is true but no trigger.
 * - TRIGGER_ARITY_SUSPICIOUS       [info]    Trigger function arity looks off.
 * - LEGACY_MISSING_NAV_URL         [warning] Legacy-mode endpoint has no `nav.url`.
 *
 * ## Response Contract (R5)
 * - MISSING_IS_SUCCESS             [warning] No `isSuccess` function.
 * - MISSING_RESPONSE_HANDLERS      [info]    Neither `errorMapper` nor `normalize`.
 * - ERROR_MAPPER_WITHOUT_IS_SUCCESS [warning] `errorMapper` without `isSuccess`.
 *
 * ## Navigation (R6)
 * - INVALID_NAV_URL_TYPE  [error]   `nav.url` must be string or function.
 * - INVALID_READY_EL      [warning] `nav.readyEl` should be a CSS selector string.
 */

/**
 * @param {object} spec       Endpoint spec object (e.g. GOODS_LIST)
 * @param {object} [options]  Reserved for future flags
 * @returns {{ valid: boolean, warnings: Array, strategy: 'fetch'|'legacy'|'ambiguous' }}
 */
export function validateEndpointSpec(spec, options = {}) {
  const warnings = [];

  validateRequiredFields(spec, warnings);
  const strategy = validateTransportStrategy(spec, warnings);

  if (strategy === 'fetch') {
    validateFetchMode(spec, warnings);
  }
  if (strategy === 'legacy') {
    validateLegacyMode(spec, warnings);
  }

  validateResponseContract(spec, warnings);
  validateNavigation(spec, warnings);

  const hasErrors = warnings.some((w) => w.severity === 'error');
  return { valid: !hasErrors, warnings, strategy };
}

// --------------- R1: Required Fields ---------------

function validateRequiredFields(spec, warnings) {
  if (!spec || typeof spec !== 'object') {
    warnings.push({
      code: 'MISSING_NAME',
      severity: 'error',
      message: 'Endpoint spec must be an object with a string name',
      field: 'name',
      suggestion: 'Add name: "domain.action"',
    });
    return;
  }

  if (!spec.name || typeof spec.name !== 'string') {
    warnings.push({
      code: 'MISSING_NAME',
      severity: 'error',
      message: 'Endpoint spec must have a string name',
      field: 'name',
      suggestion: 'Add name: "domain.action"',
    });
  }

  if (!spec.urlPattern) {
    warnings.push({
      code: 'MISSING_URL_PATTERN',
      severity: 'error',
      message: 'Endpoint spec must have urlPattern for XHR collector',
      field: 'urlPattern',
      suggestion: 'Add urlPattern: /your-api-path/',
    });
  }
}

// --------------- R2: Transport Strategy ---------------

function validateTransportStrategy(spec, warnings) {
  if (!spec || typeof spec !== 'object') return 'ambiguous';

  const hasBuildPayload = typeof spec.buildPayload === 'function';
  const hasApiUrl = typeof spec.apiUrl === 'string' && spec.apiUrl.length > 0;

  if (hasBuildPayload && hasApiUrl) return 'fetch';
  if (!hasBuildPayload && !hasApiUrl) return 'legacy';

  const present = hasBuildPayload ? 'buildPayload' : 'apiUrl';
  const missing = hasBuildPayload ? 'apiUrl' : 'buildPayload';

  warnings.push({
    code: 'AMBIGUOUS_TRANSPORT',
    severity: 'warning',
    message: `Endpoint has ${present} but not ${missing}`,
    field: missing,
    suggestion: hasBuildPayload
      ? 'Add apiUrl: "/path/to/api" for fetch mode'
      : 'Add buildPayload: (params, ctx) => ({...}) for fetch mode, or remove apiUrl for legacy mode',
  });

  return 'ambiguous';
}

// --------------- R3: Fetch Mode ---------------

function validateFetchMode(spec, warnings) {
  if (spec.buildPayload.length > 2) {
    warnings.push({
      code: 'SUSPICIOUS_BUILD_PAYLOAD_ARITY',
      severity: 'info',
      message: `buildPayload expects (params, ctx), found ${spec.buildPayload.length} parameters`,
      field: 'buildPayload',
      suggestion: 'Verify function signature matches (params, ctx) => payload',
    });
  }

  if (!spec.apiUrl.startsWith('/')) {
    warnings.push({
      code: 'INVALID_API_URL',
      severity: 'warning',
      message: 'apiUrl should be a path starting with /',
      field: 'apiUrl',
      suggestion: `Change to: apiUrl: "${spec.apiUrl.replace(/^https?:\/\/[^/]+/, '')}"`,
    });
  }

  validateUrlPatternMatchesApiUrl(spec, warnings);
}

function validateUrlPatternMatchesApiUrl(spec, warnings) {
  const apiPath = spec.apiUrl.replace(/^https?:\/\/[^/]+/, '');
  const pathSegments = apiPath.split('/').filter((s) => s.length > 2);
  const patternStr = spec.urlPattern.source ?? String(spec.urlPattern);
  const missingSegments = pathSegments.filter((seg) => !patternStr.includes(seg));

  if (missingSegments.length > 0) {
    warnings.push({
      code: 'URL_PATTERN_MISMATCH',
      severity: 'warning',
      message: `urlPattern may not match apiUrl path: missing segments [${missingSegments.join(', ')}]`,
      field: 'urlPattern',
      suggestion: 'Verify urlPattern regex matches the actual XHR request path',
    });
  }
}

// --------------- R4: Legacy Mode ---------------

function validateLegacyMode(spec, warnings) {
  if (spec.requiredTrigger === true) {
    if (typeof spec.trigger !== 'function') {
      warnings.push({
        code: 'REQUIRED_TRIGGER_MISSING',
        severity: 'error',
        message: 'requiredTrigger is true but trigger function is missing or invalid',
        field: 'trigger',
        suggestion: 'Add trigger: async (page, params, ctx) => { ... } or set requiredTrigger: false',
      });
    } else if (spec.trigger.length < 1) {
      warnings.push({
        code: 'TRIGGER_ARITY_SUSPICIOUS',
        severity: 'info',
        message: `trigger function expects (page, params, ctx), found ${spec.trigger.length} parameters`,
        field: 'trigger',
        suggestion: 'Verify function signature matches (page, params, ctx) => Promise<void>',
      });
    }
  }

  if (!spec.nav || !spec.nav.url) {
    warnings.push({
      code: 'LEGACY_MISSING_NAV_URL',
      severity: 'warning',
      message: 'Legacy-mode endpoint should usually have nav.url for navigation',
      field: 'nav.url',
      suggestion: 'Add nav: { url: "https://..." } or verify XHR fires without navigation',
    });
  }
}

// --------------- R5: Response Contract ---------------

function validateResponseContract(spec, warnings) {
  if (!spec || typeof spec !== 'object') return;

  if (typeof spec.isSuccess !== 'function') {
    warnings.push({
      code: 'MISSING_IS_SUCCESS',
      severity: 'warning',
      message: 'No isSuccess function provided, will default to true (risky)',
      field: 'isSuccess',
      suggestion: 'Add isSuccess: (raw) => raw?.success === true',
    });
  }

  const hasErrorMapper = typeof spec.errorMapper === 'function';
  const hasNormalize = typeof spec.normalize === 'function';

  if (!hasErrorMapper && !hasNormalize) {
    warnings.push({
      code: 'MISSING_RESPONSE_HANDLERS',
      severity: 'info',
      message: 'Neither errorMapper nor normalize provided, responses will return raw body only',
      field: null,
      suggestion: 'Consider adding normalize: (raw) => ({ ... }) to shape the response',
    });
  }

  if (hasErrorMapper && typeof spec.isSuccess !== 'function') {
    warnings.push({
      code: 'ERROR_MAPPER_WITHOUT_IS_SUCCESS',
      severity: 'warning',
      message: 'errorMapper provided but isSuccess missing, error path may not trigger',
      field: 'isSuccess',
      suggestion: 'Add isSuccess function to enable errorMapper invocation',
    });
  }
}

// --------------- R6: Navigation ---------------

function validateNavigation(spec, warnings) {
  if (!spec || typeof spec !== 'object' || !spec.nav) return;

  const urlType = typeof spec.nav.url;
  if (spec.nav.url != null && urlType !== 'string' && urlType !== 'function') {
    warnings.push({
      code: 'INVALID_NAV_URL_TYPE',
      severity: 'error',
      message: `nav.url must be string or function, found ${urlType}`,
      field: 'nav.url',
      suggestion: 'Use nav.url: "https://..." or nav.url: (params, ctx) => "https://..."',
    });
  }

  if (spec.nav.readyEl != null && typeof spec.nav.readyEl !== 'string') {
    warnings.push({
      code: 'INVALID_READY_EL',
      severity: 'warning',
      message: 'nav.readyEl should be a CSS selector string',
      field: 'nav.readyEl',
      suggestion: 'Use nav.readyEl: "button, [class*=list]"',
    });
  }
}
