import assert from 'node:assert/strict';
import { existsSync, lstatSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'vitest';
import { GOODS_PUBLISH_SOURCE_CACHE_DIR, SCRAPE_COOLDOWN_PATH } from '../../src/infra/paths.js';
import { COST_TEMPLATE_VIEW_FIELDS } from '../../src/services/views/goods.js';
import { PUBLISH_VIEW_FIELDS } from '../../src/services/views/goods-publish.js';
import {
  createFactFixtures,
  createPublishFixtures,
  createSyntheticPublishProperty,
  createSyntheticPublishSource,
} from '../fixtures/test-data.js';
import { runCli } from '../helpers/isolated-cli.js';

function snapshotDir(dirPath) {
  if (!existsSync(dirPath)) return null;
  return readdirSync(dirPath).sort().map((name) => {
    const stat = lstatSync(join(dirPath, name));
    return { name, mtimeMs: stat.mtimeMs, size: stat.size };
  });
}

function snapshotFile(filePath) {
  if (!existsSync(filePath)) return null;
  const stat = lstatSync(filePath);
  return { mtimeMs: stat.mtimeMs, size: stat.size };
}

describe('goods templates and goods publish fixture E2E', () => {
  it('lists cost templates in v2 shape and handles empty template lists', () => {
    const populated = runCli(['goods', 'templates'], { fixtures: createFactFixtures() });
    assert.equal(populated.status, 0, populated.stderr);
    assert.equal(populated.envelope.command, 'goods.templates');
    assert.equal(populated.envelope.data.total, 2);
    assert.equal(populated.envelope.data.mall_id, '900001');
    for (const item of populated.envelope.data.items) {
      assert.deepEqual(Object.keys(item).sort(), [...COST_TEMPLATE_VIEW_FIELDS].sort());
    }
    assert.deepEqual(populated.envelope.data.items.map((item) => item.template_id), ['3001', '3002']);

    const empty = runCli(['goods', 'templates'], {
      fixtures: { 'endpoints/goods.publish.cost_template_list.json': { cost_template_list: [] } },
    });
    assert.equal(empty.status, 0, empty.stderr);
    assert.equal(empty.envelope.data.total, 0);
    assert.deepEqual(empty.envelope.data.items, []);
    assert.deepEqual(empty.envelope.data.headline, ['当前店铺没有运费模板']);
  });

  it('runs deep fixture publish in draft-only mode without touching real disk cache or cooldown files', () => {
    const beforeCache = snapshotDir(GOODS_PUBLISH_SOURCE_CACHE_DIR);
    const beforeCooldown = snapshotFile(SCRAPE_COOLDOWN_PATH);

    const result = runCli(
      ['goods', 'publish', '--url', 'https://mobile.yangkeduo.com/goods.html?goods_id=123456', '--cost-template', '3002'],
      { fixtures: { ...createFactFixtures(), ...createPublishFixtures() } },
    );

    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.envelope.command, 'goods.publish');
    assert.deepEqual(Object.keys(result.envelope.data).sort(), [...PUBLISH_VIEW_FIELDS].sort());
    assert.equal(result.envelope.data.goods_id, '5001');
    assert.equal(result.envelope.data.goods_commit_id, '7001');
    assert.equal(result.envelope.data.source_goods_id, '123456');
    assert.equal(result.envelope.data.status, '草稿');
    assert.equal(result.envelope.data.cost_template_id, '3002');
    assert.equal(result.envelope.data.source_title, 'Synthetic Cotton Tee');
    assert.equal(result.envelope.data.category_path, '服饰 > 女装 > T恤');
    assert.deepEqual(result.envelope.data.property_mapping, { mapped_count: 2, skipped_count: 0 });
    assert.equal(result.envelope.data.sku_preview_count, 2);
    assert.equal(result.envelope.data.image_transform_enabled, false);
    assert.equal(result.envelope.data.mall_id, '900001');
    assert.deepEqual(result.envelope.meta.warnings, []);

    assert.deepEqual(snapshotDir(GOODS_PUBLISH_SOURCE_CACHE_DIR), beforeCache);
    assert.deepEqual(snapshotFile(SCRAPE_COOLDOWN_PATH), beforeCooldown);
  });

  it('submits on --confirm and surfaces submit errorMapper hint on platform rejection', () => {
    const submitted = runCli(
      ['goods', 'publish', '--url', '123456', '--confirm'],
      { fixtures: { ...createFactFixtures(), ...createPublishFixtures() } },
    );
    assert.equal(submitted.status, 0, submitted.stderr);
    assert.equal(submitted.envelope.data.status, '已提交');
    assert.equal(submitted.envelope.data.category_path, '服饰 > 女装 > T恤');
    assert.deepEqual(submitted.envelope.data.property_mapping, { mapped_count: 2, skipped_count: 0 });

    const rejected = runCli(
      ['goods', 'publish', '--url', '123456', '--confirm'],
      {
        fixtures: {
          ...createFactFixtures(),
          ...createPublishFixtures({
            'endpoints/goods.publish.submit.json': { success: false, error_code: 9876 },
          }),
        },
      },
    );
    assert.equal(rejected.status, 6);
    assert.equal(rejected.envelope.ok, false);
    assert.equal(rejected.envelope.error.code, 'E_BUSINESS');
    assert.equal(rejected.envelope.error.hint, '保存草稿已完成，但提交发布被平台拒绝');
    assert.equal(rejected.envelope.error.detail.stage, 'submit_draft');
  });

  it('propagates property_mapping_partial and draft_verification_unavailable warnings into meta.warnings', () => {
    const result = runCli(['goods', 'publish', '--url', '123456'], {
      fixtures: {
        ...createFactFixtures(),
        ...createPublishFixtures({
          'goods-publish/source.json': createSyntheticPublishSource({
            goodsProperties: [
              { name: '面料俗称', values: ['棉'], refPid: '101', referenceId: '1' },
              { name: '可选属性', values: ['不存在的值'], refPid: '999', referenceId: '9' },
            ],
          }),
          'goods-publish/dynamic-template.json': {
            steps: [[createSyntheticPublishProperty(1009, 2009, '999', '可选属性', ['棉'], { required: false })]],
          },
          'goods-publish/draft-detail.json': { success: false, error_code: 5000 },
        }),
      },
    });

    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(result.envelope.data.property_mapping, { mapped_count: 1, skipped_count: 1 });
    assert.deepEqual(
      result.envelope.meta.warnings,
      ['property_mapping_partial', 'draft_verification_unavailable'],
    );
  });

  it('enforces pre-draft planning, outbound payload guard, and usage validation in fixture mode', () => {
    const badUrl = runCli(['goods', 'publish', '--url', 'not-a-valid-url']);
    assert.equal(badUrl.status, 2);
    assert.equal(badUrl.envelope.error.code, 'E_USAGE');

    const badCostTemplate = runCli(['goods', 'publish', '--url', '123456', '--cost-template', '9999'], {
      fixtures: { ...createFactFixtures(), ...createPublishFixtures() },
    });
    assert.equal(badCostTemplate.status, 2);
    assert.equal(badCostTemplate.envelope.error.code, 'E_USAGE');

    const missingProps = runCli(['goods', 'publish', '--url', '123456'], {
      fixtures: {
        ...createFactFixtures(),
        ...createPublishFixtures({
          'goods-publish/source.json': createSyntheticPublishSource({ goodsProperties: [] }),
        }),
      },
    });
    assert.equal(missingProps.status, 6);
    assert.equal(missingProps.envelope.error.code, 'E_BUSINESS');
    assert.equal(missingProps.envelope.error.detail.stage, 'plan_pre_draft');

    const badPayload = runCli(['goods', 'publish', '--url', '123456'], {
      fixtures: {
        ...createFactFixtures(),
        ...createPublishFixtures({
          'goods-publish/edit-payload.json': { goods_name: '' },
        }),
      },
    });
    assert.equal(badPayload.status, 6);
    assert.equal(badPayload.envelope.error.code, 'E_BUSINESS');
    assert.equal(badPayload.envelope.error.detail.stage, 'populate_and_save_draft');
  });
});
