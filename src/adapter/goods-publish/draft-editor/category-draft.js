import { PddCliError, ExitCodes } from '../../../infra/errors.js';
import { getLogger } from '../../../infra/logger.js';
import { SELECTORS, findFirst } from './dom-helpers.js';

const CATEGORY_URL = 'https://mms.pinduoduo.com/goods/category?msfrom=mms_sidenav';

function normalizeCategoryText(s) {
  return String(s ?? '').replace(/\s+/g, '').replace(/＞/g, '>');
}

/**
 * Pick matching category option index: exact full path first, then unique leaf suffix.
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

async function searchAndPickCategory(page, searchText, log) {
  const searchInput = await findFirst(page, SELECTORS.categorySearch, 10000);
  if (!searchInput) {
    throw new PddCliError({ code: 'E_BUSINESS', message: '分类搜索框未找到', exitCode: ExitCodes.BUSINESS });
  }
  const keyword = searchText.split(' > ').pop();
  await searchInput.click();
  await searchInput.fill('');
  // 真实键盘逐字键入以同步 PDD SPP 搜索组件的 React 状态
  await searchInput.type(keyword, { delay: 80 });
  await page.waitForSelector('li[class*="searchItem"]', { timeout: 8000 }).catch(() => null);

  const optionTexts = await page.locator('li[class*="searchItem"]').allInnerTexts();
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
}

async function confirmAndReadDraftIds(page, log) {
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

export async function selectCategory(page, searchText) {
  const log = getLogger();
  await page.goto(CATEGORY_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await searchAndPickCategory(page, searchText, log);
  return confirmAndReadDraftIds(page, log);
}
