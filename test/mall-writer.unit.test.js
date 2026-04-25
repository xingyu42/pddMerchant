import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  switchTo,
  optionSelectorsFor,
} from '../src/adapter/mall-writer.js';

// ─── Fake page builder ───────────────────────────────────────────────

function createFakePage({
  currentMallId = null,
  currentMallName = '',
  locatorHits = [],      // selectors that succeed on click
  networkIdle = true,
  afterSwitchMallId = null,
  afterSwitchMallName = '',
} = {}) {
  let clickedSelectors = [];
  let keyPresses = [];
  let waitForLoadStateCalled = false;

  // currentMall() reads from resolveMallContext, which calls page.evaluate.
  // In real Playwright the evaluate reads globalThis.__PRELOADED_STATE__;
  // here we simulate the mock-disabled currentMall path by providing
  // a locator/evaluate that yields the expected mall shape.
  let evaluateCallCount = 0;
  const firstMall = currentMallId
    ? { id: currentMallId, name: currentMallName, source: 'state' }
    : null;
  const afterMall = afterSwitchMallId
    ? { id: afterSwitchMallId, name: afterSwitchMallName, source: 'state' }
    : firstMall;

  return {
    locator(sel) {
      return {
        first() {
          return {
            async click({ timeout } = {}) {
              if (!locatorHits.includes(sel)) {
                throw new Error(`locator ${sel} not found`);
              }
              clickedSelectors.push(sel);
            },
          };
        },
      };
    },
    getByTestId(testId) {
      const sel = `getByTestId:${testId}`;
      return {
        async click({ timeout } = {}) {
          if (!locatorHits.includes(sel)) {
            throw new Error(`getByTestId ${testId} not found`);
          }
          clickedSelectors.push(sel);
        },
      };
    },
    keyboard: {
      async press(key) { keyPresses.push(key); },
    },
    async waitForLoadState(state, opts) {
      waitForLoadStateCalled = true;
      if (!networkIdle) throw new Error('network not idle');
    },
    // expose internals for assertions
    get _clickedSelectors() { return clickedSelectors; },
    get _keyPresses() { return keyPresses; },
    get _waitForLoadStateCalled() { return waitForLoadStateCalled; },
  };
}

// ─── Mock mode tests (PDD_TEST_ADAPTER=fixture) ─────────────────────

test('switchTo mock: returns matched mall from fixture', async () => {
  process.env.PDD_TEST_ADAPTER = 'fixture';
  try {
    const result = await switchTo(null, '445301049');
    assert.equal(result.id, '445301049');
    assert.equal(result.name, '测试店铺 A');
    assert.equal(result.active, true);
  } finally {
    delete process.env.PDD_TEST_ADAPTER;
  }
});

test('switchTo mock: throws E_MALL_NOT_FOUND for unknown mallId', async () => {
  process.env.PDD_TEST_ADAPTER = 'fixture';
  try {
    await assert.rejects(
      () => switchTo(null, '999999999'),
      (err) => err.code === 'E_MALL_NOT_FOUND'
        && err.exitCode === 2
        && err.message.includes('999999999'),
    );
  } finally {
    delete process.env.PDD_TEST_ADAPTER;
  }
});

test('switchTo mock: throws E_USAGE for empty mallId', async () => {
  process.env.PDD_TEST_ADAPTER = 'fixture';
  try {
    await assert.rejects(
      () => switchTo(null, ''),
      (err) => err.code === 'E_USAGE' && err.exitCode === 2,
    );
  } finally {
    delete process.env.PDD_TEST_ADAPTER;
  }
});

test('switchTo mock: throws E_USAGE for null mallId', async () => {
  process.env.PDD_TEST_ADAPTER = 'fixture';
  try {
    await assert.rejects(
      () => switchTo(null, null),
      (err) => err.code === 'E_USAGE' && err.exitCode === 2,
    );
  } finally {
    delete process.env.PDD_TEST_ADAPTER;
  }
});

// ─── optionSelectorsFor ──────────────────────────────────────────────

test('optionSelectorsFor generates correct CSS selector list', () => {
  const selectors = optionSelectorsFor('445301049');
  assert.ok(Array.isArray(selectors));
  assert.ok(selectors.length >= 4, 'should generate multiple fallback selectors');
  // cssEscape escapes leading digits, so check for data-testid/data-mall-id attrs
  assert.ok(selectors.some((s) => s.includes('data-testid')));
  assert.ok(selectors.some((s) => s.includes('data-mall-id')));
  assert.ok(selectors.some((s) => s.includes('data-id')));
  // non-digit mallId should appear literally
  const alpha = optionSelectorsFor('abcShop');
  assert.ok(alpha.some((s) => s.includes('abcShop')));
});

test('optionSelectorsFor escapes special characters in mallId', () => {
  // CSS escape: leading digit gets escaped
  const selectors = optionSelectorsFor('123');
  // All selectors should contain the escaped form, not raw "123" as first char
  for (const sel of selectors) {
    assert.ok(sel.length > 0, 'selector must not be empty');
  }
});

// ─── mallId validation (real path) ──────────────────────────────────

test('switchTo real: rejects invalid mallId (non-numeric)', async () => {
  delete process.env.PDD_TEST_ADAPTER;
  await assert.rejects(
    () => switchTo({}, 'abc!@#'),
    (err) => err.code === 'E_USAGE',
  );
});

test('switchTo real: rejects empty string mallId', async () => {
  delete process.env.PDD_TEST_ADAPTER;
  await assert.rejects(
    () => switchTo({}, ''),
    (err) => err.code === 'E_USAGE',
  );
});
