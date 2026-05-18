import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseGoodsUrl, validateScrapedData, parseSkuText } from '../src/adapter/goods-publish/source-scraper.js';
import {
  normalizePropertyText,
  parsePropertiesText,
  matchGoodsProperties,
} from '../src/services/goods-publish/property-matcher.js';
import {
  buildGoodsEditPayload,
  buildDecorationPayload,
} from '../src/services/goods-publish/payload-builder.js';
import { mapSourceSkus } from '../src/services/goods-publish/sku-mapper.js';
import { mapPublishBusinessError } from '../src/adapter/endpoints/goods-publish.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = join(__dirname, 'fixtures');

function loadFixture(rel) {
  return JSON.parse(readFileSync(join(FIXTURE_DIR, rel), 'utf8'));
}

// ---------------------------------------------------------------------------
// parseGoodsUrl
// ---------------------------------------------------------------------------
describe('parseGoodsUrl', () => {
  it('accepts pure numeric string', () => {
    assert.equal(parseGoodsUrl('918867803697'), '918867803697');
  });

  it('extracts goods_id from full mobile URL', () => {
    assert.equal(
      parseGoodsUrl('https://mobile.yangkeduo.com/goods.html?goods_id=12345'),
      '12345'
    );
  });

  it('extracts goods_id from goods1.html format', () => {
    assert.equal(
      parseGoodsUrl('https://mobile.yangkeduo.com/goods1.html?goods_id=99999&refer_page_name=search_result'),
      '99999'
    );
  });

  it('extracts goods_id from yangkeduo.com domain', () => {
    assert.equal(
      parseGoodsUrl('https://yangkeduo.com/goods.html?goods_id=55555'),
      '55555'
    );
  });

  it('throws E_USAGE for invalid string', () => {
    assert.throws(
      () => parseGoodsUrl('not-a-valid-thing'),
      (e) => e.code === 'E_USAGE'
    );
  });

  it('throws E_USAGE for empty string', () => {
    assert.throws(
      () => parseGoodsUrl(''),
      (e) => e.code === 'E_USAGE'
    );
  });

  it('throws E_USAGE for null', () => {
    assert.throws(
      () => parseGoodsUrl(null),
      (e) => e.code === 'E_USAGE'
    );
  });
});

// ---------------------------------------------------------------------------
// validateScrapedData
// ---------------------------------------------------------------------------
describe('validateScrapedData', () => {
  const validData = {
    goodsName: '汪汪队衣服',
    catID3: '15000',
    carousel: ['https://img.pddpic.com/test.jpg'],
  };

  it('passes with complete data', () => {
    assert.doesNotThrow(() => validateScrapedData(validData));
  });

  it('throws E_BUSINESS when goodsName is missing', () => {
    assert.throws(
      () => validateScrapedData({ ...validData, goodsName: '' }),
      (e) => e.code === 'E_BUSINESS'
    );
  });

  it('throws E_BUSINESS when both catID and catID3 are missing', () => {
    assert.throws(
      () => validateScrapedData({ goodsName: '商品', carousel: ['https://x.com/a.jpg'] }),
      (e) => e.code === 'E_BUSINESS'
    );
  });

  it('throws E_BUSINESS when carousel is empty array', () => {
    assert.throws(
      () => validateScrapedData({ ...validData, carousel: [] }),
      (e) => e.code === 'E_BUSINESS'
    );
  });

  it('throws E_BUSINESS when carousel is not array', () => {
    assert.throws(
      () => validateScrapedData({ ...validData, carousel: null }),
      (e) => e.code === 'E_BUSINESS'
    );
  });
});

// ---------------------------------------------------------------------------
// normalizePropertyText
// ---------------------------------------------------------------------------
describe('normalizePropertyText', () => {
  it('strips slashes and spaces', () => {
    assert.equal(normalizePropertyText('面料/材质'), '面料材质');
  });

  it('trims surrounding whitespace', () => {
    assert.equal(normalizePropertyText('  重要面料俗称  '), '重要面料俗称');
  });

  it('returns empty string for null', () => {
    assert.equal(normalizePropertyText(null), '');
  });

  it('lowercases ASCII chars', () => {
    assert.equal(normalizePropertyText('Brand'), 'brand');
  });
});

// ---------------------------------------------------------------------------
// parsePropertiesText
// ---------------------------------------------------------------------------
describe('parsePropertiesText', () => {
  it('parses two key:value pairs separated by newline', () => {
    const result = parsePropertiesText('品牌: 无品牌\n面料/材质: 棉');
    assert.equal(result.length, 2);
    assert.equal(result[0].key, '品牌');
    assert.deepEqual(result[0].values, ['无品牌']);
    assert.equal(result[1].key, '面料/材质');
    assert.deepEqual(result[1].values, ['棉']);
  });

  it('returns empty array for empty string', () => {
    assert.deepEqual(parsePropertiesText(''), []);
  });

  it('returns empty array for null', () => {
    assert.deepEqual(parsePropertiesText(null), []);
  });

  it('parses multi-value property separated by comma', () => {
    const result = parsePropertiesText('流行元素: 印花，条纹');
    assert.equal(result.length, 1);
    assert.equal(result[0].key, '流行元素');
    assert.deepEqual(result[0].values, ['印花', '条纹']);
  });

  it('skips lines without colon separator', () => {
    const result = parsePropertiesText('no colon here\n品牌: test');
    assert.equal(result.length, 1);
    assert.equal(result[0].key, '品牌');
  });
});

// ---------------------------------------------------------------------------
// matchGoodsProperties
// ---------------------------------------------------------------------------
describe('matchGoodsProperties', () => {
  const templateFixture = loadFixture('endpoints/goods.publish.template.json');
  const sourceFixture = loadFixture('goods-publish/source.json');

  it('returns matched and unmatched arrays', () => {
    const { matched, unmatched } = matchGoodsProperties(
      sourceFixture.properties,
      templateFixture.modules
    );
    assert.ok(Array.isArray(matched), 'matched should be array');
    assert.ok(Array.isArray(unmatched), 'unmatched should be array');
  });

  it('matches at least one property from source', () => {
    const { matched } = matchGoodsProperties(
      sourceFixture.properties,
      templateFixture.modules
    );
    assert.ok(matched.length > 0, `expected some matched props, got ${matched.length}`);
  });

  it('matched items contain required fields', () => {
    const { matched } = matchGoodsProperties(
      sourceFixture.properties,
      templateFixture.modules
    );
    for (const m of matched) {
      assert.ok('vid' in m, 'matched item should have vid');
      assert.ok('pid' in m, 'matched item should have pid');
    }
  });

  it('unmatched items include required flag', () => {
    const { unmatched } = matchGoodsProperties(
      sourceFixture.properties,
      templateFixture.modules
    );
    for (const u of unmatched) {
      assert.ok('required' in u, 'unmatched item should have required flag');
      assert.ok('name' in u, 'unmatched item should have name');
    }
  });

  it('throws when templateModules is not array', () => {
    assert.throws(
      () => matchGoodsProperties('品牌: 无品牌', null),
      (e) => e.code === 'E_PROPERTY_MATCH_INVALID_INPUT'
    );
  });
});

// ---------------------------------------------------------------------------
// buildGoodsEditPayload
// ---------------------------------------------------------------------------
describe('buildGoodsEditPayload', () => {
  const draft = { goods_id: 953009364304, goods_commit_id: '191512609758' };
  const scraped = loadFixture('goods-publish/source.json');
  const category = loadFixture('goods-publish/category.json');
  const matched = { matched: [], unmatched: [] };

  it('constructs valid payload structure', () => {
    const payload = buildGoodsEditPayload(draft, scraped, matched, category, 544142245494784);
    assert.equal(payload.goods_id, draft.goods_id);
    assert.equal(payload.goods_commit_id, draft.goods_commit_id);
    assert.equal(payload.goods_name, scraped.goodsName);
    assert.ok(Array.isArray(payload.skus), 'skus should be array');
    assert.ok(typeof payload.groups === 'object', 'groups should be object');
  });

  it('converts price string to cents correctly', () => {
    const payload = buildGoodsEditPayload(draft, scraped, matched, category, null);
    assert.equal(payload.skus[0].price, 822, 'price 8.22 should become 822 cents');
    assert.equal(payload.groups.single_price, 822);
  });

  it('passes goods_id and goods_commit_id through', () => {
    const payload = buildGoodsEditPayload(draft, scraped, matched, category, null);
    assert.equal(payload.goods_id, 953009364304);
    assert.equal(payload.goods_commit_id, '191512609758');
  });

  it('throws when draft is missing goods_id', () => {
    assert.throws(
      () => buildGoodsEditPayload({ goods_commit_id: '123' }, scraped, matched, category, null),
      (e) => e.code === 'E_PAYLOAD_INVALID_DRAFT'
    );
  });

  it('throws when draft is missing goods_commit_id', () => {
    assert.throws(
      () => buildGoodsEditPayload({ goods_id: 123 }, scraped, matched, category, null),
      (e) => e.code === 'E_PAYLOAD_INVALID_DRAFT'
    );
  });
});

// ---------------------------------------------------------------------------
// buildDecorationPayload
// ---------------------------------------------------------------------------
describe('buildDecorationPayload', () => {
  it('builds floor_list with image type elements', () => {
    const urls = ['https://img.pddpic.com/test-detail-1.jpg', 'https://img.pddpic.com/test-detail-2.jpg'];
    const payload = buildDecorationPayload('191512609758', 953009364304, urls);
    assert.equal(payload.floor_list.length, 2);
    assert.equal(payload.floor_list[0].type, 'image');
    assert.ok(Array.isArray(payload.floor_list[0].content_list));
    assert.equal(payload.floor_list[0].content_list[0].img_url, urls[0]);
  });

  it('returns empty floor_list for empty URL array', () => {
    const payload = buildDecorationPayload('191512609758', 953009364304, []);
    assert.deepEqual(payload.floor_list, []);
  });

  it('returns empty floor_list for null URLs', () => {
    const payload = buildDecorationPayload('191512609758', 953009364304, null);
    assert.deepEqual(payload.floor_list, []);
  });

  it('passes goods_commit_id and goods_id correctly', () => {
    const payload = buildDecorationPayload('191512609758', 953009364304, []);
    assert.equal(payload.goods_commit_id, '191512609758');
    assert.equal(payload.goods_id, 953009364304);
  });
});

// ---------------------------------------------------------------------------
// parseSkuText
// ---------------------------------------------------------------------------
describe('parseSkuText', () => {
  it('parses two-dimension text into structured array', () => {
    const result = parseSkuText('颜色分类\n白色\n黑色\n尺码\nS\nM\nL');
    assert.equal(result.length, 2);
    assert.equal(result[0].name, '颜色分类');
    assert.deepEqual(result[0].values, ['白色', '黑色']);
    assert.equal(result[1].name, '尺码');
    assert.deepEqual(result[1].values, ['S', 'M', 'L']);
  });

  it('returns empty array for empty string', () => {
    assert.deepEqual(parseSkuText(''), []);
  });

  it('returns empty array for null', () => {
    assert.deepEqual(parseSkuText(null), []);
  });

  it('filters noise lines (prices, sales counts)', () => {
    const result = parseSkuText('颜色分类\n白色\n¥8.22\n已售1000\n黑色');
    assert.equal(result.length, 1);
    assert.deepEqual(result[0].values, ['白色', '黑色']);
  });

  it('single dimension produces one-element array', () => {
    const result = parseSkuText('颜色\n红色\n蓝色');
    assert.equal(result.length, 1);
    assert.equal(result[0].name, '颜色');
    assert.deepEqual(result[0].values, ['红色', '蓝色']);
  });

  it('ignores text before first dimension header', () => {
    const result = parseSkuText('一些无关文字\n请选择\n颜色分类\n白色');
    assert.equal(result.length, 1);
    assert.deepEqual(result[0].values, ['白色']);
  });

  it('omits dimension with zero values after noise filtering', () => {
    const result = parseSkuText('颜色分类\n¥9.99\n尺码\nS\nM');
    assert.equal(result.length, 1);
    assert.equal(result[0].name, '尺码');
  });
});

// ---------------------------------------------------------------------------
// mapSourceSkus
// ---------------------------------------------------------------------------
describe('mapSourceSkus', () => {
  it('returns default single SKU for empty array', () => {
    const { skus } = mapSourceSkus([], '8.22');
    assert.equal(skus.length, 1);
    assert.equal(skus[0].spec, '');
  });

  it('returns default single SKU for null', () => {
    const { skus } = mapSourceSkus(null, '8.22');
    assert.equal(skus.length, 1);
  });

  it('maps single dimension to multiple SKUs', () => {
    const specs = [{ name: '颜色分类', values: ['白色', '黑色'] }];
    const { skus } = mapSourceSkus(specs, '8.22');
    assert.equal(skus.length, 2);
    assert.equal(skus[0].spec, '颜色分类:白色');
    assert.equal(skus[1].spec, '颜色分类:黑色');
  });

  it('builds Cartesian product for two dimensions', () => {
    const specs = [
      { name: '颜色分类', values: ['白色', '黑色'] },
      { name: '尺码', values: ['S', 'M', 'L'] },
    ];
    const { skus } = mapSourceSkus(specs, '8.22');
    assert.equal(skus.length, 6);
    assert.equal(skus[0].spec, '颜色分类:白色 尺码:S');
    assert.equal(skus[5].spec, '颜色分类:黑色 尺码:L');
  });

  it('converts price to cents', () => {
    const specs = [{ name: '颜色', values: ['白色', '黑色'] }];
    const { skus, groups } = mapSourceSkus(specs, '8.22');
    assert.equal(skus[0].price, 822);
    assert.equal(groups.single_price, 822);
  });

  it('all SKUs share same price', () => {
    const specs = [{ name: '颜色', values: ['白', '黑', '红'] }];
    const { skus } = mapSourceSkus(specs, '10.00');
    for (const sku of skus) {
      assert.equal(sku.price, 1000);
    }
  });

  it('single value single dimension returns default SKU', () => {
    const specs = [{ name: '颜色', values: ['白色'] }];
    const { skus } = mapSourceSkus(specs, '5.00');
    assert.equal(skus.length, 1);
    assert.equal(skus[0].spec, '');
  });
});

// ---------------------------------------------------------------------------
// mapPublishBusinessError
// ---------------------------------------------------------------------------
describe('mapPublishBusinessError', () => {
  it('returns E_RATE_LIMIT for error_code 54001', () => {
    const err = mapPublishBusinessError({ error_code: 54001 });
    assert.equal(err.code, 'E_RATE_LIMIT');
    assert.equal(err.exitCode, 4);
  });

  it('returns E_USAGE for error_code 1000', () => {
    const err = mapPublishBusinessError({ error_code: 1000 });
    assert.equal(err.code, 'E_USAGE');
    assert.equal(err.exitCode, 2);
  });

  it('returns E_BUSINESS for generic non-zero error_code', () => {
    const err = mapPublishBusinessError({ error_code: 99999 });
    assert.equal(err.code, 'E_BUSINESS');
    assert.equal(err.exitCode, 6);
  });

  it('returns null for error_code 0 (success)', () => {
    assert.equal(mapPublishBusinessError({ error_code: 0 }), null);
  });

  it('returns null for null input', () => {
    assert.equal(mapPublishBusinessError(null), null);
  });

  it('also reads errorCode camelCase field', () => {
    const err = mapPublishBusinessError({ errorCode: 54001 });
    assert.equal(err.code, 'E_RATE_LIMIT');
  });

  it('returns null for error_code 1000000', () => {
    assert.equal(mapPublishBusinessError({ error_code: 1000000 }), null);
  });
});
