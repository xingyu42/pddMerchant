import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it } from 'vitest';
import { createSourceGoodsCache } from '../../src/services/goods-publish-source-cache.js';

const tempDirs = [];

function makeTempCacheDir() {
  const dir = mkdtempSync(join(tmpdir(), 'pdd-source-cache-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop(), { recursive: true, force: true });
  }
});

function makeRawSource(overrides = {}) {
  return {
    goodsID: '123456',
    goodsName: 'Cached Cotton Tee',
    catID: 1003,
    catID1: 1001,
    catID2: 1002,
    catID3: 1003,
    price: '14.70',
    linePrice: '59',
    carousel: ['https://img.pddpic.com/carousel-1.jpg'],
    skuText: '颜色\n白色',
    properties: '',
    detailImgs: ['https://img.pddpic.com/detail-1.jpg'],
    skuDimensions: [{ name: '颜色', values: [{ id: '1', text: '白色' }] }],
    skus: [
      {
        skuID: 'sku-w',
        groupPrice: '14.70',
        normalPrice: '25.80',
        quantity: 5,
        thumbUrl: 'https://img.pddpic.com/white.jpg',
        specValues: { 颜色: '白色' },
      },
    ],
    goodsProperties: [{ name: '面料俗称', values: ['棉'], refPid: '101', referenceId: '1' }],
    _fiberFound: true,
    _url: 'https://mobile.yangkeduo.com/goods.html?goods_id=123456&uin=SECRET',
    ...overrides,
  };
}

describe('goods-publish-source-cache (v4 disk persistence)', () => {
  it('writes atomically with v4 whitelist projection, reads back normalized data, and removes entries', async () => {
    const cacheDir = makeTempCacheDir();
    const cache = createSourceGoodsCache({ cacheDir });

    assert.equal(await cache.read('123456'), null);
    assert.equal(await cache.remove('123456'), false);

    await cache.write('123456', makeRawSource());
    const files = readdirSync(cacheDir);
    assert.deepEqual(files, ['123456.json']);

    const rawFile = JSON.parse(readFileSync(join(cacheDir, '123456.json'), 'utf8'));
    assert.equal(rawFile.version, 4);
    assert.equal(Object.hasOwn(rawFile.source, '_fiberFound'), false);
    assert.equal(Object.hasOwn(rawFile.source, '_url'), false);

    const loaded = await cache.read('123456');
    assert.equal(loaded.goodsID, '123456');
    assert.equal(loaded.sourceReferencePriceCents, 5900);
    assert.equal(loaded.skus[0].sourcePriceCents, 1470);

    assert.equal(await cache.remove('123456'), true);
    assert.equal(existsSync(join(cacheDir, '123456.json')), false);
  });

  it('rejects v3 cache files and non-numeric keys', async () => {
    const cacheDir = makeTempCacheDir();
    const cache = createSourceGoodsCache({ cacheDir });

    writeFileSync(
      join(cacheDir, '123456.json'),
      JSON.stringify({ version: 3, goods_id: '123456', source: makeRawSource() }),
      'utf8',
    );
    await assert.rejects(cache.read('123456'), { code: 'E_SOURCE_CACHE_INVALID' });
    await assert.rejects(cache.read('../bad'), { code: 'E_SOURCE_CACHE_KEY' });
  });
});
