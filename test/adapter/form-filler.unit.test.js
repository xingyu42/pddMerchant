import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { pickCategoryOptionIndex, normalizeCategoryText } from '../../src/adapter/goods-publish/form-filler.js';

describe('normalizeCategoryText', () => {
  it('strips all whitespace', () => {
    assert.equal(normalizeCategoryText('女装/女士精品 > 连衣裙 > 连衣裙'), '女装/女士精品>连衣裙>连衣裙');
  });

  it('normalizes fullwidth ＞ to >', () => {
    assert.equal(normalizeCategoryText('A ＞ B'), 'A>B');
  });

  it('returns empty string for null/undefined', () => {
    assert.equal(normalizeCategoryText(null), '');
    assert.equal(normalizeCategoryText(undefined), '');
  });
});

describe('pickCategoryOptionIndex', () => {
  const items = [
    '女装/女士精品 > 连衣裙 > 连衣裙',
    '女装/女士精品 > 中老年女装 > 中老年连衣裙',
    '女装/女士精品 > 大码女装 > 大码连衣裙',
    '童装/婴儿装/亲子装 > 裙子 > 连衣裙',
  ];

  it('returns -1 for empty list', () => {
    assert.equal(pickCategoryOptionIndex([], '女装/女士精品 > 连衣裙 > 连衣裙'), -1);
  });

  it('returns -1 for non-array', () => {
    assert.equal(pickCategoryOptionIndex(null, 'x'), -1);
  });

  it('exact full-path match wins (even if not first)', () => {
    assert.equal(pickCategoryOptionIndex(items, '童装/婴儿装/亲子装 > 裙子 > 连衣裙'), 3);
  });

  it('exact match ignores whitespace differences', () => {
    assert.equal(pickCategoryOptionIndex(items, '女装/女士精品>连衣裙>连衣裙'), 0);
  });

  it('falls back to unique leaf-suffix match when no exact path', () => {
    // 目标完整路径不在下拉中，但叶子词「大码连衣裙」后缀唯一命中索引 2
    assert.equal(pickCategoryOptionIndex(items, '其他 > 其他 > 大码连衣裙'), 2);
  });

  it('returns -1 when leaf-suffix match is ambiguous (multiple candidates)', () => {
    // 叶子词「连衣裙」在 items[0] 和 items[3] 都后缀命中，无精确匹配 → 拒绝盲选
    assert.equal(pickCategoryOptionIndex(items, '服装 > 裙装 > 连衣裙'), -1);
  });

  it('returns -1 when neither exact nor suffix matches (no blind fallback)', () => {
    assert.equal(pickCategoryOptionIndex(items, '数码 > 手机 > 智能手机'), -1);
  });
});
