export const SELECTORS = Object.freeze({
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
});

export async function findFirst(page, selectors, timeout = 5000) {
  for (const sel of selectors) {
    try {
      const el = await page.waitForSelector(sel, { timeout: Math.min(timeout, 2000), state: 'visible' });
      if (el) return el;
    } catch { /* next */ }
  }
  for (const sel of selectors) {
    if (typeof page.$ !== 'function') break;
    const el = await page.$(sel);
    if (el) return el;
  }
  return null;
}
