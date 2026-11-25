import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { ExitCodes, PddCliError } from '../../src/infra/errors.js';
import {
  SOURCE_CACHE_VERSION,
  parseGoodsUrl,
  normalizeSourceSkuSnapshot,
  buildSkuPreviewPlan,
  scoreSourceObservation,
  selectBestObservation,
  classifySourceObservation,
  normalizeSourceForCache,
  serializeSourceCachePayload,
  parseSourceCachePayload,
} from '../../src/services/goods-publish/source-normalizer.js';

function makeValidRawSource(overrides = {}) {
  return {
    goodsID: '123456',
    goodsName: 'Pure Cotton Tee',
    catID: 1003,
    catID1: 1001,
    catID2: 1002,
    catID3: 1003,
    price: '14.70',
    linePrice: '59',
    carousel: ['https://img.pddpic.com/carousel-1.jpg'],
    skuText: '颜色\n白色\n黑色',
    properties: '',
    detailImgs: ['https://img.pddpic.com/detail-1.jpg'],
    skuDimensions: [
      {
        name: '颜色',
        values: [
          { id: '1', text: '白色' },
          { id: '2', text: '黑色' },
        ],
      },
    ],
    skus: [
      {
        skuID: 'sku-w',
        groupPrice: '14.7',
        normalPrice: '25.8',
        quantity: 10,
        thumbUrl: 'https://img.pddpic.com/white.jpg',
        specValues: { 颜色: '白色' },
      },
      {
        skuID: 'sku-b',
        groupPrice: 16,
        normalPrice: 28,
        quantity: 0,
        thumbUrl: 'https://img.pddpic.com/black.jpg',
        specValues: { 颜色: '黑色' },
      },
    ],
    goodsProperties: [
      { name: '面料俗称', values: ['棉'], refPid: '101', referenceId: '1' },
    ],
    ...overrides,
  };
}

function makeRawObservation(overrides = {}) {
  const valid = makeValidRawSource();
  return {
    goodsID: valid.goodsID,
    goodsName: valid.goodsName,
    catID: valid.catID,
    catID1: valid.catID1,
    catID2: valid.catID2,
    catID3: valid.catID3,
    price: valid.price,
    carousel: valid.carousel,
    skuText: valid.skuText,
    properties: valid.properties,
    detailImgs: valid.detailImgs,
    _fiberFound: true,
    _maskHint: false,
    _url: 'https://mobile.yangkeduo.com/goods.html?goods_id=123456&uin=SECRET_UIN',
    _title: 'Pure Cotton Tee',
    _bodyLen: 800,
    _roots: 'app',
    _appWall: false,
    _decodedSkuSource: {
      goodsID: '123456',
      linePrice: '59',
      skuDimensions: valid.skuDimensions,
      skus: valid.skus,
      goodsProperties: valid.goodsProperties,
      visitedObjects: 12,
    },
    ...overrides,
  };
}

describe('source-normalizer', () => {
  describe('parseGoodsUrl', () => {
    it.each([
      ['123456', '123456'],
      ['  785831857546  ', '785831857546'],
      ['https://mobile.yangkeduo.com/goods.html?goods_id=447841256386&refer=1', '447841256386'],
    ])('extracts numeric goods_id from %j', (input, expected) => {
      assert.equal(parseGoodsUrl(input), expected);
    });

    it.each(['', null, undefined, 'abc', 'https://mobile.yangkeduo.com/goods.html?goods_id=abc', 'not-a-url'])(
      'rejects invalid goods url/id %j with E_USAGE',
      (input) => {
        assert.throws(
          () => parseGoodsUrl(input),
          (err) => err instanceof PddCliError && err.code === 'E_USAGE' && err.exitCode === ExitCodes.USAGE,
        );
      },
    );

    it('strips query parameters from parseGoodsUrl error messages while keeping clean path', () => {
      assert.throws(
        () => parseGoodsUrl('https://mobile.yangkeduo.com/goods.html?goods_id=abc&uin=SECRET_UIN#frag'),
        (err) => err instanceof PddCliError
          && err.code === 'E_USAGE'
          && err.message.includes('https://mobile.yangkeduo.com/goods.html')
          && !err.message.includes('SECRET_UIN')
          && !err.message.includes('goods_id=abc')
          && !err.message.includes('#frag'),
      );
    });
  });

  describe('normalizeSourceSkuSnapshot (yuan/fen & no-markup rules)', () => {
    it('converts yuan decimals and raw integer yuan to exact cents without markup, including stock=0', () => {
      const snapshot = normalizeSourceSkuSnapshot(makeValidRawSource());
      assert.equal(snapshot.complete, true);
      assert.deepEqual(snapshot.issues, []);
      assert.equal(snapshot.sourceReferencePriceCents, 5900);
      assert.deepEqual(snapshot.skus, [
        {
          sourceSkuId: 'sku-w',
          specValues: { 颜色: '白色' },
          sourcePriceCents: 1470,
          sourceNormalPriceCents: 2580,
          stock: 10,
          thumbUrl: 'https://img.pddpic.com/white.jpg',
        },
        {
          sourceSkuId: 'sku-b',
          specValues: { 颜色: '黑色' },
          sourcePriceCents: 1600,
          sourceNormalPriceCents: 2800,
          stock: 0,
          thumbUrl: 'https://img.pddpic.com/black.jpg',
        },
      ]);
    });

    it('preserves explicit integer-cent fields without multiplying again', () => {
      const snapshot = normalizeSourceSkuSnapshot({
        sourceReferencePriceCents: 5900,
        skuDimensions: [{ name: '颜色', values: [{ id: '1', text: '白色' }] }],
        skus: [
          {
            sourceSkuId: 'sku-1',
            specValues: { 颜色: '白色' },
            sourcePriceCents: 1470,
            sourceNormalPriceCents: 2580,
            stock: 3,
            thumbUrl: 'https://img.pddpic.com/w.jpg',
          },
        ],
      });
      assert.equal(snapshot.complete, true);
      assert.equal(snapshot.sourceReferencePriceCents, 5900);
      assert.equal(snapshot.skus[0].sourcePriceCents, 1470);
      assert.equal(snapshot.skus[0].sourceNormalPriceCents, 2580);
    });

    it('normalizes specs[] array when specValues object is absent and supports single-SKU empty specValues', () => {
      const multi = normalizeSourceSkuSnapshot({
        linePrice: '40',
        skuDimensions: [{ name: '颜色', values: [{ id: '1', text: '白色' }] }],
        skus: [
          {
            skuID: 'sku-1',
            groupPrice: '12.34',
            normalPrice: '20.00',
            quantity: 5,
            specs: [{ spec_key: '颜色', spec_value: '白色' }],
          },
        ],
      });
      assert.equal(multi.complete, true);
      assert.deepEqual(multi.skus[0].specValues, { 颜色: '白色' });

      const single = normalizeSourceSkuSnapshot({
        linePrice: '40',
        skuDimensions: [],
        skus: [
          {
            skuID: 'sku-only',
            groupPrice: '10',
            normalPrice: '20',
            quantity: 1,
          },
        ],
      });
      assert.equal(single.complete, true);
      assert.deepEqual(single.skus[0].specValues, {});
    });

    it('ignores per-SKU marketPrice=0 and rejects missing, non-positive, currency-formatted, >2 decimal, or non-strict reference prices', () => {
      const missingRef = normalizeSourceSkuSnapshot(makeValidRawSource({
        linePrice: undefined,
        skus: [{ skuID: '1', groupPrice: '10', normalPrice: '20', marketPrice: 0, quantity: 1 }],
        skuDimensions: [],
      }));
      assert.equal(missingRef.complete, false);
      assert.ok(missingRef.issues.includes('source_reference_price_invalid'));

      const equalToSingle = normalizeSourceSkuSnapshot(makeValidRawSource({ linePrice: '28.00' }));
      assert.equal(equalToSingle.complete, false);
      assert.ok(equalToSingle.issues.includes('source_reference_price_not_above_single'));

      const badDecimals = normalizeSourceSkuSnapshot(makeValidRawSource({
        linePrice: '¥59.00',
        skus: [
          {
            skuID: '1',
            groupPrice: '14.705',
            normalPrice: '-1',
            quantity: -1,
            specValues: { 颜色: '白色' },
          },
        ],
        skuDimensions: [{ name: '颜色', values: [{ id: '1', text: '白色' }] }],
      }));
      assert.equal(badDecimals.complete, false);
      assert.ok(badDecimals.issues.includes('source_reference_price_invalid'));
      assert.ok(badDecimals.issues.includes('sku_price_invalid'));
      assert.ok(badDecimals.issues.includes('sku_normal_price_invalid'));
      assert.ok(badDecimals.issues.includes('sku_stock_missing'));
    });

    it('rejects duplicate combinations, missing spec values, count mismatch, and enforces bounded dimension/SKU limits', () => {
      const dup = normalizeSourceSkuSnapshot(makeValidRawSource({
        skus: [
          { skuID: '1', groupPrice: '10', normalPrice: '20', quantity: 1, specValues: { 颜色: '白色' } },
          { skuID: '2', groupPrice: '11', normalPrice: '21', quantity: 1, specValues: { 颜色: '白色' } },
        ],
      }));
      assert.equal(dup.complete, false);
      assert.ok(dup.issues.includes('sku_combination_duplicate'));

      const mismatch = normalizeSourceSkuSnapshot(makeValidRawSource({
        skus: [
          { skuID: '1', groupPrice: '10', normalPrice: '20', quantity: 1, specValues: { 颜色: '白色' } },
        ],
      }));
      assert.equal(mismatch.complete, false);
      assert.ok(mismatch.issues.includes('sku_combination_count_mismatch'));

      const tooManyDims = normalizeSourceSkuSnapshot({
        linePrice: '99',
        skuDimensions: Array.from({ length: 11 }, (_, idx) => ({
          name: `d${idx}`,
          values: [{ id: '1', text: 'A' }],
        })),
        skus: [],
      });
      assert.ok(tooManyDims.issues.includes('sku_dimension_limit_exceeded'));
    });
  });

  describe('buildSkuPreviewPlan', () => {
    it('groups unique thumbUrl per color and rejects missing or shared cross-color URLs', () => {
      const snapshot = normalizeSourceSkuSnapshot(makeValidRawSource());
      const preview = buildSkuPreviewPlan(snapshot);
      assert.equal(preview.ok, true);
      assert.deepEqual(preview.plan, [
        { merchantColor: '白色', sourceImageUrl: 'https://img.pddpic.com/white.jpg' },
        { merchantColor: '黑色', sourceImageUrl: 'https://img.pddpic.com/black.jpg' },
      ]);

      const sharedUrl = buildSkuPreviewPlan({
        skuDimensions: snapshot.skuDimensions,
        skus: snapshot.skus.map((sku) => ({ ...sku, thumbUrl: 'https://img.pddpic.com/same.jpg' })),
      });
      assert.equal(sharedUrl.ok, false);
      assert.ok(sharedUrl.issues.includes('sku_preview_mapping_ambiguous'));

      const noColor = buildSkuPreviewPlan({
        skuDimensions: [{ name: '尺码', values: [{ id: '1', text: 'M' }] }],
        skus: [{ sourceSkuId: '1', specValues: { 尺码: 'M' }, thumbUrl: 'https://img.pddpic.com/m.jpg' }],
      });
      assert.equal(noColor.ok, false);
      assert.deepEqual(noColor.issues, ['sku_preview_color_dimension_missing']);
    });
  });

  describe('observation selection and empty-shell / degradation pre-classification', () => {
    it('selects the higher-scoring observation between earlyData and finalData', () => {
      const weak = makeRawObservation({
        _decodedSkuSource: { goodsID: '123456', skus: [], skuDimensions: [] },
      });
      const complete = makeRawObservation();
      assert.ok(scoreSourceObservation(complete).score > scoreSourceObservation(weak).score);

      const selected = selectBestObservation(complete, weak);
      assert.equal(selected.selectedSkuSource.skus.length, 2);
      assert.equal(selected.data._decodedSkuSource, undefined);
    });

    it('classifies empty-shell (_fiberFound=false && _appWall=true) BEFORE price/SKU masking', () => {
      const obs = makeRawObservation({
        goodsName: '拼多多',
        catID: null,
        catID3: null,
        price: null,
        carousel: [],
        skuText: '',
        _fiberFound: false,
        _maskHint: true,
        _appWall: true,
        _bodyLen: 2336,
        _title: '拼多多',
        _decodedSkuSource: null,
      });

      const classified = classifySourceObservation(obs, {
        pageUrl: 'https://mobile.yangkeduo.com/goods.html?goods_id=123456&uin=SECRET_UIN',
      });
      assert.equal(classified.kind, 'empty_shell');
      assert.equal(classified.signal.reason, 'empty_shell');
    });

    it.each([
      {
        label: 'app_redirect_placeholder',
        patch: { price: null, _maskHint: true, _decodedSkuSource: null },
        expectedReason: 'app_redirect_placeholder',
      },
      {
        label: 'price_masked (0)',
        patch: { price: '0', _maskHint: false, _decodedSkuSource: null },
        expectedReason: 'price_masked',
      },
      {
        label: 'sku_missing',
        patch: { price: '19.90', skuText: '', _maskHint: false, _decodedSkuSource: null },
        expectedReason: 'sku_missing',
      },
    ])('classifies Consumer Account Degradation ($label) and strips query params from path', ({ patch, expectedReason }) => {
      const obs = makeRawObservation(patch);
      const classified = classifySourceObservation(obs, {
        pageUrl: 'https://mobile.yangkeduo.com/goods.html?goods_id=123456&uin=SECRET_UIN_VALUE',
      });
      assert.equal(classified.kind, 'consumer_degradation');
      assert.equal(classified.signal.reason, expectedReason);
      assert.equal(classified.signal.path, '/goods.html');
      assert.equal(JSON.stringify(classified.signal).includes('SECRET_UIN_VALUE'), false);
    });

    it('does not let generic _maskHint override an exact-target complete SKU snapshot', () => {
      const obs = makeRawObservation({ _maskHint: true, _appWall: true });
      const classified = classifySourceObservation(obs, {
        pageUrl: 'https://mobile.yangkeduo.com/goods.html?goods_id=123456',
      });
      assert.equal(classified.kind, 'ok');
      assert.equal(classified.source.skus.length, 2);
      assert.equal(classified.source.sourceReferencePriceCents, 5900);
    });

    it('returns invalid classification with E_SOURCE_SKU_UNAVAILABLE when structured SKU is incomplete without masking', () => {
      const obs = makeRawObservation({
        price: '14.70',
        _decodedSkuSource: {
          goodsID: '123456',
          linePrice: '10.00', // not strictly above normalPrice 25.80
          skuDimensions: makeValidRawSource().skuDimensions,
          skus: makeValidRawSource().skus,
          goodsProperties: makeValidRawSource().goodsProperties,
        },
      });
      const classified = classifySourceObservation(obs);
      assert.equal(classified.kind, 'invalid');
      assert.equal(classified.error.code, 'E_SOURCE_SKU_UNAVAILABLE');
    });
  });

  describe('v4 source cache whitelist projection & legacy rejection', () => {
    it('projects only whitelisted fields in v4 cache payload and strips _ diagnostics, cookies, and proxy secrets', () => {
      const dirtySource = {
        ...makeValidRawSource(),
        _fiberFound: true,
        _url: 'https://mobile.yangkeduo.com/goods.html?goods_id=123456&uin=SECRET',
        _decodedSkuSource: { secret: 'yes' },
        cookies: [{ name: 'PDDAccessToken', value: 'raw-cookie' }],
        authKey: 'secret-auth-key',
        proxy: { server: 'http://1.2.3.4:8080' },
        requestId: 'raw-req-id',
      };

      const raw = serializeSourceCachePayload('123456', dirtySource, {
        cachedAt: '2026-11-25T00:00:00.000Z',
      });
      const parsedJson = JSON.parse(raw);
      assert.equal(parsedJson.version, SOURCE_CACHE_VERSION);
      assert.equal(SOURCE_CACHE_VERSION, 4);
      assert.equal(parsedJson.goods_id, '123456');
      assert.equal(Object.hasOwn(parsedJson.source, '_fiberFound'), false);
      assert.equal(Object.hasOwn(parsedJson.source, '_url'), false);
      assert.equal(Object.hasOwn(parsedJson.source, '_decodedSkuSource'), false);
      assert.equal(Object.hasOwn(parsedJson.source, 'cookies'), false);
      assert.equal(Object.hasOwn(parsedJson.source, 'authKey'), false);
      assert.equal(Object.hasOwn(parsedJson.source, 'proxy'), false);
      assert.equal(Object.hasOwn(parsedJson.source, 'requestId'), false);

      const roundTripped = parseSourceCachePayload('123456', raw);
      assert.equal(roundTripped.goodsID, '123456');
      assert.equal(roundTripped.sourceReferencePriceCents, 5900);
      assert.equal(roundTripped.skus.length, 2);
      assert.equal(roundTripped.goodsProperties.length, 1);
    });

    it('rejects v3 payloads, goods_id mismatches, corrupt JSON, and incomplete SKU/properties/preview payloads', () => {
      const valid = normalizeSourceForCache('123456', makeValidRawSource());
      assert.throws(
        () => parseSourceCachePayload('123456', JSON.stringify({ version: 3, goods_id: '123456', source: valid })),
        { code: 'E_SOURCE_CACHE_INVALID' },
      );
      assert.throws(
        () => parseSourceCachePayload('123456', JSON.stringify({ version: 4, goods_id: '999999', source: valid })),
        { code: 'E_SOURCE_CACHE_INVALID' },
      );
      assert.throws(
        () => parseSourceCachePayload('123456', '{bad-json'),
        { code: 'E_SOURCE_CACHE_INVALID' },
      );
      assert.throws(
        () => normalizeSourceForCache('123456', makeValidRawSource({ goodsProperties: [] })),
        { code: 'E_SOURCE_CACHE_INVALID' },
      );
      assert.throws(
        () => normalizeSourceForCache('123456', makeValidRawSource({ linePrice: '20.00' })),
        { code: 'E_SOURCE_CACHE_INVALID' },
      );
    });
  });
});
