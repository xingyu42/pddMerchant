// E2E · shops domain
// 数据来源 test/fixtures/shops.{list,current}.json
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { runPdd, assertOkEnvelope } from './_helpers.js';

test('e2e: shops list returns fixture mall array with active flag', () => {
  const { status, envelope, stderr } = runPdd(['shops', 'list', '--json']);
  assert.equal(status, 0, `exit=${status}, stderr=${stderr}`);
  assertOkEnvelope(envelope, 'shops.list');
  assert.ok(Array.isArray(envelope.data), 'data must be array');
  assert.equal(envelope.data.length, 2);
  const active = envelope.data.filter((m) => m.active === true);
  assert.equal(active.length, 1, '只有一家店铺 active=true');
  assert.equal(active[0].id, '445301049');
});

test('e2e: shops current returns fixture mall object', () => {
  const { status, envelope } = runPdd(['shops', 'current', '--json']);
  assert.equal(status, 0);
  assertOkEnvelope(envelope, 'shops.current');
  assert.equal(envelope.data.id, '445301049');
  assert.equal(envelope.data.name, '测试店铺 A');
});
