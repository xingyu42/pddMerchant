import assert from 'node:assert/strict';
import { describe, it, vi } from 'vitest';
import { pickCategoryOptionIndex } from '../../src/adapter/goods-publish/draft-editor/category-draft.js';
import {
  disableSizeChart,
  fillFullCountDiscount,
  fillGoodsProperties,
} from '../../src/adapter/goods-publish/draft-editor/property-final-state.js';
import { clickSaveDraft } from '../../src/adapter/goods-publish/draft-editor/save-route.js';
import { prepareEditPayload, verifyDraftDetail } from '../../src/services/goods-publish/draft-guard.js';
import { ExitCodes, PddCliError } from '../../src/infra/errors.js';

describe('draft-editor decomposed sub-modules', () => {
  it('category-draft picks exact path or unique suffix and rejects ambiguous suffix', () => {
    assert.equal(
      pickCategoryOptionIndex(['男装 > T恤', '女装 > T恤'], '女装 > T恤'),
      1,
    );
    assert.equal(
      pickCategoryOptionIndex(['男装 > T恤', '女装 > 连衣裙'], '服饰 > 女装 > 连衣裙'),
      1,
    );
    assert.equal(
      pickCategoryOptionIndex(['男装 > T恤', '女装 > T恤'], '服饰 > 童装 > T恤'),
      -1,
    );
  });

  it('property-final-state uses trusted option click and reads back selected value', async () => {
    let selectedPlaceholder = '';
    const optionClick = vi.fn(async () => {
      selectedPlaceholder = '棉';
    });
    const inputClick = vi.fn(async () => {});
    const pressSequentially = vi.fn(async () => {});

    const row = {
      locator(selector) {
        if (selector === 'input') {
          return {
            evaluateAll: async (fn) => fn([{ value: '', getAttribute: () => selectedPlaceholder }]),
          };
        }
        if (selector.includes('Tag')) {
          return { allInnerTexts: async () => [] };
        }
        if (selector === 'input[placeholder="请选择"]') {
          return {
            count: async () => 1,
            first: () => ({
              click: inputClick,
              inputValue: async () => '',
              press: async () => {},
              pressSequentially,
            }),
          };
        }
        return { count: async () => 0 };
      },
      innerText: async () => `面料俗称\n${selectedPlaceholder}`,
    };

    const page = {
      waitForTimeout: async () => {},
      keyboard: { press: async () => {} },
      locator(selector) {
        if (selector === '.property-list') {
          return {
            evaluateAll: async () => ['面料俗称'],
            nth: () => row,
          };
        }
        if (selector === 'ul[role="listbox"]:visible li[role="option"]:visible') {
          return {
            allInnerTexts: async () => ['棉', '涤纶'],
            nth: () => ({ click: optionClick }),
          };
        }
        return { count: async () => 0 };
      },
    };

    await fillGoodsProperties(page, [{
      templateModuleId: 8001,
      templatePid: 1001,
      pid: 2001,
      name: '面料俗称',
      controlType: 1,
      values: [{ vid: 11, value: '棉' }],
    }]);

    assert.equal(optionClick.mock.calls.length, 1);
    assert.equal(pressSequentially.mock.calls.length, 1);
  });

  it('property-final-state disableSizeChart performs two-step official click + removal readback and no-ops when absent', async () => {
    const absentPage = {
      locator: () => ({ count: async () => 0 }),
    };
    assert.deepEqual(await disableSizeChart(absentPage), { changed: false, disabled: true });

    let removed = false;
    let confirmedVisible = false;
    const page = {
      waitForTimeout: async () => {},
      locator(selector) {
        if (selector.includes('disable_size_chart')) {
          return {
            count: async () => (removed ? 0 : 1),
            click: async () => { confirmedVisible = true; },
          };
        }
        if (selector.includes('sizeChart_sizeTable')) {
          return { count: async () => (removed ? 0 : 1) };
        }
        return { count: async () => 0 };
      },
      getByRole(_role, opts) {
        assert.equal(opts.name, '确认停用');
        return {
          count: async () => (confirmedVisible ? 1 : 0),
          click: async () => { removed = true; },
        };
      },
    };

    assert.deepEqual(
      await disableSizeChart(page, { confirmAttempts: 2, readbackAttempts: 2, intervalMs: 1 }),
      { changed: true, disabled: true },
    );
  });

  it('property-final-state fillFullCountDiscount enforces numeric blur readback', async () => {
    let inputVal = '';
    const page = {
      locator: () => ({
        count: async () => 1,
        fill: async (val) => { inputVal = val; },
        blur: async () => {},
        inputValue: async () => inputVal,
      }),
    };
    const res = await fillFullCountDiscount(page, 0.88);
    assert.deepEqual(res, { rate: 0.88, displayValue: '8.8', payloadValue: 88 });

    const mismatchPage = {
      locator: () => ({
        count: async () => 1,
        fill: async () => {},
        blur: async () => {},
        inputValue: async () => '9.5',
      }),
    };
    await assert.rejects(
      fillFullCountDiscount(mismatchPage, 0.88),
      (err) => err instanceof PddCliError && err.detail?.issue === 'full_count_discount_readback_mismatch',
    );
  });

  it('save-route aborts invalid edit payload and always calls unroute', async () => {
    let activeHandler = null;
    const routeAbort = vi.fn(async () => {});
    const unroute = vi.fn(async (_matcher, handler) => {
      if (activeHandler === handler) activeHandler = null;
    });

    const page = {
      waitForSelector: async () => ({
        click: async () => {
          await activeHandler({
            request: () => ({
              postData: () => JSON.stringify({
                goods_name: '',
                gallery: [],
                skus: [],
                goods_properties: [],
              }),
            }),
            continue: vi.fn(),
            abort: routeAbort,
          });
        },
      }),
      route: vi.fn(async (_matcher, handler) => { activeHandler = handler; }),
      unroute,
      waitForResponse: () => new Promise(() => {}),
    };

    await assert.rejects(
      clickSaveDraft(page, '7001', {
        costTemplateId: 3001,
        strictPayload: true,
        prepareEditPayload,
        verifyDraftDetail,
      }),
      (err) => err instanceof PddCliError && err.code === 'E_BUSINESS' && err.exitCode === ExitCodes.BUSINESS,
    );

    assert.equal(routeAbort.mock.calls.length, 1);
    assert.equal(routeAbort.mock.calls[0][0], 'failed');
    assert.equal(unroute.mock.calls.length, 1);
    assert.equal(activeHandler, null);
  });
});
