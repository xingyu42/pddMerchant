import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import {
  disableSizeChart,
  fillGoodsProperties,
  matchPropertyRowIndex,
  pickCategoryOptionIndex,
  normalizeCategoryText,
} from '../../src/adapter/goods-publish/form-filler.js';

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

describe('matchPropertyRowIndex', () => {
  it('matches only one exact normalized label and strips the display-only important prefix', () => {
    assert.equal(matchPropertyRowIndex(['品牌', '重要面料俗称', '袖长'], '面料俗称'), 1);
    assert.equal(matchPropertyRowIndex(['面料俗称', '重要面料俗称'], '面料俗称'), -1);
    assert.equal(matchPropertyRowIndex(['面料'], '面料俗称'), -1);
  });
});

describe('fillGoodsProperties', () => {
  it('does not rewrite a property that already has the expected value', async () => {
    const row = {
      locator: (selector) => {
        if (selector === 'input') return {
          evaluateAll: async () => ['棉'],
        };
        if (selector.includes('Tag') || selector.includes('tag')) return {
          allInnerTexts: async () => [],
        };
        throw new Error(`already-filled row must not locate writable control: ${selector}`);
      },
      innerText: async () => '材质\n棉',
    };
    const page = {
      locator: (selector) => {
        if (selector === '.property-list') return {
          evaluateAll: async () => ['材质'],
          nth: () => row,
        };
        throw new Error(`already-filled property must not open options: ${selector}`);
      },
    };

    await fillGoodsProperties(page, [{
      name: '材质',
      values: [{ vid: 10571, value: '棉' }],
      required: true,
      important: false,
      controlType: 1,
    }]);
  });

  it('keeps filling a multi-select after its placeholder disappears and reads values from inputs', async () => {
    const selected = new Set();
    let readbackAttempts = 0;
    let activeRow = null;
    const rowRecords = [
      { label: '品牌', options: ['恋雨萌'] },
      { label: '重要面料俗称', options: ['棉', '3岁（含）—6岁（不含）'] },
    ];
    const rows = {
      evaluateAll: async () => rowRecords.map((row) => row.label),
      nth: (index) => ({
        locator: (selector) => {
          if (selector === 'input') return {
            evaluateAll: async () => {
              readbackAttempts += 1;
              return readbackAttempts > 1 ? [...selected] : [];
            },
          };
          if (selector === 'input[placeholder="请选择"]' && selected.size > 0) return {
            count: async () => 0,
          };
          if (selector.startsWith('input')) return {
            count: async () => 1,
            first: () => ({
              click: async () => { activeRow = index; },
              inputValue: async () => '',
              press: async () => { activeRow = index; },
              pressSequentially: async () => {
                activeRow = index;
                throw new Error('React replaced the search input');
              },
              fill: async () => { throw new Error('fill should not be used when keyboard input is available'); },
            }),
          };
          return { allInnerTexts: async () => [] };
        },
        innerText: async () => rowRecords[index].label,
      }),
    };
    const page = {
      locator: (selector) => {
        if (selector === '.property-list') return rows;
        if (selector.includes('role="listbox"')) {
          const options = rowRecords[activeRow]?.options ?? [];
          return {
            allInnerTexts: async () => options,
            evaluateAll: async (fn, target) => fn(options.map((text) => ({ innerText: text })), target),
            nth: (index) => ({
              getAttribute: async () => 'false',
              evaluate: async () => { throw new Error('scripted DOM click must not be used'); },
              click: async () => { selected.add(options[index]); },
            }),
          };
        }
        throw new Error(`unexpected selector: ${selector}`);
      },
      waitForTimeout: async () => {},
    };

    await fillGoodsProperties(page, [{
      name: '面料俗称',
      values: [{ vid: 100, value: '棉' }, { vid: 101, value: '3岁(含)-6岁(不含)' }],
      required: false,
      important: true,
      controlType: 1,
    }]);

    assert.deepEqual([...selected], ['棉', '3岁（含）—6岁（不含）']);
    assert.equal(readbackAttempts, 4);
  });

  it('fails on duplicate rows or candidates instead of choosing by index', async () => {
    const page = {
      locator: (selector) => {
        if (selector === '.property-list') return {
          evaluateAll: async () => ['袖长', '重要袖长'],
        };
        throw new Error(`unexpected selector: ${selector}`);
      },
    };

    await assert.rejects(
      () => fillGoodsProperties(page, [{ name: '袖长', values: [{ vid: 1, value: '短袖' }] }]),
      (error) => error.code === 'E_BUSINESS' && error.detail.issue === 'property_row_unmapped',
    );
  });
});

describe('disableSizeChart', () => {
  function createPage({ active = true, confirmAvailable = true, readbackSucceeds = true } = {}) {
    let sizeChartActive = active;
    let popoverOpen = false;
    let disableClicks = 0;
    let confirmClicks = 0;
    return {
      page: {
        locator: (selector) => {
          if (selector === 'a[data-tracking-click-viewid="disable_size_chart"]') return {
            count: async () => (sizeChartActive ? 1 : 0),
            click: async () => {
              disableClicks += 1;
              popoverOpen = true;
            },
          };
          if (selector === '[class*="sizeChart_sizeTable"]') return {
            count: async () => (sizeChartActive ? 1 : 0),
          };
          throw new Error(`unexpected selector: ${selector}`);
        },
        getByRole: (role, options) => {
          assert.equal(role, 'button');
          assert.deepEqual(options, { name: '确认停用', exact: true });
          return {
            count: async () => (popoverOpen && confirmAvailable ? 1 : 0),
            click: async () => {
              confirmClicks += 1;
              popoverOpen = false;
              if (readbackSucceeds) sizeChartActive = false;
            },
          };
        },
        waitForTimeout: async () => {},
      },
      stats: () => ({ disableClicks, confirmClicks, sizeChartActive }),
    };
  }

  it('uses the official two-step action and reads back the disabled state', async () => {
    const fixture = createPage();

    const result = await disableSizeChart(fixture.page, {
      confirmAttempts: 1,
      readbackAttempts: 1,
      intervalMs: 0,
    });

    assert.deepEqual(result, { changed: true, disabled: true });
    assert.deepEqual(fixture.stats(), {
      disableClicks: 1,
      confirmClicks: 1,
      sizeChartActive: false,
    });
  });

  it('is a no-op when no active size chart is present', async () => {
    const fixture = createPage({ active: false });

    const result = await disableSizeChart(fixture.page, {
      confirmAttempts: 1,
      readbackAttempts: 1,
      intervalMs: 0,
    });

    assert.deepEqual(result, { changed: false, disabled: true });
    assert.equal(fixture.stats().disableClicks, 0);
  });

  it('fails closed when the confirmation or disabled-state readback is missing', async () => {
    const noConfirm = createPage({ confirmAvailable: false });
    await assert.rejects(
      () => disableSizeChart(noConfirm.page, {
        confirmAttempts: 1,
        readbackAttempts: 1,
        intervalMs: 0,
      }),
      (error) => error.code === 'E_BUSINESS'
        && error.detail.issue === 'size_chart_disable_confirmation_missing',
    );

    const stale = createPage({ readbackSucceeds: false });
    await assert.rejects(
      () => disableSizeChart(stale.page, {
        confirmAttempts: 1,
        readbackAttempts: 1,
        intervalMs: 0,
      }),
      (error) => error.code === 'E_BUSINESS'
        && error.detail.issue === 'size_chart_disable_readback_mismatch',
    );
  });
});
