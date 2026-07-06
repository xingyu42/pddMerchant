import { test } from 'vitest';
import assert from 'node:assert/strict';
import { mergePayload } from '../src/adapter/endpoint-client.js';

// ---------- mergePayload: A 方案超集合并 ----------

test('mergePayload: preserves crawlerInfo from page original payload', () => {
  const orig = JSON.stringify({
    crawlerInfo: '0asAfxPageGeneratedSignature',
    clientType: 1,
    entityId: 684131980,
  });
  const payload = {
    clientType: 1,
    entityId: 684131980,
    reportPromotionType: 9,
    startDate: '2026-06-01',
    endDate: '2026-06-15',
  };
  const merged = mergePayload(orig, payload);
  assert.equal(merged.crawlerInfo, '0asAfxPageGeneratedSignature');
  assert.equal(merged.reportPromotionType, 9);
  assert.equal(merged.startDate, '2026-06-01');
});

test('mergePayload: buildPayload fields override page same-name fields', () => {
  const orig = JSON.stringify({
    crawlerInfo: 'sig',
    startDate: '2026-01-01',  // 页面填的旧日期
    queryRange: { pageNumber: 1, pageSize: 10, crawlerInfo: 'nested-sig' },
  });
  const payload = {
    startDate: '2026-06-15',  // 业务要的新日期，必须覆盖
    queryRange: { pageNumber: 2, pageSize: 50 },
  };
  const merged = mergePayload(orig, payload);
  assert.equal(merged.startDate, '2026-06-15');
  assert.equal(merged.queryRange.pageNumber, 2);
  assert.equal(merged.queryRange.pageSize, 50);
  assert.equal(merged.queryRange.crawlerInfo, 'nested-sig');
  assert.equal(merged.crawlerInfo, 'sig');
});

test('mergePayload: nested arrays are replaced instead of merged', () => {
  const orig = JSON.stringify({ filters: { ids: [1, 2], crawlerInfo: 'sig' } });
  const payload = { filters: { ids: [3] } };
  const merged = mergePayload(orig, payload);
  assert.deepEqual(merged.filters.ids, [3]);
  assert.equal(merged.filters.crawlerInfo, 'sig');
});

test('mergePayload: null/empty origPostData → payload as-is', () => {
  const payload = { a: 1, b: 2 };
  assert.deepEqual(mergePayload(null, payload), payload);
  assert.deepEqual(mergePayload(undefined, payload), payload);
  assert.deepEqual(mergePayload('', payload), payload);
});

test('mergePayload: non-JSON body (multipart) → payload as-is (fallback to replace mode)', () => {
  const payload = { a: 1 };
  assert.deepEqual(mergePayload('------WebKitFormBoundary...not-json...', payload), payload);
  assert.deepEqual(mergePayload('plain text body', payload), payload);
});

test('mergePayload: array origPayload → payload as-is (arrays not merged)', () => {
  const payload = { a: 1 };
  assert.deepEqual(mergePayload('[1,2,3]', payload), payload);
});

test('mergePayload: orig with extra unknown fields → all preserved', () => {
  const orig = JSON.stringify({
    crawlerInfo: 'sig',
    unknownPageField: 'page-only-state',
    anotherPageField: 42,
  });
  const payload = { businessField: 'x' };
  const merged = mergePayload(orig, payload);
  assert.equal(merged.crawlerInfo, 'sig');
  assert.equal(merged.unknownPageField, 'page-only-state');
  assert.equal(merged.anotherPageField, 42);
  assert.equal(merged.businessField, 'x');
});

test('mergePayload: JSON parse error does not throw, returns payload', () => {
  const payload = { a: 1 };
  // 不应抛异常
  const result = mergePayload('{invalid json', payload);
  assert.deepEqual(result, payload);
});
