import { describe, it, vi, beforeEach } from 'vitest';
import assert from 'node:assert/strict';
import { property, gen } from './_harness.js';

const endpointState = vi.hoisted(() => ({
  response: { templates: [{ id: 1, name: '模板 1' }] },
  calls: [],
}));

vi.mock('../../src/adapter/run-endpoint.js', () => ({
  runEndpoint: vi.fn(async (_page, meta) => {
    endpointState.calls.push(meta?.name);
    if (meta?.name === 'goods.publish.submit') return { success: true };
    return endpointState.response;
  }),
}));

vi.mock('../../src/adapter/mock-dispatcher.js', () => ({
  isMockEnabled: () => true,
  loadFixture: () => ({
    goods_id: 953009364304,
    goods_commit_id: '191512609758',
    source_goods_id: '918867803697',
    goods_name: '测试商品',
    warnings: [],
  }),
}));

function resetEndpointState(templates = [{ id: 1, name: '模板 1' }]) {
  endpointState.response = { templates };
  endpointState.calls = [];
}

function templateList(ids) {
  return ids.map((id, index) => ({ id, name: `模板 ${index + 1}` }));
}

function hasRawKey(value) {
  if (!value || typeof value !== 'object') return false;
  if (Object.prototype.hasOwnProperty.call(value, 'raw')) return true;
  if (Array.isArray(value)) return value.some(hasRawKey);
  return Object.values(value).some(hasRawKey);
}

describe('goods publish PBT', () => {
  beforeEach(() => {
    resetEndpointState();
  });

  it('omitted template always selects the first normalized template', async () => {
    const { resolvePublishCostTemplate } = await import('../../src/services/goods-publish.js');
    await property(
      'goods publish default template is first',
      gen.arrayOf(gen.int(1, 9_000_000), { minLen: 1, maxLen: 10 }),
      async (ids) => {
        const templates = templateList(ids);
        resetEndpointState(templates);
        const selected = await resolvePublishCostTemplate({ page: {} });
        assert.equal(selected.id, templates[0].id);
      },
      { runs: 50 },
    );
  });

  it('explicit selected template always belongs to normalized list', async () => {
    const { resolvePublishCostTemplate } = await import('../../src/services/goods-publish.js');
    await property(
      'goods publish selected template belongs to list',
      gen.arrayOf(gen.int(1, 9_000_000), { minLen: 1, maxLen: 10 }),
      async (ids, { rng }) => {
        const templates = templateList(ids);
        const requested = templates[Math.floor(rng() * templates.length)].id;
        resetEndpointState(templates);
        const selected = await resolvePublishCostTemplate({ page: {} }, String(requested));
        assert.ok(templates.some(t => String(t.id) === String(selected.id)));
      },
      { runs: 50 },
    );
  });

  it('draft-only mode never triggers submit', async () => {
    const { publishGoodsFromLink } = await import('../../src/services/goods-publish.js');
    await property(
      'goods publish draft-only never submits',
      gen.int(1, 9_000_000),
      async (templateId) => {
        resetEndpointState(templateList([templateId]));
        const result = await publishGoodsFromLink({ page: {} }, '918867803697', { draftOnly: true });
        assert.equal(result.status, 'draft');
        assert.equal(endpointState.calls.includes('goods.publish.submit'), false);
      },
      { runs: 50 },
    );
  });

  it('confirmed mode triggers submit and emits no raw payload fields', async () => {
    const { publishGoodsFromLink } = await import('../../src/services/goods-publish.js');
    await property(
      'goods publish confirmed summary is raw-free',
      gen.int(1, 9_000_000),
      async (templateId) => {
        resetEndpointState(templateList([templateId]));
        const result = await publishGoodsFromLink({ page: {} }, '918867803697', { draftOnly: false });
        assert.equal(result.status, 'submitted');
        assert.ok(endpointState.calls.includes('goods.publish.submit'));
        assert.equal(hasRawKey(result), false);
      },
      { runs: 50 },
    );
  });
});
