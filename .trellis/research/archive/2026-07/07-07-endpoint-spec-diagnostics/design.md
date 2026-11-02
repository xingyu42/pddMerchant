# Endpoint Spec Diagnostics — Technical Design

## Problem Statement

Endpoint authoring mistakes currently surface only during live Playwright execution, causing runtime failures that should be caught at development time. The current implicit strategy inference (`buildPayload + apiUrl` → fetch, else → legacy) hides transport semantics inside `PlaywrightEndpointClient` rather than endpoint declarations.

**Failure scenarios discovered**:
1. Ambiguous transport: endpoint has `buildPayload` but no `apiUrl`, causing silent fallback to legacy path
2. Missing `urlPattern`: XHR collector cannot match responses
3. Incomplete fetch-mode dependencies: `apiUrl` without `buildPayload` (or vice versa)
4. `requiredTrigger` without usable `trigger` function
5. Unclear success/error contracts: missing or contradictory `isSuccess`/`errorMapper`/`normalize`

## Design Goals

1. **Warning-first validation** — diagnostics produce actionable warnings, not runtime hard failures
2. **Development-time feedback** — integrate as test helper or CI check, not production enforcement
3. **Strategy-aware rules** — validate fields contextually based on inferred transport mode
4. **Zero behavior change** — `PlaywrightEndpointClient.execute()` remains unchanged
5. **Extensible foundation** — prepare for future strategy resolver (task `07-07-endpoint-strategy-resolver`)

## Architecture

### Core Component

**`validateEndpointSpec(spec, options = {})`**

- **Input**: Endpoint spec object (e.g., `GOODS_LIST`)
- **Output**: `{ valid: boolean, warnings: Warning[], strategy: 'fetch' | 'legacy' | 'ambiguous' }`
- **Location**: New file `src/adapter/endpoint-validator.js` (or `src/adapter/diagnostics/endpoint-spec-validator.js` if diagnostics folder is created)
- **Mode**: Pure function, no side effects, testable in isolation

### Warning Schema

```javascript
{
  code: string,        // e.g., 'AMBIGUOUS_TRANSPORT', 'MISSING_URL_PATTERN'
  severity: string,    // 'error' | 'warning' | 'info'
  message: string,     // Human-readable description
  field: string | null,// Problematic field name
  suggestion: string | null, // Actionable fix
}
```

### Diagnostic Rules

#### R1: Missing Required Fields

```javascript
// Severity: error
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
```

#### R2: Transport Strategy Inference

```javascript
// Match current PlaywrightEndpointClient logic (line 298)
const hasBuildPayload = typeof spec.buildPayload === 'function';
const hasApiUrl = typeof spec.apiUrl === 'string' && spec.apiUrl.length > 0;

let strategy = 'ambiguous';

if (hasBuildPayload && hasApiUrl) {
  strategy = 'fetch';
} else if (!hasBuildPayload && !hasApiUrl) {
  strategy = 'legacy';
} else {
  strategy = 'ambiguous';
  warnings.push({
    code: 'AMBIGUOUS_TRANSPORT',
    severity: 'warning',
    message: `Endpoint has ${hasBuildPayload ? 'buildPayload' : 'apiUrl'} but not both`,
    field: hasBuildPayload ? 'apiUrl' : 'buildPayload',
    suggestion: hasBuildPayload
      ? 'Add apiUrl: "/path/to/api" for fetch mode'
      : 'Add buildPayload: (params, ctx) => ({...}) for fetch mode, or remove apiUrl for legacy mode',
  });
}
```

#### R3: Fetch-Mode Validation

```javascript
if (strategy === 'fetch') {
  // R3.1: buildPayload signature check
  if (spec.buildPayload.length > 2) {
    warnings.push({
      code: 'SUSPICIOUS_BUILD_PAYLOAD_ARITY',
      severity: 'info',
      message: `buildPayload expects (params, ctx), found ${spec.buildPayload.length} parameters`,
      field: 'buildPayload',
      suggestion: 'Verify function signature matches (params, ctx) => payload',
    });
  }

  // R3.2: apiUrl format check
  if (!spec.apiUrl.startsWith('/')) {
    warnings.push({
      code: 'INVALID_API_URL',
      severity: 'warning',
      message: 'apiUrl should be a path starting with /',
      field: 'apiUrl',
      suggestion: `Change to: apiUrl: "${spec.apiUrl.replace(/^https?:\/\/[^/]+/, '')}"`,
    });
  }

  // R3.3: urlPattern should match apiUrl path
  const apiPath = spec.apiUrl.replace(/^https?:\/\/[^/]+/, '');
  // Simple heuristic: extract key path segments
  const pathSegments = apiPath.split('/').filter(s => s.length > 2);
  const patternStr = spec.urlPattern.source || String(spec.urlPattern);
  const missingSegments = pathSegments.filter(seg => !patternStr.includes(seg));
  
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
```

#### R4: Legacy-Mode Validation

```javascript
if (strategy === 'legacy') {
  // R4.1: requiredTrigger check
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

  // R4.2: nav.url presence check (legacy usually navigates)
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
```

#### R5: Response Contract Validation

```javascript
// R5.1: isSuccess presence (critical for error routing)
if (typeof spec.isSuccess !== 'function') {
  warnings.push({
    code: 'MISSING_IS_SUCCESS',
    severity: 'warning',
    message: 'No isSuccess function provided, will default to true (risky)',
    field: 'isSuccess',
    suggestion: 'Add isSuccess: (raw) => raw?.success === true',
  });
}

// R5.2: errorMapper + normalize presence check
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

// R5.3: errorMapper without isSuccess is suspicious
if (hasErrorMapper && typeof spec.isSuccess !== 'function') {
  warnings.push({
    code: 'ERROR_MAPPER_WITHOUT_IS_SUCCESS',
    severity: 'warning',
    message: 'errorMapper provided but isSuccess missing, error path may not trigger',
    field: 'isSuccess',
    suggestion: 'Add isSuccess function to enable errorMapper invocation',
  });
}
```

#### R6: Navigation Contract Validation

```javascript
if (spec.nav) {
  // R6.1: nav.url type check
  const urlType = typeof spec.nav.url;
  if (urlType !== 'string' && urlType !== 'function') {
    warnings.push({
      code: 'INVALID_NAV_URL_TYPE',
      severity: 'error',
      message: `nav.url must be string or function, found ${urlType}`,
      field: 'nav.url',
      suggestion: 'Use nav.url: "https://..." or nav.url: (params, ctx) => "https://..."',
    });
  }

  // R6.2: readyEl should be a selector string
  if (spec.nav.readyEl && typeof spec.nav.readyEl !== 'string') {
    warnings.push({
      code: 'INVALID_READY_EL',
      severity: 'warning',
      message: 'nav.readyEl should be a CSS selector string',
      field: 'nav.readyEl',
      suggestion: 'Use nav.readyEl: "button, [class*=list]"',
    });
  }
}
```

## Integration Points

### 1. Test Helper Integration

```javascript
// test/helpers/validate-endpoints.test.js
import { describe, test } from 'vitest';
import assert from 'node:assert/strict';
import { validateEndpointSpec } from '../../src/adapter/endpoint-validator.js';
import * as goodsEndpoints from '../../src/adapter/endpoints/goods.js';
import * as ordersEndpoints from '../../src/adapter/endpoints/orders.js';
import * as promoEndpoints from '../../src/adapter/endpoints/promo.js';
import * as goodsPublishEndpoints from '../../src/adapter/endpoints/goods-publish.js';

const allEndpoints = [
  ...Object.values(goodsEndpoints).filter(e => e?.name),
  ...Object.values(ordersEndpoints).filter(e => e?.name),
  ...Object.values(promoEndpoints).filter(e => e?.name),
  ...Object.values(goodsPublishEndpoints).filter(e => e?.name),
];

describe('endpoint spec diagnostics', () => {
  test('all endpoint specs pass validation', () => {
    const failures = [];
    
    for (const spec of allEndpoints) {
      const result = validateEndpointSpec(spec);
      const errors = result.warnings.filter(w => w.severity === 'error');
      
      if (errors.length > 0) {
        failures.push({ name: spec.name, errors });
      }
    }
    
    if (failures.length > 0) {
      console.error('Endpoint validation failures:');
      for (const { name, errors } of failures) {
        console.error(`\n${name}:`);
        for (const err of errors) {
          console.error(`  - [${err.code}] ${err.message}`);
          if (err.suggestion) {
            console.error(`    → ${err.suggestion}`);
          }
        }
      }
    }
    
    assert.equal(failures.length, 0, `${failures.length} endpoints have validation errors`);
  });

  test('endpoint specs report warnings', () => {
    const warningsByEndpoint = new Map();
    
    for (const spec of allEndpoints) {
      const result = validateEndpointSpec(spec);
      const warnings = result.warnings.filter(w => w.severity === 'warning');
      
      if (warnings.length > 0) {
        warningsByEndpoint.set(spec.name, warnings);
      }
    }
    
    if (warningsByEndpoint.size > 0) {
      console.warn(`\n${warningsByEndpoint.size} endpoints have warnings (non-blocking):`);
      for (const [name, warnings] of warningsByEndpoint) {
        console.warn(`\n${name}:`);
        for (const w of warnings) {
          console.warn(`  - [${w.code}] ${w.message}`);
        }
      }
    }
    
    // This test always passes but logs warnings for developer awareness
  });
});
```

### 2. CLI Diagnostic Command (Future Enhancement)

```javascript
// bin/pdd-validate-endpoints.js (optional)
import { validateEndpointSpec } from '../src/adapter/endpoint-validator.js';
// ... load all endpoint modules
// ... run validation
// ... exit code 1 if errors found
```

### 3. CI Integration Point

```json
// package.json
{
  "scripts": {
    "test:endpoints": "vitest run test/helpers/validate-endpoints.test.js"
  }
}
```

## Implementation Boundaries

**In scope for this task**:
- Implement `validateEndpointSpec()` with rules R1-R6
- Write unit tests for validator function with synthetic endpoint specs
- Create integration test that validates all existing endpoints
- Document warning codes in validator source

**Out of scope (deferred to follow-up tasks)**:
- Runtime enforcement (diagnostics stay warning-first)
- Explicit strategy field in endpoint specs (handled by `07-07-endpoint-strategy-resolver`)
- Fixture/live parity checks (complex, needs design iteration)
- Automatic spec fixing or code generation

## Testing Strategy

### Unit Tests for Validator

```javascript
// test/endpoint-validator.unit.test.js
describe('validateEndpointSpec', () => {
  test('valid fetch-mode spec passes', () => {
    const spec = {
      name: 'test.fetch',
      urlPattern: /\/api\/test/,
      apiUrl: '/api/test',
      buildPayload: (params) => ({ id: params.id }),
      isSuccess: (raw) => raw.success === true,
    };
    const result = validateEndpointSpec(spec);
    assert.equal(result.valid, true);
    assert.equal(result.strategy, 'fetch');
    assert.equal(result.warnings.filter(w => w.severity === 'error').length, 0);
  });

  test('missing name produces error', () => {
    const spec = { urlPattern: /test/ };
    const result = validateEndpointSpec(spec);
    const errors = result.warnings.filter(w => w.code === 'MISSING_NAME');
    assert.equal(errors.length, 1);
    assert.equal(errors[0].severity, 'error');
  });

  test('ambiguous transport (buildPayload without apiUrl) produces warning', () => {
    const spec = {
      name: 'test.ambiguous',
      urlPattern: /test/,
      buildPayload: () => ({}),
    };
    const result = validateEndpointSpec(spec);
    assert.equal(result.strategy, 'ambiguous');
    const warnings = result.warnings.filter(w => w.code === 'AMBIGUOUS_TRANSPORT');
    assert.equal(warnings.length, 1);
  });

  test('requiredTrigger without trigger produces error', () => {
    const spec = {
      name: 'test.noTrigger',
      urlPattern: /test/,
      requiredTrigger: true,
    };
    const result = validateEndpointSpec(spec);
    const errors = result.warnings.filter(w => w.code === 'REQUIRED_TRIGGER_MISSING');
    assert.equal(errors.length, 1);
  });

  // ... more unit tests for each rule
});
```

### Integration Tests

- Validate all 12+ existing endpoint specs
- Ensure no critical errors in current codebase
- Log warnings for developer review (non-blocking)

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|-----------|
| False positive warnings annoy developers | Low adoption | Make warnings actionable with clear suggestions; classify severity carefully |
| Validator becomes outdated as execution logic evolves | Diagnostics drift from runtime | Co-locate validator rules with strategy inference logic; update together |
| Over-strict validation breaks existing endpoints | Development friction | Warning-first approach; only error on objectively broken specs (missing name, urlPattern) |
| Validator has bugs and misclassifies valid specs | Developer confusion | Comprehensive unit tests; validate against known-good existing endpoints |

## Future Enhancements

1. **Explicit strategy field** (task `07-07-endpoint-strategy-resolver`):
   - Add optional `strategy: 'fetch' | 'legacy'` field to endpoint specs
   - Validator warns if explicit strategy conflicts with inferred strategy
   - Eventually deprecate implicit inference

2. **Fixture/live parity checks**:
   - Validate fixture response shape matches normalize() expectations
   - Check that fixture mode respects strategy-specific semantics

3. **Runtime diagnostic mode**:
   - Optional `PDD_VALIDATE_ENDPOINT_SPECS=1` env var
   - Runs validation on first endpoint execution
   - Logs warnings without blocking (development aid)

4. **Auto-fix suggestions**:
   - CLI tool generates patch files for common warnings
   - `pdd validate-endpoints --fix` mode

## Open Questions

None blocking implementation. Validator design is stable and actionable.

## References

- Parent task: `.trellis/tasks/07-06-scamper-project-optimization-grill/prd.md`
- Current implementation: `src/adapter/endpoint-client.js` lines 298-303 (strategy inference)
- Existing endpoint specs: `src/adapter/endpoints/{goods,orders,promo,goods-publish}.js`
- PBT invariant tests: `test/pbt/run-endpoint.pbt.test.js`
