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

export async function selectCategory(page, searchText) {
  const log = getLogger();
  await page.goto(CATEGORY_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(2000);

  const searchInput = await findFirst(page, SELECTORS.categorySearch, 10000);
  if (!searchInput) {
    throw new PddCliError({ code: 'E_BUSINESS', message: '分类搜索框未找到', exitCode: ExitCodes.BUSINESS });
  }
  await searchInput.click();
  await setInputValue(page, searchInput, searchText);
  await page.waitForTimeout(1500);

  const firstResult = await page.$(`li:has-text("${searchText.split(' > ').pop()}")`);
  if (!firstResult) {
    throw new PddCliError({
      code: 'E_BUSINESS',
      message: `分类搜索无结果: ${searchText}`,
      hint: '确认分类路径名正确',
      exitCode: ExitCodes.BUSINESS,
    });
  }
  await firstResult.click();
  await page.waitForTimeout(500);

  log.info({ searchText }, 'goods-publish: category selected');

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

export async function fillGoodsForm(page, source, warnings) {
  const log = getLogger();
  await page.waitForTimeout(3000);
  await dismissOverlays(page);

  const name = source.goodsName || '';
  const titleInput = await findFirst(page, SELECTORS.goodsTitle);
  if (titleInput && name) {
    await setInputValue(page, titleInput, name);
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

  await fillPrices(page, source.price, log);
}

async function fillPrices(page, priceStr, log) {
  const price = parseFloat(priceStr || '0');
  if (!price || price <= 0) return;

  const groupPrice = price.toFixed(2);
  const singlePrice = (price * 1.5).toFixed(2);
  const marketPrice = (price * 2).toFixed(2);

  const priceInputs = await page.$$('input[placeholder*="请输入"]');
  const marketInput = await findFirst(page, SELECTORS.marketPrice);

  if (priceInputs.length >= 2) {
    await setInputValue(page, priceInputs[0], groupPrice);
    await setInputValue(page, priceInputs[1], singlePrice);
    log.info({ groupPrice, singlePrice }, 'goods-publish: SKU prices filled');
  }

  if (marketInput) {
    await setInputValue(page, marketInput, marketPrice);
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

async function setInputValue(page, element, value) {
  await element.evaluate((el, val) => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
      || Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
    if (setter) setter.call(el, val);
    else el.value = val;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
}
