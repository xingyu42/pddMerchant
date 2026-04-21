// E2E · promo domain
// 覆盖：search / scene（按 scenesType 过滤）/ ddk（V0 占位）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runPdd, assertOkEnvelope, assertFailEnvelope } from './_helpers.js';

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

test('e2e: promo ddk returns placeholder envelope with E_DDK_UNAVAILABLE', () => {
  const { status, envelope } = runPdd(['promo', 'ddk', '--json']);
  // ddk 是占位实现，返回 ok=false 但命令进程退出码由 mapErrorToExit 决定
  assertFailEnvelope(envelope, 'promo.ddk', 'E_DDK_UNAVAILABLE');
  assert.ok(envelope.meta.warnings.some((w) => w.includes('DDK')));
  // E_DDK_UNAVAILABLE 不在已知 code 里，退出码默认 GENERAL=1
  assert.equal(status, 1);
});
