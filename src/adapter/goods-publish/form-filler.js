import { PddCliError, ExitCodes } from '../../infra/errors.js';
import { getLogger } from '../../infra/logger.js';
import { downloadImagesToTemp } from './image-handler.js';

const CATEGORY_URL = 'https://mms.pinduoduo.com/goods/category?msfrom=mms_sidenav';

const SELECTORS = {
  categorySearch: [
    'input[placeholder*="搜索分类"]',
    'input[placeholder*="分类"]',
    'input[placeholder*="类目"]',
  ],
  confirmPublish: [
    'button:has-text("确认发布该类商品")',
    'button:has-text("确认发布")',
    'button:has-text("下一步")',
  ],
  goodsTitle: [
    'input[placeholder*="标题"]',
    'textarea[placeholder*="标题"]',
    'input[placeholder*="商品名"]',
    'textarea[placeholder*="商品名"]',
  ],
  saveDraft: [
    'button:has-text("保存草稿")',
    'button:has-text("保存")',
  ],
  marketPrice: [
    'input[placeholder*="大于商品最大单买价"]',
    'input[placeholder*="市场价"]',
    'input[placeholder*="原价"]',
  ],
};

async function findFirst(page, selectors, timeout = 5000) {
  for (const sel of selectors) {
    try {
      const el = await page.waitForSelector(sel, { timeout: Math.min(timeout, 2000), state: 'visible' });
      if (el) return el;
    } catch { /* next */ }
  }
  for (const sel of selectors) {
    const el = await page.$(sel);
    if (el) return el;
  }
  return null;
}

export function normalizeCategoryText(s) {
  return String(s ?? '').replace(/\s+/g, '').replace(/＞/g, '>');
}

/**
 * 在下拉选项文本中选出与目标类目路径匹配的索引。
 * 优先级：① 完整路径精确匹配 → ② 叶子词的"唯一"后缀匹配。
 * 无精确匹配且后缀匹配非唯一（或无匹配）→ 返回 -1（不盲选首项，避免选错类目）。
 * 纯函数，便于单测。
 */
export function pickCategoryOptionIndex(itemTexts, searchText) {
  if (!Array.isArray(itemTexts) || itemTexts.length === 0) return -1;
  const target = normalizeCategoryText(searchText);
  const leaf = normalizeCategoryText(String(searchText ?? '').split(' > ').pop());

  const exact = itemTexts.findIndex((t) => normalizeCategoryText(t) === target);
  if (exact >= 0) return exact;

  if (!leaf) return -1;
  const suffixMatches = [];
  itemTexts.forEach((t, i) => {
    const n = normalizeCategoryText(t);
    if (n === leaf || n.endsWith('>' + leaf)) suffixMatches.push(i);
  });
  // 仅当后缀匹配唯一时才采用，避免"女装>连衣裙" vs "童装>连衣裙"选错
  return suffixMatches.length === 1 ? suffixMatches[0] : -1;
}

async function readOptionTexts(page) {
  return page.locator('li[class*="searchItem"]').allInnerTexts();
}

// 校验"已选分类"容器在超时内可见且包含所选类目的"完整路径"（非仅叶子词），
// 把合成事件/选错项导致的静默失败转成显式错误。
async function assertCategorySelected(page, pickedText) {
  const expected = normalizeCategoryText(pickedText);
  try {
    await page.waitForFunction(
      (exp) => {
        const cont = document.querySelector('[class*="bottom-container"]');
        if (!cont || cont.className.includes('hidden')) return false;
        const got = (cont.innerText || '').replace(/\s+/g, '').replace(/＞/g, '>');
        return got.includes(exp);
      },
      expected,
      { timeout: 8000 },
    );
  } catch {
    throw new PddCliError({
      code: 'E_BUSINESS',
      message: '分类选择未生效（疑似输入方式或选择器问题）',
      hint: '确认分类搜索框使用真实键盘输入，且命中正确的下拉项',
      detail: { pickedText },
      exitCode: ExitCodes.BUSINESS,
    });
  }
}

export async function selectCategory(page, searchText) {
  const log = getLogger();
  await page.goto(CATEGORY_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(2000);

  const searchInput = await findFirst(page, SELECTORS.categorySearch, 10000);
  if (!searchInput) {
    throw new PddCliError({ code: 'E_BUSINESS', message: '分类搜索框未找到', exitCode: ExitCodes.BUSINESS });
  }
  const keyword = searchText.split(' > ').pop();
  await searchInput.click();
  await searchInput.fill('');
  // 真实键盘逐字键入：保持 PDD SPP 搜索组件的 React 内部状态同步，
  // 合成 input/change 事件（旧 setInputValue）会导致后续选项点击静默失效。
  // 注意：findFirst() 返回 ElementHandle，pressSequentially 是 Locator 专有 API，
  // 此处必须用 ElementHandle.type()（同样逐字派发真实键盘事件）。
  await searchInput.type(keyword, { delay: 80 });

  await page.waitForSelector('li[class*="searchItem"]', { timeout: 8000 }).catch(() => null);

  const optionTexts = await readOptionTexts(page);
  const idx = pickCategoryOptionIndex(optionTexts, searchText);
  if (idx < 0) {
    throw new PddCliError({
      code: 'E_BUSINESS',
      message: `分类无精确匹配: ${searchText}`,
      hint: '确认分类路径名与 PDD 官方类目一致（需完整路径精确匹配或叶子词唯一匹配）',
      detail: { searchText, options: optionTexts.slice(0, 10) },
      exitCode: ExitCodes.BUSINESS,
    });
  }
  const pickedText = optionTexts[idx];
  if (normalizeCategoryText(pickedText) !== normalizeCategoryText(searchText)) {
    log.warn({ searchText, picked: pickedText }, 'goods-publish: category exact-path miss, using unique suffix match');
  }
  await page.locator('li[class*="searchItem"]').nth(idx).click();

  await assertCategorySelected(page, pickedText);

  log.info({ searchText, picked: pickedText }, 'goods-publish: category selected');

  const confirmBtn = await findFirst(page, SELECTORS.confirmPublish, 5000);
  if (!confirmBtn) {
    throw new PddCliError({ code: 'E_BUSINESS', message: '"确认发布"按钮未找到', exitCode: ExitCodes.BUSINESS });
  }
  await confirmBtn.click();
  await page.waitForURL(/goods_add.*id=/, { timeout: 30000 });

  const url = new URL(page.url());
  const goodsCommitId = url.searchParams.get('id');
  const goodsId = url.searchParams.get('goods_id');

  if (!goodsCommitId || !goodsId) {
    throw new PddCliError({
      code: 'E_BUSINESS',
      message: '分类确认后未跳转到编辑页',
      detail: { url: page.url() },
      exitCode: ExitCodes.BUSINESS,
    });
  }

  log.info({ goodsCommitId, goodsId }, 'goods-publish: draft created via UI');
  return { goodsCommitId, goodsId };
}

export async function dismissOverlays(page) {
  await page.evaluate(() => {
    document.querySelectorAll('[data-testid="beast-core-modal"]').forEach(el => el.remove());
    document.querySelectorAll('[class*="MDL_outerWrapper"]').forEach(el => el.remove());
  });
  await page.waitForTimeout(500);
}

export async function fillGoodsForm(page, source, warnings, pricing) {
  const log = getLogger();
  await page.waitForTimeout(3000);
  await dismissOverlays(page);

  const name = source.goodsName || '';
  const titleInput = await findFirst(page, SELECTORS.goodsTitle);
  if (titleInput && name) {
    await titleInput.fill(name);
    log.info({ name: name.substring(0, 30) }, 'goods-publish: title filled');
  }

  if (source.carousel?.length > 0) {
    try {
      await uploadCarouselViaForm(page, source.carousel, log);
    } catch (err) {
      log.warn({ err: err?.message }, 'goods-publish: carousel upload failed');
      warnings.push('carousel_upload_skipped');
    }
  }

  await fillPrices(page, pricing, warnings, log);
}

async function fillPrices(page, pricing, warnings, log) {
  const { pricingPlan, pricingValidation } = pricing ?? {};
  if (!pricingPlan || !pricingValidation) {
    warnings.push('pricing_plan_missing');
    return;
  }

  if (pricingValidation.warnings.length > 0) {
    warnings.push(...pricingValidation.warnings);
  }

  if (process.env.PDD_PRICING_STRICT === '1' && !pricingValidation.ok) {
    throw new PddCliError({
      code: 'E_BUSINESS',
      message: `定价验证失败: ${pricingValidation.errors.join('; ')}`,
      exitCode: ExitCodes.BUSINESS,
    });
  }

  const { groupPrice, singlePrice, marketPrice } = pricingPlan;
  if (!groupPrice || groupPrice === '0.00') return;

  const priceInputs = await page.$$('input[placeholder*="请输入"]');
  const marketInput = await findFirst(page, SELECTORS.marketPrice);

  if (priceInputs.length >= 2) {
    await priceInputs[0].fill(groupPrice);
    await priceInputs[1].fill(singlePrice);
    log.info({ groupPrice, singlePrice }, 'goods-publish: SKU prices filled');
  }

  if (marketInput) {
    await marketInput.fill(marketPrice);
    log.info({ marketPrice }, 'goods-publish: market price filled');
  }
}

async function uploadCarouselViaForm(page, urls, log) {
  const imgResult = await downloadImagesToTemp(urls);
  try {
    if (imgResult.filePaths.length === 0) return;
    const fileInput = page.locator('input[type="file"][accept*="image"]').first();
    await fileInput.setInputFiles(imgResult.filePaths);
    log.info({ count: imgResult.filePaths.length }, 'goods-publish: carousel files set');
    await page.waitForTimeout(5000);
  } finally {
    imgResult.cleanup();
  }
}

export async function clickSaveDraft(page, goodsCommitId) {
  const log = getLogger();
  const saveBtn = await findFirst(page, SELECTORS.saveDraft, 5000);
  if (!saveBtn) {
    throw new PddCliError({ code: 'E_BUSINESS', message: '"保存草稿"按钮未找到', exitCode: ExitCodes.BUSINESS });
  }

  const [response] = await Promise.all([
    page.waitForResponse(r => r.url().includes('action/edit'), { timeout: 30000 }),
    saveBtn.click(),
  ]);

  const result = await response.json();
  const ok = result.success === true || result.error_code === 1000000;

  if (!ok) {
    throw new PddCliError({
      code: 'E_BUSINESS',
      message: result.error_msg || '保存草稿失败',
      detail: { raw: result },
      exitCode: ExitCodes.BUSINESS,
    });
  }

  log.info('goods-publish: draft saved via UI');

  if (goodsCommitId) {
    await verifyDraft(page, goodsCommitId, log);
  }

  return result;
}

async function verifyDraft(page, goodsCommitId, log) {
  try {
    const detail = await page.evaluate(async (id) => {
      const r = await fetch('/glide/v2/mms/query/commit/detail', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ goods_commit_id: id }),
      });
      return r.json();
    }, goodsCommitId);

    const d = detail?.result || detail;
    const issues = [];
    if (!d.goods_name) issues.push('title_empty');
    if (!d.cost_template_id) issues.push('no_cost_template');
    if (!Array.isArray(d.galleries) || d.galleries.length === 0) issues.push('no_images');

    if (issues.length > 0) {
      log.warn({ issues, goodsCommitId }, 'goods-publish: draft verification found issues');
    } else {
      log.info({ goodsCommitId, title: d.goods_name?.substring(0, 20) }, 'goods-publish: draft verified OK');
    }
    return issues;
  } catch (err) {
    log.debug({ err: err?.message }, 'goods-publish: draft verification skipped');
    return [];
  }
}
