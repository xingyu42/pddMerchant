# Endpoint Attempt Lifecycle Extraction — Technical Design

## Problem Statement

`PlaywrightEndpointClient._attemptFetch()` and `_attemptLegacy()` duplicate significant lifecycle code:

**Duplicated concerns** (305-372 vs 374-430):
- Timeout calculation from `ctx.deadline` / `remainingMs()`
- XHR collector creation with pattern/timeout/signal
- Navigation through `pageSession.goto()` or `page.goto()`
- Optional `readyEl` wait with timeout fallback
- Trigger execution with `requiredTrigger` error handling
- Navigation error wrapping (`E_NETWORK`)
- Collector wait + response extraction
- Collector disposal and cleanup

**Different concerns** (fetch-specific):
- Route handler registration/cleanup (`page.route()` / `page.unroute()`)
- Payload merge via `mergePayload(origPostData, payload)`

**Current state**: ~70 lines of lifecycle code duplicated, with ~10 lines of transport-specific differences.

**Design goal**: Extract shared lifecycle into a reusable function, let fetch/legacy provide minimal transport hooks.

## Design Goals

1. **Zero behavior change** — Preserve all invariants from `endpoint-refactor-invariants` task
2. **Duplication reduction** — Extract common lifecycle (timeout, collector, navigation, trigger, cleanup)
3. **Transport isolation** — Keep fetch-specific concerns (route setup/cleanup, payload merge) separate
4. **Minimal abstraction** — Avoid over-general callback patterns; use simple hook functions
5. **Testability** — Extracted lifecycle should be testable independently of strategies
6. **Facade stability** — `PlaywrightEndpointClient` remains the public API; internal refactoring only

## Architecture

### Lifecycle Abstraction

**Core concept**: A single attempt consists of:
1. **Setup phase** — Calculate timeouts, create collector, prepare transport
2. **Execution phase** — Navigate, wait for readyEl, trigger, wait for response
3. **Cleanup phase** — Dispose collector, cleanup transport (route/etc)

**Transport-specific hooks**:
- `prepareTransport(page, meta, params, ctx)` — Fetch: register route; Legacy: no-op
- `cleanupTransport(page, meta)` — Fetch: unregister route; Legacy: no-op

### Extracted Function

**Signature**:
```javascript
async function executeAttempt({
  page,
  meta,
  params,
  ctx,
  log,
  navUrl,
  prepareTransport,
  cleanupTransport,
})
```

**Responsibilities**:
- Calculate timeouts from `meta` + `ctx.deadline`
- Create XHR collector with pattern/timeout/signal
- Call `prepareTransport()` hook (fetch: route setup)
- Navigate (with pageSession if available)
- Wait for `readyEl` (optional, with timeout)
- Execute trigger (with `requiredTrigger` check)
- Wait for collector responses
- Call `cleanupTransport()` in finally block
- Wrap navigation errors as `E_NETWORK`
- Return first response or throw

**Location**: `src/adapter/endpoint-attempt.js` (new file)

---

### Refactored _attemptFetch()

**Before** (67 lines, 305-372):
```javascript
async _attemptFetch(page, meta, params, ctx, log, navUrl) {
  throwIfAborted(ctx.signal);
  const remaining = remainingMs(ctx);
  const navTimeout = Math.min(
    meta.navTimeout ?? TIMEOUTS.QUICK_NAV,
    remaining === 0 ? 1 : (remaining || Infinity),
  );
  const collectorTimeout = Math.min(
    meta.collectorTimeout ?? TIMEOUTS.XHR_COLLECTOR,
    remaining === 0 ? 1 : (remaining || Infinity),
  );

  const payload = meta.buildPayload(params, ctx);
  const routeHandler = async (route) => {
    const origPostData = route.request().postData();
    const merged = mergePayload(origPostData, payload);
    await route.continue({ postData: JSON.stringify(merged) });
  };
  await page.route(meta.urlPattern, routeHandler);

  const collector = createCollector(page, {
    pattern: meta.urlPattern,
    timeout: collectorTimeout,
    signal: ctx.signal,
  });

  try {
    if (navUrl) {
      const pageSession = ctx.pageSession ?? this._pageSession;
      if (pageSession) {
        await pageSession.goto(page, navUrl, {
          waitUntil: meta.nav?.waitUntil ?? 'domcontentloaded',
          timeout: navTimeout,
        });
      } else {
        await page.goto(navUrl, {
          waitUntil: meta.nav?.waitUntil ?? 'domcontentloaded',
          timeout: navTimeout,
        });
      }
    }

    if (meta.nav?.readyEl) {
      try {
        await page.waitForSelector(meta.nav.readyEl, { timeout: TIMEOUTS.ELEMENT_READY });
      } catch {
        log.debug({ endpoint: meta.name, readyEl: meta.nav.readyEl }, 'readyEl not found, continuing');
      }
    }

    await this._runTrigger(meta, page, params, ctx, log, collector);

    const responses = await collector.waitFor();
    return responses[0];
  } catch (err) {
    collector.dispose();
    if (err instanceof PddCliError) throw err;
    throw new PddCliError({
      code: 'E_NETWORK',
      message: `${meta.name}: navigation failed: ${err?.message}`,
      hint: '检查网络连通性或登录态',
      detail: { url: navUrl },
      exitCode: ExitCodes.NETWORK,
    });
  } finally {
    await page.unroute(meta.urlPattern, routeHandler).catch(() => {});
  }
}
```

**After** (15 lines):
```javascript
async _attemptFetch(page, meta, params, ctx, log, navUrl) {
  const payload = meta.buildPayload(params, ctx);
  let routeHandler;

  return executeAttempt({
    page,
    meta,
    params,
    ctx,
    log,
    navUrl,
    prepareTransport: async (page) => {
      routeHandler = async (route) => {
        const origPostData = route.request().postData();
        const merged = mergePayload(origPostData, payload);
        await route.continue({ postData: JSON.stringify(merged) });
      };
      await page.route(meta.urlPattern, routeHandler);
    },
    cleanupTransport: async (page) => {
      if (routeHandler) {
        await page.unroute(meta.urlPattern, routeHandler).catch(() => {});
      }
    },
  });
}
```

**Duplication removed**: 52 lines → shared lifecycle
**Transport-specific**: 13 lines (route setup/cleanup + payload merge)

---

### Refactored _attemptLegacy()

**Before** (56 lines, 374-430):
```javascript
async _attemptLegacy(page, meta, params, ctx, log, navUrl) {
  throwIfAborted(ctx.signal);
  const remaining = remainingMs(ctx);
  const collectorTimeout = Math.min(
    meta.collectorTimeout ?? TIMEOUTS.XHR_COLLECTOR,
    remaining === 0 ? 1 : (remaining || Infinity),
  );
  const collector = createCollector(page, {
    pattern: meta.urlPattern,
    timeout: collectorTimeout,
    signal: ctx.signal,
  });

  const pageSession = ctx.pageSession ?? this._pageSession;
  const navTimeout = Math.min(
    meta.navTimeout ?? TIMEOUTS.QUICK_NAV,
    remaining === 0 ? 1 : (remaining || Infinity),
  );

  try {
    if (navUrl) {
      if (pageSession) {
        await pageSession.goto(page, navUrl, {
          waitUntil: meta.nav?.waitUntil ?? 'domcontentloaded',
          timeout: navTimeout,
        });
      } else {
        await page.goto(navUrl, {
          waitUntil: meta.nav?.waitUntil ?? 'domcontentloaded',
          timeout: navTimeout,
        });
      }
    }

    if (meta.nav?.readyEl) {
      try {
        await page.waitForSelector(meta.nav.readyEl, { timeout: TIMEOUTS.ELEMENT_READY });
      } catch {
        log.debug({ endpoint: meta.name, readyEl: meta.nav.readyEl }, 'readyEl not found, continuing');
      }
    }

    await this._runTrigger(meta, page, params, ctx, log, collector);
  } catch (err) {
    collector.dispose();
    if (err instanceof PddCliError) throw err;
    throw new PddCliError({
      code: 'E_NETWORK',
      message: `${meta.name}: navigation failed: ${err?.message}`,
      hint: '检查网络连通性或登录态',
      detail: { url: navUrl },
      exitCode: ExitCodes.NETWORK,
    });
  }

  const responses = await collector.waitFor();
  return responses[0];
}
```

**After** (8 lines):
```javascript
async _attemptLegacy(page, meta, params, ctx, log, navUrl) {
  return executeAttempt({
    page,
    meta,
    params,
    ctx,
    log,
    navUrl,
    prepareTransport: async () => {}, // no-op
    cleanupTransport: async () => {},  // no-op
  });
}
```

**Duplication removed**: 48 lines → shared lifecycle
**Transport-specific**: 0 lines (legacy has no transport setup)

---

## Implementation Design

### File Structure

**New file**: `src/adapter/endpoint-attempt.js`
```javascript
import { createCollector } from './xhr-collector.js';
import { PddCliError, ExitCodes } from '../infra/errors.js';
import { TIMEOUTS } from '../infra/timeouts.js';
import { throwIfAborted, remainingMs } from '../infra/abort.js';

/**
 * Execute a single endpoint attempt with shared lifecycle.
 * 
 * @param {object} config
 * @param {object} config.page - Playwright page
 * @param {object} config.meta - Endpoint spec
 * @param {object} config.params - Request params
 * @param {object} config.ctx - Execution context
 * @param {object} config.log - Logger
 * @param {string} config.navUrl - Navigation URL (resolved)
 * @param {function} config.prepareTransport - Setup hook (e.g., route registration)
 * @param {function} config.cleanupTransport - Cleanup hook (e.g., route unregistration)
 * @param {function} config.runTrigger - Trigger execution function
 * @returns {Promise<Response>} First XHR response matching urlPattern
 */
export async function executeAttempt({
  page,
  meta,
  params,
  ctx,
  log,
  navUrl,
  prepareTransport,
  cleanupTransport,
  runTrigger,
}) {
  throwIfAborted(ctx.signal);

  // Calculate timeouts
  const remaining = remainingMs(ctx);
  const navTimeout = Math.min(
    meta.navTimeout ?? TIMEOUTS.QUICK_NAV,
    remaining === 0 ? 1 : (remaining || Infinity),
  );
  const collectorTimeout = Math.min(
    meta.collectorTimeout ?? TIMEOUTS.XHR_COLLECTOR,
    remaining === 0 ? 1 : (remaining || Infinity),
  );

  // Prepare transport (fetch: route setup; legacy: no-op)
  await prepareTransport(page, meta, params, ctx);

  // Create collector
  const collector = createCollector(page, {
    pattern: meta.urlPattern,
    timeout: collectorTimeout,
    signal: ctx.signal,
  });

  try {
    // Navigate
    if (navUrl) {
      const pageSession = ctx.pageSession;
      if (pageSession) {
        await pageSession.goto(page, navUrl, {
          waitUntil: meta.nav?.waitUntil ?? 'domcontentloaded',
          timeout: navTimeout,
        });
      } else {
        await page.goto(navUrl, {
          waitUntil: meta.nav?.waitUntil ?? 'domcontentloaded',
          timeout: navTimeout,
        });
      }
    }

    // Wait for readyEl
    if (meta.nav?.readyEl) {
      try {
        await page.waitForSelector(meta.nav.readyEl, { timeout: TIMEOUTS.ELEMENT_READY });
      } catch {
        log.debug({ endpoint: meta.name, readyEl: meta.nav.readyEl }, 'readyEl not found, continuing');
      }
    }

    // Execute trigger
    await runTrigger(page, meta, params, ctx, log, collector);

    // Wait for response
    const responses = await collector.waitFor();
    return responses[0];
  } catch (err) {
    collector.dispose();
    if (err instanceof PddCliError) throw err;
    throw new PddCliError({
      code: 'E_NETWORK',
      message: `${meta.name}: navigation failed: ${err?.message}`,
      hint: '检查网络连通性或登录态',
      detail: { url: navUrl },
      exitCode: ExitCodes.NETWORK,
    });
  } finally {
    await cleanupTransport(page, meta).catch(() => {});
  }
}
```

---

### Modified endpoint-client.js

**Import addition**:
```javascript
import { executeAttempt } from './endpoint-attempt.js';
```

**Keep `_runTrigger()` in client** (used by both strategies):
```javascript
// No change to _runTrigger() implementation
// It stays in PlaywrightEndpointClient for now
```

**Refactored `_attemptFetch()`**:
```javascript
async _attemptFetch(page, meta, params, ctx, log, navUrl) {
  const payload = meta.buildPayload(params, ctx);
  let routeHandler;

  return executeAttempt({
    page,
    meta,
    params,
    ctx,
    log,
    navUrl,
    prepareTransport: async (page) => {
      routeHandler = async (route) => {
        const origPostData = route.request().postData();
        const merged = mergePayload(origPostData, payload);
        await route.continue({ postData: JSON.stringify(merged) });
      };
      await page.route(meta.urlPattern, routeHandler);
    },
    cleanupTransport: async (page) => {
      if (routeHandler) {
        await page.unroute(meta.urlPattern, routeHandler).catch(() => {});
      }
    },
    runTrigger: this._runTrigger.bind(this),
  });
}
```

**Refactored `_attemptLegacy()`**:
```javascript
async _attemptLegacy(page, meta, params, ctx, log, navUrl) {
  return executeAttempt({
    page,
    meta,
    params,
    ctx,
    log,
    navUrl,
    prepareTransport: async () => {},
    cleanupTransport: async () => {},
    runTrigger: this._runTrigger.bind(this),
  });
}
```

---

## Invariant Preservation

**From `endpoint-refactor-invariants` task**, these must remain stable:

| Invariant ID | Preservation Strategy |
|--------------|----------------------|
| INV-001 (nav.url one-time eval) | `navUrl` resolved once in `_executeWithRetry()`, passed to `executeAttempt()` |
| INV-003 (429 retry count) | Retry loop in `_executeWithRetry()`, unchanged |
| INV-007 (abort signal) | `throwIfAborted()` first line of `executeAttempt()` |
| INV-008 (timeout deadline) | Timeout calculation in `executeAttempt()` matches current logic |
| INV-009 (route cleanup on nav fail) | `cleanupTransport()` in finally block |
| INV-010 (route cleanup on collector timeout) | `cleanupTransport()` in finally block |
| INV-011 (collector disposal on trigger fail) | `collector.dispose()` in catch block, before re-throw |

**Verification**: Run all invariant tests after extraction to confirm zero drift.

---

## Testing Strategy

### Unit Tests for executeAttempt

**File**: `test/endpoint-attempt.unit.test.js` (new)

```javascript
import { test, describe } from 'vitest';
import assert from 'node:assert/strict';
import { executeAttempt } from '../src/adapter/endpoint-attempt.js';

function createMockPage({ navSucceeds = true, hasReadyEl = true, responses = [] } = {}) {
  const listeners = [];
  return {
    on: (evt, fn) => { if (evt === 'response') listeners.push(fn); },
    off: (evt, fn) => {
      if (evt === 'response') {
        const idx = listeners.indexOf(fn);
        if (idx >= 0) listeners.splice(idx, 1);
      }
    },
    goto: async (url) => {
      if (!navSucceeds) throw new Error('nav failed');
      // Simulate XHR responses after nav
      queueMicrotask(() => {
        for (const resp of responses) {
          for (const l of listeners) l(resp);
        }
      });
    },
    waitForSelector: async (selector) => {
      if (!hasReadyEl) throw new Error('selector not found');
    },
    url: () => 'http://fake',
  };
}

describe('executeAttempt', () => {
  test('successful attempt returns first response', async () => {
    const mockResp = {
      url: () => 'http://fake/api/test',
      status: () => 200,
      text: async () => JSON.stringify({ success: true }),
      json: async () => ({ success: true }),
    };
    
    const page = createMockPage({ responses: [mockResp] });
    const meta = {
      name: 'test.success',
      urlPattern: /api\/test/,
      nav: { url: 'http://fake/api/test' },
    };
    
    let preparedCalled = false;
    let cleanedCalled = false;
    
    const response = await executeAttempt({
      page,
      meta,
      params: {},
      ctx: {},
      log: { debug: () => {} },
      navUrl: 'http://fake/api/test',
      prepareTransport: async () => { preparedCalled = true; },
      cleanupTransport: async () => { cleanedCalled = true; },
      runTrigger: async () => {},
    });
    
    assert.ok(response);
    assert.equal(response.status(), 200);
    assert.ok(preparedCalled, 'prepareTransport should be called');
    assert.ok(cleanedCalled, 'cleanupTransport should be called in finally');
  });

  test('navigation failure disposes collector and calls cleanup', async () => {
    const page = createMockPage({ navSucceeds: false });
    const meta = {
      name: 'test.navFail',
      urlPattern: /test/,
      nav: { url: 'http://fake/test' },
    };
    
    let cleanedCalled = false;
    
    await assert.rejects(
      () => executeAttempt({
        page,
        meta,
        params: {},
        ctx: {},
        log: { debug: () => {} },
        navUrl: 'http://fake/test',
        prepareTransport: async () => {},
        cleanupTransport: async () => { cleanedCalled = true; },
        runTrigger: async () => {},
      }),
      (err) => err.code === 'E_NETWORK',
    );
    
    assert.ok(cleanedCalled, 'cleanupTransport should be called even on failure');
  });

  test('readyEl failure is non-fatal', async () => {
    const mockResp = {
      url: () => 'http://fake/test',
      status: () => 200,
      text: async () => '{}',
      json: async () => ({}),
    };
    
    const page = createMockPage({ hasReadyEl: false, responses: [mockResp] });
    const meta = {
      name: 'test.noReadyEl',
      urlPattern: /test/,
      nav: { url: 'http://fake/test', readyEl: '.missing' },
    };
    
    const response = await executeAttempt({
      page,
      meta,
      params: {},
      ctx: {},
      log: { debug: () => {} },
      navUrl: 'http://fake/test',
      prepareTransport: async () => ,
      cleanupTransport: async () => {},
      runTrigger: async () => {},
    });
    
    assert.ok(response, 'should succeed even if readyEl not found');
  });
});
```

### Integration Tests (Reuse Existing)

**Existing tests already cover**:
- `test/pbt/run-endpoint.pbt.test.js` — PBT invariants (nav.url eval, retry count, etc.)
- `test/run-endpoint.unit.test.js` — Focused unit tests (error mapping, etc.)
- `test/endpoint-route-cleanup.unit.test.js` — Route cleanup invariants (from `refactor-invariants`)

**Action**: Run all existing tests after extraction to verify zero behavior change.

---

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Extracted lifecycle diverges from original | Behavior regression | Run all invariant tests; keep extraction mechanical (copy-paste + minimal refactor) |
| Transport hooks become over-general | Abstraction complexity | Keep hooks minimal (prepare + cleanup only); no mid-execution hooks |
| `runTrigger` stays in client, creates coupling | Mixed responsibility | Accept trade-off for Phase 1; consider extracting trigger logic in Phase 2 if needed |
| Tests fail due to subtle timing changes | False confidence or blockage | Verify tests with real Playwright pages, not just mocks |

---

## Implementation Phases

### Phase 1: Extract Shared Lifecycle (This Task)

**Steps**:
1. Create `src/adapter/endpoint-attempt.js` with `executeAttempt()` function
2. Refactor `_attemptFetch()` to use `executeAttempt()` with route hooks
3. Refactor `_attemptLegacy()` to use `executeAttempt()` with no-op hooks
4. Keep `_runTrigger()` in `PlaywrightEndpointClient` (pass as arg to `executeAttempt`)
5. Run all invariant tests to verify zero behavior change
6. Add unit tests for `executeAttempt()` edge cases

**Deliverables**:
- `src/adapter/endpoint-attempt.js` (~80 lines)
- Modified `src/adapter/endpoint-client.js` (_attemptFetch and _attemptLegacy)
- `test/endpoint-attempt.unit.test.js` (new, ~100 lines)

**Validation**: All ~930 tests pass, including all 13 invariants from `refactor-invariants`.

---

### Phase 2: Extract Trigger Logic (Optional Follow-Up)

If `_runTrigger()` coupling becomes problematic:
- Extract trigger logic to `src/adapter/endpoint-trigger.js`
- Make it a standalone function `executeTrigger(page, meta, params, ctx, log, collector)`
- Remove from `PlaywrightEndpointClient`

**Deferred** — Only if needed; current design keeps trigger in client for simplicity.

---

### Phase 3: Strategy Pattern (Future)

If more strategies are added (WebSocket, gRPC):
- Formalize transport hooks as strategy interface
- Move fetch/legacy to separate strategy files
- Make client a pure orchestrator

**Deferred** — Requires OpenSpec proposal.

---

## Success Criteria

- [ ] `executeAttempt()` function exists in `src/adapter/endpoint-attempt.js`
- [ ] `_attemptFetch()` reduced to ~15 lines (uses `executeAttempt` with route hooks)
- [ ] `_attemptLegacy()` reduced to ~8 lines (uses `executeAttempt` with no-op hooks)
- [ ] All 13 invariants from `refactor-invariants` task pass
- [ ] New unit tests for `executeAttempt()` cover navigation/readyEl/trigger edge cases
- [ ] Full test suite passes (~930 tests)
- [ ] Zero behavior change verified by existing endpoint tests

---

## Open Questions

**Q1**: Should `_runTrigger()` be extracted from client?
**A1**: Defer to Phase 2. Current design keeps it in client to minimize change surface.

**Q2**: Should transport hooks receive additional context (e.g., `collector`)?
**A2**: No. Keep hooks minimal. Cleanup hook only needs `page` and `meta`.

---

## References

- Parent task: `.trellis/tasks/07-06-scamper-project-optimization-grill/prd.md`
- Current implementation: `src/adapter/endpoint-client.js:305-430`
- Invariant tests: `test/pbt/run-endpoint.pbt.test.js`, `test/endpoint-route-cleanup.unit.test.js`
- Prerequisite tasks: `endpoint-spec-diagnostics` (done), `endpoint-refactor-invariants` (in progress), `endpoint-strategy-resolver` (pending)
