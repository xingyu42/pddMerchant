// E2E · promo domain
// 注：search/scene 推广已合并为「商品推广」（scenesType=9），对应命令已废弃删除。
// 注：V0.2 移除 ddk 子命令（详见 openspec/changes/archive/*-remove-promo-ddk）
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { runPdd, assertOkEnvelope } from './_helpers.js';

test('e2e: promo roi --json returns ROI analysis envelope', () => {
  const { status, envelope, stderr } = runPdd(['promo', 'roi', '--json']);
  assert.equal(status, 0, `stderr: ${stderr}`);
  assertOkEnvelope(envelope, 'promo.roi');
  assert.equal(envelope.data.by, 'plan');
  assert.ok(Array.isArray(envelope.data.rows));
  // fixture 有 2 条推广计划，分组后应非空（验证 normalize 真正走通 raw 结构）
  assert.ok(envelope.data.rows.length > 0, `expected rows from fixture, got ${envelope.data.rows.length}`);
  assert.ok(typeof envelope.data.summary === 'object');
  assert.ok(typeof envelope.data.summary.total_rows === 'number');
  assert.equal(envelope.data.summary.total_spend, 1300); // 拍平后的裸数字
  assert.ok(typeof envelope.data.summary.overall_roi === 'number' || envelope.data.summary.overall_roi === null);
});