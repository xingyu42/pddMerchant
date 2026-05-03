// E2E · promo domain
// 覆盖：search / scene（按 scenesType 过滤）
// 注：V0.2 移除 ddk 子命令（详见 openspec/changes/archive/*-remove-promo-ddk）
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { runPdd, assertOkEnvelope } from './_helpers.js';

test('e2e: promo search filters fixture entities by scenesType=1', () => {
  const { status, envelope, stderr } = runPdd(['promo', 'search', '--json']);
  assert.equal(status, 0, `stderr: ${stderr}`);
  assertOkEnvelope(envelope, 'promo.search');
  assert.equal(envelope.data.count, 1);
  assert.equal(envelope.data.entities[0].scenesType, 1);
  assert.equal(envelope.data.entities[0].promotionType, 'search');
});

test('e2e: promo scene filters fixture entities by scenesType=2', () => {
  const { status, envelope } = runPdd(['promo', 'scene', '--json']);
  assert.equal(status, 0);
  assertOkEnvelope(envelope, 'promo.scene');
  assert.equal(envelope.data.count, 1);
  assert.equal(envelope.data.entities[0].scenesType, 2);
  assert.equal(envelope.data.entities[0].promotionType, 'scene');
});

test('e2e: promo roi --json returns ROI analysis envelope', () => {
  const { status, envelope, stderr } = runPdd(['promo', 'roi', '--json']);
  assert.equal(status, 0, `stderr: ${stderr}`);
  assertOkEnvelope(envelope, 'promo.roi');
  assert.equal(envelope.data.by, 'plan');
  assert.ok(Array.isArray(envelope.data.rows));
  assert.ok(typeof envelope.data.summary === 'object');
  assert.ok(typeof envelope.data.summary.total_rows === 'number');
  assert.ok(typeof envelope.data.summary.overall_roi === 'number' || envelope.data.summary.overall_roi === null);
});
