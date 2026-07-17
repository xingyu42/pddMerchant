import { afterEach, describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSourceGoodsCache } from '../src/services/goods-publish-source-cache.js';
import { GOODS_PUBLISH_SOURCE_CACHE_DIR, PROJECT_ROOT } from '../src/infra/paths.js';

const GOODS_ID = '918867803697';
const temporaryRoots = [];

function sourceData(overrides = {}) {
  return {
    goodsID: GOODS_ID,
    goodsName: '测试商品',
    catID: '15000',
    catID1: '100',
    catID2: '200',
    catID3: '15000',
    price: '19.90',
    sourceReferencePriceCents: 3990,
    carousel: ['https://img.pddpic.com/carousel.jpg'],
    skuText: '颜色分类\n红色',
    skuDimensions: [
      { name: '颜色分类', values: [{ id: 'red', text: '红色' }] },
    ],
    skus: [{
      sourceSkuId: 'sku-red',
      specValues: { 颜色分类: '红色' },
      sourcePriceCents: 1990,
      sourceNormalPriceCents: 2190,
      stock: 8,
    }],
    properties: '品牌: 测试',
    detailImgs: ['https://img.pddpic.com/detail.jpg'],
    ...overrides,
  };
}

async function temporaryCache() {
  const cacheDir = await mkdtemp(join(tmpdir(), 'pdd-source-cache-'));
  temporaryRoots.push(cacheDir);
  return { cacheDir, cache: createSourceGoodsCache({ cacheDir }) };
}

afterEach(async () => {
  while (temporaryRoots.length > 0) {
    await rm(temporaryRoots.pop(), { recursive: true, force: true });
  }
});

describe('goods publish source cache', () => {
  it('uses an isolated folder under the repository tmp directory by default', () => {
    assert.equal(
      GOODS_PUBLISH_SOURCE_CACHE_DIR,
      join(PROJECT_ROOT, 'tmp', 'goods-publish-source-cache'),
    );
  });

  it('returns null when the goods cache file does not exist', async () => {
    const { cache } = await temporaryCache();
    assert.equal(await cache.read(GOODS_ID), null);
  });

  it('round-trips only the source fields needed by goods publish', async () => {
    const { cacheDir, cache } = await temporaryCache();
    const source = sourceData({
      _url: 'PRIVATE-DIAGNOSTIC-URL',
      cookies: 'PRIVATE-COOKIE',
      authKey: 'PRIVATE-AUTH-KEY',
      proxy: 'PRIVATE-PROXY',
    });

    await cache.write(GOODS_ID, source);

    const raw = await readFile(join(cacheDir, `${GOODS_ID}.json`), 'utf8');
    const stored = JSON.parse(raw);
    assert.equal(stored.version, 3);
    assert.equal(stored.goods_id, GOODS_ID);
    assert.ok(typeof stored.cached_at === 'string');
    assert.equal(raw.includes('PRIVATE-DIAGNOSTIC-URL'), false);
    assert.equal(raw.includes('PRIVATE-COOKIE'), false);
    assert.equal(raw.includes('PRIVATE-AUTH-KEY'), false);
    assert.equal(raw.includes('PRIVATE-PROXY'), false);
    assert.deepEqual(await cache.read(GOODS_ID), sourceData());
  });

  it('rejects unsafe cache keys before touching the filesystem', async () => {
    const { cache } = await temporaryCache();
    await assert.rejects(
      () => cache.read('../consumer-auth-state'),
      (error) => error.code === 'E_SOURCE_CACHE_KEY',
    );
  });

  it('rejects corrupt, mismatched, or unsupported cache payloads', async () => {
    const { cacheDir, cache } = await temporaryCache();
    const path = join(cacheDir, `${GOODS_ID}.json`);

    await writeFile(path, '{ invalid json', 'utf8');
    await assert.rejects(() => cache.read(GOODS_ID), (error) => error.code === 'E_SOURCE_CACHE_INVALID');

    await writeFile(path, JSON.stringify({
      version: 4,
      goods_id: GOODS_ID,
      source: sourceData(),
    }), 'utf8');
    await assert.rejects(() => cache.read(GOODS_ID), (error) => error.code === 'E_SOURCE_CACHE_INVALID');

    await writeFile(path, JSON.stringify({
      version: 3,
      goods_id: '123',
      source: sourceData(),
    }), 'utf8');
    await assert.rejects(() => cache.read(GOODS_ID), (error) => error.code === 'E_SOURCE_CACHE_INVALID');
  });

  it('does not cache incomplete structured SKU data', async () => {
    const { cache } = await temporaryCache();
    await assert.rejects(
      () => cache.write(GOODS_ID, sourceData({ skus: [] })),
      (error) => error.code === 'E_SOURCE_CACHE_INVALID',
    );
    await assert.rejects(
      () => cache.write(GOODS_ID, sourceData({
        skus: sourceData().skus.map((sku) => ({ ...sku, specValues: null })),
      })),
      (error) => error.code === 'E_SOURCE_CACHE_INVALID',
    );
    await assert.rejects(
      () => cache.write(GOODS_ID, sourceData({ goodsName: 123, detailImgs: null })),
      (error) => error.code === 'E_SOURCE_CACHE_INVALID',
    );
    await assert.rejects(
      () => cache.write(GOODS_ID, sourceData({ sourceReferencePriceCents: undefined })),
      (error) => error.code === 'E_SOURCE_CACHE_INVALID',
    );
    await assert.rejects(
      () => cache.write(GOODS_ID, sourceData({ sourceReferencePriceCents: 2190 })),
      (error) => error.code === 'E_SOURCE_CACHE_INVALID',
    );
  });

  it('atomically replaces older data and removes only the requested goods file', async () => {
    const { cache } = await temporaryCache();
    await cache.write(GOODS_ID, sourceData({ goodsName: '旧标题' }));
    await cache.write(GOODS_ID, sourceData({ goodsName: '新标题' }));
    await cache.write('123', sourceData({ goodsID: '123', goodsName: '另一个商品' }));

    assert.equal((await cache.read(GOODS_ID)).goodsName, '新标题');
    assert.equal(await cache.remove(GOODS_ID), true);
    assert.equal(await cache.read(GOODS_ID), null);
    assert.equal((await cache.read('123')).goodsName, '另一个商品');
    assert.equal(await cache.remove(GOODS_ID), false);
  });
});
