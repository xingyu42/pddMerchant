import { PddCliError, ExitCodes } from '../../infra/errors.js';
import { getLogger } from '../../infra/logger.js';
import { downloadImagesToTemp, uploadDetailImages } from './image-handler.js';
import { parseSkuText } from './source-scraper.js';
import { evaluateInMainWorld } from '../browser.js';

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
 * 从商品详情纯文本中提取结构化属性（"属性名：属性值" 模式）。
 * 仅提取分隔符左右非空、值不含句读的键值对。纯函数，便于单测。
 */
export function parseProperties(text) {
  if (!text || typeof text !== 'string') return [];
  const pattern = /([^：:\n，,]{1,20})[：:]\s*([^，,。；;\n]{1,50})/g;
  const seen = new Set();
  const props = [];
  let match;
  while ((match = pattern.exec(text)) !== null) {
    const name = match[1].trim();
    const value = match[2].trim();
    if (name && value && !seen.has(name)) {
      seen.add(name);
      props.push({ name, value });
    }
  }
  return props;
}

export function countSkuCombinations(skuDims) {
  if (!Array.isArray(skuDims) || skuDims.length === 0) return 1;
  return skuDims.reduce((total, dim) => total * Math.max(0, dim?.values?.length ?? 0), 1);
}

export function mapSkuTableColumns(headers) {
  const normalized = headers.map((header) => String(header ?? '').replace(/[\s*]/g, ''));
  return {
    stock: normalized.findIndex((header) => header === '库存' || header.endsWith('库存')),
    groupPrice: normalized.findIndex((header) => header.includes('拼单价') || header.includes('团购价')),
    singlePrice: normalized.findIndex((header) => header.includes('单买价')),
  };
}

function dimensionValueText(value) {
  if (value && typeof value === 'object') return String(value.text ?? value.name ?? value.value ?? '').trim();
  return String(value ?? '').trim();
}

function normalizeSkuSpecValue(value) {
  const normalized = String(value ?? '').trim().toLowerCase().replace(/\s+/g, '');
  return /^\d+(?:\.\d+)?(?:cm|厘米)$/.test(normalized)
    ? normalized.replace(/(?:cm|厘米)$/, '')
    : normalized;
}

export function matchSkuPricingToTableRows(rowModels, skuPricing) {
  if (!Array.isArray(rowModels) || !Array.isArray(skuPricing) || rowModels.length !== skuPricing.length) {
    return { ok: false, issue: 'sku_combination_count_mismatch', rowIndexes: [] };
  }
  if (rowModels.length === 1 && Object.keys(skuPricing[0]?.specValues ?? {}).length === 0) {
    return { ok: true, issue: null, rowIndexes: [0] };
  }
  const used = new Set();
  const rowIndexes = [];
  for (const sku of skuPricing) {
    const expectedValues = Object.values(sku?.specValues ?? {})
      .map(normalizeSkuSpecValue)
      .filter(Boolean);
    if (expectedValues.length === 0) {
      return { ok: false, issue: 'sku_spec_values_missing', rowIndexes: [] };
    }
    const candidates = [];
    rowModels.forEach((row, index) => {
      if (used.has(index)) return;
      const cells = (row?.texts ?? []).map(normalizeSkuSpecValue);
      if (expectedValues.every((value) => cells.includes(value))) candidates.push(index);
    });
    if (candidates.length !== 1) {
      return { ok: false, issue: 'sku_combination_mismatch', rowIndexes: [] };
    }
    used.add(candidates[0]);
    rowIndexes.push(candidates[0]);
  }
  return { ok: true, issue: null, rowIndexes };
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
  await evaluateInMainWorld(page, () => {
    document.querySelectorAll('[data-testid="beast-core-modal"]').forEach(el => el.remove());
    document.querySelectorAll('[class*="MDL_outerWrapper"]').forEach(el => el.remove());
  });
  await page.waitForTimeout(500);
}

function classifySkuDimensions(skuDims) {
  const classified = { color: null, size: null, unsupported: [] };
  for (const dimension of skuDims) {
    const name = String(dimension?.name ?? '').trim();
    if (/颜色|花色/.test(name) && !classified.color) classified.color = dimension;
    else if (/尺码|尺寸|身高/.test(name) && !classified.size) classified.size = dimension;
    else classified.unsupported.push(name || 'unknown');
  }
  return classified;
}

async function selectColorValues(page, root, dimension) {
  const values = dimension.values.map(dimensionValueText).filter(Boolean);
  const inputs = root.locator('input[placeholder="选择或输入主色"]');
  if (values.length === 0 || await inputs.count() === 0) {
    throw new PddCliError({ code: 'E_BUSINESS', message: '商家表单主色输入框未找到', exitCode: ExitCodes.BUSINESS });
  }
  for (const value of values) {
    let input = null;
    const inputCount = await inputs.count();
    for (let index = 0; index < inputCount; index += 1) {
      const candidate = inputs.nth(index);
      if (!(await candidate.inputValue()).trim()) {
        input = candidate;
        break;
      }
    }
    if (!input) {
      throw new PddCliError({ code: 'E_BUSINESS', message: '没有可写入的主色输入行', exitCode: ExitCodes.BUSINESS });
    }
    const items = page.locator('.spec-color-menu:visible .menu-item');
    const expected = normalizeSkuSpecValue(value);
    let matches = [];
    // 新建草稿页的标准色数据可能晚于输入框出现。每轮都重新派发真实键盘事件，
    // 不能只盯着第一次输入后的空菜单等待，否则数据就绪后也不会重新查询。
    for (let queryAttempt = 0; queryAttempt < 3 && matches.length === 0; queryAttempt += 1) {
      await input.click();
      await input.fill('');
      await input.pressSequentially(value, { delay: 80 });
      for (let pollAttempt = 0; pollAttempt < 30; pollAttempt += 1) {
        const itemTexts = await items.allInnerTexts();
        matches = itemTexts
          .map((text, index) => ({ text: normalizeSkuSpecValue(text), index }))
          .filter((item) => item.text === expected);
        if (matches.length > 0) break;
        await page.waitForTimeout(100);
      }
    }
    if (matches.length !== 1) {
      await input.fill('');
      throw new PddCliError({
        code: 'E_BUSINESS',
        message: '源商品颜色无法与商家标准色唯一匹配',
        detail: { match_count: matches.length },
        exitCode: ExitCodes.BUSINESS,
      });
    }
    await items.nth(matches[0].index).click();
    await page.waitForTimeout(100);
  }
}

async function selectSizeValues(root, dimension) {
  const values = dimension.values.map(dimensionValueText).filter(Boolean);
  const labels = root.locator('label:has(input[type="checkbox"])');
  const labelTexts = await labels.allInnerTexts();
  const selections = values.map((value) => {
    const expected = normalizeSkuSpecValue(value);
    const indexes = labelTexts
      .map((text, index) => ({ text: normalizeSkuSpecValue(text), index }))
      .filter((item) => item.text === expected)
      .map((item) => item.index);
    return { value, indexes };
  });
  if (selections.some((selection) => selection.indexes.length !== 1)) {
    throw new PddCliError({
      code: 'E_BUSINESS',
      message: '源商品尺码无法与商家规格值唯一匹配',
      detail: { unmatched_count: selections.filter((selection) => selection.indexes.length !== 1).length },
      exitCode: ExitCodes.BUSINESS,
    });
  }
  for (const selection of selections) {
    const label = labels.nth(selection.indexes[0]);
    const checkbox = label.locator('input[type="checkbox"]');
    if (!(await checkbox.isChecked())) await label.click();
  }
}

async function waitForSkuRows(page, expectedCount) {
  let tableFound = false;
  let actualCount = 0;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const table = await findSkuTable(page);
    tableFound = Boolean(table);
    actualCount = table ? await table.locator('tbody tr').count() : 0;
    if (actualCount === expectedCount) return;
    await page.waitForTimeout(200);
  }
  throw new PddCliError({
    code: 'E_BUSINESS',
    message: '商家 SKU 表格未生成完整规格组合',
    detail: { expected_skus: expectedCount, actual_skus: actualCount, table_found: tableFound },
    exitCode: ExitCodes.BUSINESS,
  });
}

async function fillSkuDimensions(page, skuDims, expectedCount, log) {
  if (!Array.isArray(skuDims) || skuDims.length === 0) return;
  const classified = classifySkuDimensions(skuDims);
  if (classified.unsupported.length > 0) {
    throw new PddCliError({
      code: 'E_BUSINESS',
      message: '商家表单暂不支持该源商品规格类型',
      detail: { unsupported_dimension_count: classified.unsupported.length },
      exitCode: ExitCodes.BUSINESS,
    });
  }
  const root = page.locator('.goods-sku-row.standard-spec .goods-sku-box').first();
  if (await root.count() === 0) {
    throw new PddCliError({ code: 'E_BUSINESS', message: '商品规格填写区域未找到', exitCode: ExitCodes.BUSINESS });
  }
  if (classified.size) await selectSizeValues(root, classified.size);
  if (classified.color) await selectColorValues(page, root, classified.color);
  await waitForSkuRows(page, expectedCount);
  log.info({ dimensionCount: skuDims.length, skuCount: expectedCount }, 'goods-publish: SKU dimensions selected');
}

export async function fillGoodsForm(page, source, warnings, pricing) {
  const log = getLogger();
  const skuDims = Array.isArray(source.skuDimensions) && source.skuDimensions.length > 0
    ? source.skuDimensions
    : parseSkuText(source.skuText || '');
  const skuCount = Array.isArray(source.skus) && source.skus.length > 0
    ? source.skus.length
    : countSkuCombinations(skuDims);

  await page.waitForTimeout(3000);
  await dismissOverlays(page);
  await fillSkuDimensions(page, skuDims, skuCount, log);

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

  // 详情图允许部分成功，但全部失败必须停止，避免无详情图草稿被误报为完成。
  if (source.detailImgs?.length > 0) {
    const result = await uploadDetailImagesViaForm(page, source.detailImgs, log);
    warnings.push(...result.warnings);
  }

  await fillPrices(page, pricing, warnings, log);

  // 目前只解析属性用于诊断，不猜测商家后台动态字段，避免填入同名但错误的输入框。
  if (source.properties) {
    const props = parseProperties(source.properties);
    if (props.length > 0) warnings.push('property_mapping_unavailable');
  }
}

export async function fillPrices(page, pricing, warnings, log) {
  const { pricingPlan, pricingValidation } = pricing ?? {};
  if (!pricingPlan || !pricingValidation) {
    warnings.push('pricing_plan_missing');
    return;
  }

  if (pricingValidation.warnings.length > 0) {
    warnings.push(...pricingValidation.warnings);
  }

  if (!pricingValidation.ok) {
    throw new PddCliError({
      code: 'E_BUSINESS',
      message: `定价验证失败: ${pricingValidation.errors.join('; ')}`,
      exitCode: ExitCodes.BUSINESS,
    });
  }

  const { marketPrice, skuPricing } = pricingPlan;
  await fillSkuTableRows(page, skuPricing, log);
  const marketInput = await findFirst(page, SELECTORS.marketPrice);

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

// 详情图上传：下载到临时目录后委托 image-handler.uploadDetailImages（定位第 8 个
// 文件输入，即详情图区域）。下载与上传解耦，临时文件始终清理。
async function uploadDetailImagesViaForm(page, urls, log) {
  const imgResult = await downloadImagesToTemp(urls);
  try {
    if (imgResult.filePaths.length === 0) {
      throw new PddCliError({
        code: 'E_BUSINESS',
        message: '详情图全部下载失败',
        hint: '没有可上传的详情图，已停止保存草稿',
        exitCode: ExitCodes.BUSINESS,
      });
    }
    const uploaded = await uploadDetailImages(page, imgResult.filePaths);
    const warnings = [...uploaded.warnings];
    if (imgResult.warnings.length > 0 || imgResult.filePaths.length < urls.length) {
      warnings.push('detail_image_download_partial');
    }
    log.info({ completed: uploaded.completed, requested: urls.length }, 'goods-publish: detail images uploaded');
    return { ...uploaded, warnings: [...new Set(warnings)] };
  } finally {
    imgResult.cleanup();
  }
}

const SAVE_DRAFT_PATH = '/glide/mms/goodsCommit/action/edit';

function isSaveDraftUrl(url) {
  try {
    const parsed = typeof url === 'string' ? new URL(url) : url;
    return parsed.pathname.endsWith(SAVE_DRAFT_PATH);
  } catch {
    return String(url ?? '').includes(SAVE_DRAFT_PATH);
  }
}

function costTemplateBodyError(message) {
  return new PddCliError({
    code: 'E_BUSINESS',
    message,
    hint: '确认草稿保存请求仍为 JSON 格式，并包含可注入的编辑 payload',
    exitCode: ExitCodes.BUSINESS,
  });
}

export function injectCostTemplateIntoEditBody(postData, costTemplateId) {
  if (!postData) throw costTemplateBodyError('保存草稿请求体为空，无法写入运费模板');
  let body;
  try {
    body = JSON.parse(postData);
  } catch {
    throw costTemplateBodyError('保存草稿请求体不是 JSON，无法写入运费模板');
  }
  body.cost_template_id = costTemplateId;
  return JSON.stringify(body);
}

function readSpecText(spec) {
  if (typeof spec === 'string') return spec;
  if (Array.isArray(spec)) return spec.map(readSpecText).join('|');
  if (spec && typeof spec === 'object') return Object.values(spec).map(readSpecText).join('|');
  return String(spec ?? '');
}

function toPriceCents(price) {
  const value = Number(price);
  return Number.isFinite(value) && value > 0 ? Math.round(value * 100) : null;
}

function matchExpectedSku(rawSkus, expectedSku, usedIndexes) {
  const expectedValues = Object.values(expectedSku.specValues ?? {})
    .map(normalizeSkuSpecValue)
    .filter(Boolean);
  for (let index = 0; index < rawSkus.length; index += 1) {
    if (usedIndexes.has(index)) continue;
    const tokens = readSpecText(rawSkus[index]?.spec)
      .split(/[|,，;/\s]+/)
      .map(normalizeSkuSpecValue)
      .filter(Boolean);
    if (expectedValues.every((value) => tokens.includes(value))) return index;
  }
  return -1;
}

export function validateDraftEditPayload(body, options = {}) {
  const issues = new Set();
  const payload = typeof body === 'string' ? JSON.parse(body) : body;
  const gallery = Array.isArray(payload?.gallery) ? payload.gallery : [];
  const skus = Array.isArray(payload?.skus) ? payload.skus : [];
  if (!String(payload?.goods_name ?? '').trim()) issues.add('title_empty');
  if (gallery.length === 0) issues.add('no_images');
  const templateId = payload?.cost_template_id ?? payload?.costTemplateId;
  if (!templateId) issues.add('no_cost_template');
  else if (options.expectedCostTemplateId != null && String(templateId) !== String(options.expectedCostTemplateId)) {
    issues.add('cost_template_mismatch');
  }
  if (skus.length === 0) issues.add('no_skus');
  for (const sku of skus) {
    if (!(Number(sku?.multi_price) > 0)) issues.add('sku_group_price_invalid');
    if (!(Number(sku?.price) > 0)) issues.add('sku_single_price_invalid');
    const stock = sku?.quantity_delta ?? sku?.quantity;
    if (!Number.isSafeInteger(Number(stock)) || Number(stock) < 0) issues.add('sku_stock_missing');
  }

  const expectedSkus = Array.isArray(options.expectedSkuPricing) ? options.expectedSkuPricing : null;
  if (expectedSkus) {
    if (expectedSkus.length !== skus.length) issues.add('sku_combination_count_mismatch');
    const usedIndexes = new Set();
    for (const expectedSku of expectedSkus) {
      const index = matchExpectedSku(skus, expectedSku, usedIndexes);
      if (index < 0) {
        issues.add('sku_combination_mismatch');
        continue;
      }
      usedIndexes.add(index);
      const rawSku = skus[index];
      if (Number(rawSku.multi_price) !== toPriceCents(expectedSku.groupPrice)) issues.add('sku_group_price_mismatch');
      if (Number(rawSku.price) !== toPriceCents(expectedSku.singlePrice)) issues.add('sku_single_price_mismatch');
      const stock = Number(rawSku.quantity_delta ?? rawSku.quantity);
      if (stock !== expectedSku.stock) issues.add('sku_stock_mismatch');
    }
  }
  return {
    ok: issues.size === 0,
    issues: [...issues],
    summary: { gallery_count: gallery.length, sku_count: skus.length },
  };
}

async function routeSaveDraftWithCostTemplate(page, options, run) {
  const costTemplateId = options.costTemplateId;
  const hasTemplate = costTemplateId != null && String(costTemplateId).trim() !== '';
  if (!hasTemplate && !options.strictPayload) return { result: await run(), payloadValidation: null };
  let injected = false;
  let routeError = null;
  let payloadValidation = null;
  let rejectRouteFailure;
  const routeFailure = new Promise((_, reject) => {
    rejectRouteFailure = reject;
  });
  const handler = async (route) => {
    try {
      const postData = route.request().postData();
      const nextPostData = hasTemplate
        ? injectCostTemplateIntoEditBody(postData, costTemplateId)
        : postData;
      if (options.strictPayload) {
        payloadValidation = validateDraftEditPayload(nextPostData, {
          expectedCostTemplateId: costTemplateId,
          expectedSkuPricing: options.expectedSkuPricing,
        });
        if (!payloadValidation.ok) {
          throw new PddCliError({
            code: 'E_BUSINESS',
            message: `保存草稿请求校验失败: ${payloadValidation.issues.join('; ')}`,
            hint: '页面表单状态与源商品数据不一致，已在请求发出前停止',
            detail: { issues: payloadValidation.issues, ...payloadValidation.summary },
            exitCode: ExitCodes.BUSINESS,
          });
        }
      }
      injected = true;
      await route.continue({ postData: nextPostData });
    } catch (err) {
      routeError = err instanceof PddCliError
        ? err
        : costTemplateBodyError(err?.message || '保存草稿请求注入失败');
      await route.abort('failed').catch(() => {});
      rejectRouteFailure(routeError);
    }
  };

  await page.route(isSaveDraftUrl, handler);
  try {
    let result;
    try {
      result = await Promise.race([run(), routeFailure]);
    } catch (err) {
      if (routeError) throw routeError;
      if (!injected) throw costTemplateBodyError('未捕获到保存草稿请求，无法写入运费模板');
      throw err;
    }
    if (routeError) throw routeError;
    if (!injected) throw costTemplateBodyError('未捕获到保存草稿请求，无法写入运费模板');
    return { result, payloadValidation };
  } finally {
    await page.unroute(isSaveDraftUrl, handler).catch(() => {});
  }
}

export async function clickSaveDraft(page, goodsCommitId, options = {}) {
  const log = getLogger();
  const saveBtn = await findFirst(page, SELECTORS.saveDraft, 5000);
  if (!saveBtn) {
    throw new PddCliError({ code: 'E_BUSINESS', message: '"保存草稿"按钮未找到', exitCode: ExitCodes.BUSINESS });
  }

  const routed = await routeSaveDraftWithCostTemplate(page, options, () =>
    Promise.all([
      page.waitForResponse(r => isSaveDraftUrl(r.url()), { timeout: 30000 }),
      saveBtn.click(),
    ])
  );
  const [response] = routed.result;

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

  let verification = { ok: true, issues: [], skipped: true };
  if (goodsCommitId) {
    verification = await verifyDraft(page, goodsCommitId, log, {
      expectedCostTemplateId: options.costTemplateId,
    });
    if (options.strictVerify) assertDraftVerification(verification, goodsCommitId);
  }

  return { ...result, payload_validation: routed.payloadValidation?.summary ?? null, verification };
}

function collectDraftIssues(d, expectedCostTemplateId) {
  const issues = [];
  if (!d.goods_name) issues.push('title_empty');
  const actualTemplateId = d.cost_template_id ?? d.costTemplateId;
  if (!actualTemplateId) {
    issues.push('no_cost_template');
  } else if (expectedCostTemplateId != null && String(actualTemplateId) !== String(expectedCostTemplateId)) {
    issues.push('cost_template_mismatch');
  }
  if (!Array.isArray(d.gallery) || d.gallery.length === 0) issues.push('no_images');
  return issues;
}

const DRAFT_DETAIL_SUCCESS_CODES = new Set(['0', '1000000']);

function valueType(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function resolveDraftDetailCandidate(payload) {
  if (!isObject(payload)) return { candidate: null, path: null, resultValue: undefined };
  if (Object.hasOwn(payload, 'result')) {
    const resultValue = payload.result;
    if (!isObject(resultValue)) return { candidate: null, path: null, resultValue };
    if (isObject(resultValue.data)) {
      return { candidate: resultValue.data, path: 'result.data', resultValue };
    }
    return { candidate: resultValue, path: 'result', resultValue };
  }
  if (Object.hasOwn(payload, 'data')) {
    const dataValue = payload.data;
    if (!isObject(dataValue)) return { candidate: null, path: null, resultValue: dataValue };
    if (isObject(dataValue.result)) {
      return { candidate: dataValue.result, path: 'data.result', resultValue: dataValue };
    }
    return { candidate: dataValue, path: 'data', resultValue: dataValue };
  }
  const hasDraftField = [
    'goods_name', 'goodsName', 'cost_template_id', 'costTemplateId', 'gallery',
  ].some((key) => Object.hasOwn(payload, key));
  return hasDraftField
    ? { candidate: payload, path: 'root', resultValue: payload }
    : { candidate: null, path: null, resultValue: undefined };
}

export function normalizeDraftDetailResponse(response) {
  const wrapped = isObject(response) && Object.hasOwn(response, 'payload');
  const payload = wrapped ? response.payload : response;
  const httpStatus = wrapped ? response.http_status ?? null : null;
  const httpOk = wrapped ? response.http_ok !== false : true;
  const errorCode = isObject(payload) ? payload.error_code ?? payload.errorCode ?? null : null;
  const successFlag = isObject(payload) && typeof payload.success === 'boolean'
    ? payload.success
    : null;
  const businessFailed = successFlag === false
    || (errorCode != null && !DRAFT_DETAIL_SUCCESS_CODES.has(String(errorCode)));
  const { candidate, path, resultValue } = resolveDraftDetailCandidate(payload);
  const observation = {
    http_status: httpStatus,
    business_success: successFlag,
    error_code: errorCode,
    result_type: valueType(resultValue),
    candidate_path: path,
    field_keys: candidate ? Object.keys(candidate).sort().slice(0, 50) : [],
    reason: null,
  };

  if (!httpOk || businessFailed || !candidate) {
    observation.reason = !httpOk
      ? 'http_failure'
      : (businessFailed ? 'business_failure' : 'result_unavailable');
    return { available: false, data: null, observation };
  }

  return {
    available: true,
    data: {
      goods_name: candidate.goods_name ?? candidate.goodsName ?? '',
      cost_template_id: candidate.cost_template_id ?? candidate.costTemplateId ?? null,
      gallery: candidate.gallery ?? [],
    },
    observation,
  };
}

function assertDraftVerification(verification, goodsCommitId) {
  if (verification.ok) return;
  throw new PddCliError({
    code: 'E_BUSINESS',
    message: `草稿校验失败: ${verification.issues.join('; ')}`,
    hint: '保存草稿后关键字段缺失，已阻止继续提交发布',
    detail: { goods_commit_id: goodsCommitId, issues: verification.issues },
    exitCode: ExitCodes.BUSINESS,
  });
}

async function verifyDraft(page, goodsCommitId, log, options = {}) {
  try {
    const response = await evaluateInMainWorld(page, async (id) => {
      const r = await fetch('/glide/v2/mms/query/commit/detail', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ goods_commit_id: id }),
      });
      return {
        http_status: r.status,
        http_ok: r.ok,
        payload: await r.json(),
      };
    }, goodsCommitId);

    const normalized = normalizeDraftDetailResponse(response);
    log.debug({ goodsCommitId, ...normalized.observation },
      'goods-publish: draft verification response observed');
    if (!normalized.available) {
      log.warn({ goodsCommitId, ...normalized.observation },
        'goods-publish: draft verification unavailable');
      return {
        ok: true,
        issues: [],
        skipped: true,
        warnings: ['draft_verification_unavailable'],
        observation: normalized.observation,
      };
    }

    const issues = collectDraftIssues(normalized.data, options.expectedCostTemplateId);

    if (issues.length > 0) {
      log.warn({ issues, goodsCommitId }, 'goods-publish: draft verification found issues');
    } else {
      log.info({ goodsCommitId }, 'goods-publish: draft verified OK');
    }
    return { ok: issues.length === 0, issues, skipped: false, warnings: [] };
  } catch (err) {
    const observation = {
      http_status: null,
      business_success: null,
      error_code: err?.code ?? null,
      result_type: 'undefined',
      candidate_path: null,
      field_keys: [],
      reason: 'transport_error',
    };
    log.warn({ goodsCommitId, ...observation }, 'goods-publish: draft verification unavailable');
    return {
      ok: true,
      issues: [],
      skipped: true,
      warnings: ['draft_verification_unavailable'],
      observation,
    };
  }
}

async function findSkuTable(page) {
  // 真实后台把表头和数据行拆成两个相邻 table，共同放在 TB_outerWrapper 内。
  // 返回共同 wrapper 后，thead th 与 tbody tr 才能同时被后续逻辑定位。
  const wrappers = page.locator('[class*="TB_outerWrapper"]');
  const wrapperCount = await wrappers.count();
  for (let index = 0; index < wrapperCount; index += 1) {
    const wrapper = wrappers.nth(index);
    const text = await wrapper.innerText().catch(() => '');
    if (/库存/.test(text) && /拼单价|团购价/.test(text) && /单买价/.test(text)) return wrapper;
  }

  // 兼容旧版或测试中的单 table 结构。
  const tables = page.locator('table');
  const count = await tables.count();
  for (let index = 0; index < count; index += 1) {
    const table = tables.nth(index);
    const text = await table.innerText().catch(() => '');
    if (/库存/.test(text) && /拼单价|团购价/.test(text) && /单买价/.test(text)) return table;
  }
  return null;
}

async function fillSkuCell(row, domCellIndex, value) {
  if (!Number.isInteger(domCellIndex) || domCellIndex < 0) return { ok: false, actual: null };
  const input = row.locator('td').nth(domCellIndex).locator('input').first();
  if (await input.count() === 0) return { ok: false, actual: null };
  const expected = String(value);
  await input.fill(expected);
  const actual = await input.inputValue();
  const actualNumber = Number(actual);
  const expectedNumber = Number(expected);
  const numericallyEqual = actual.trim() !== ''
    && Number.isFinite(actualNumber)
    && Number.isFinite(expectedNumber)
    && actualNumber === expectedNumber;
  return { ok: actual === expected || numericallyEqual, actual };
}

async function readSkuTableRows(rows) {
  return rows.evaluateAll((elements) => {
    const pending = [];
    return elements.map((row, rowIndex) => {
      const texts = [];
      const domCellIndexes = [];
      let logicalColumn = 0;
      const advancePastRowSpans = () => {
        while (pending[logicalColumn]?.endRow >= rowIndex) {
          texts[logicalColumn] = pending[logicalColumn].text;
          domCellIndexes[logicalColumn] = null;
          logicalColumn += 1;
        }
      };
      Array.from(row.cells).forEach((cell, domCellIndex) => {
        advancePastRowSpans();
        const text = String(cell.innerText ?? '').trim();
        const colSpan = Math.max(1, Number(cell.colSpan) || 1);
        const rowSpan = Math.max(1, Number(cell.rowSpan) || 1);
        for (let offset = 0; offset < colSpan; offset += 1) {
          const column = logicalColumn + offset;
          texts[column] = text;
          domCellIndexes[column] = domCellIndex;
          if (rowSpan > 1) pending[column] = { text, endRow: rowIndex + rowSpan - 1 };
        }
        logicalColumn += colSpan;
      });
      while (pending.slice(logicalColumn).some((item) => item?.endRow >= rowIndex)) {
        advancePastRowSpans();
        if (!pending[logicalColumn] || pending[logicalColumn].endRow < rowIndex) logicalColumn += 1;
      }
      return { texts, domCellIndexes };
    });
  });
}

async function fillSkuTableRows(page, skuPricing, log) {
  if (!Array.isArray(skuPricing) || skuPricing.length === 0) {
    throw new PddCliError({
      code: 'E_BUSINESS',
      message: '缺少逐 SKU 定价与库存计划',
      exitCode: ExitCodes.BUSINESS,
    });
  }
  const table = await findSkuTable(page);
  if (!table) throw new PddCliError({ code: 'E_BUSINESS', message: 'SKU 表格未找到', exitCode: ExitCodes.BUSINESS });
  const headers = await table.locator('thead th').allInnerTexts();
  const columns = mapSkuTableColumns(headers);
  if (Object.values(columns).some((index) => index < 0)) {
    throw new PddCliError({ code: 'E_BUSINESS', message: 'SKU 表格关键列未找到', exitCode: ExitCodes.BUSINESS });
  }
  const rows = table.locator('tbody tr');
  const rowCount = await rows.count();
  if (rowCount !== skuPricing.length) {
    throw new PddCliError({
      code: 'E_BUSINESS',
      message: 'SKU 表格行数与源商品不一致',
      detail: { table_rows: rowCount, source_skus: skuPricing.length },
      exitCode: ExitCodes.BUSINESS,
    });
  }
  const rowModels = await readSkuTableRows(rows);
  const matched = matchSkuPricingToTableRows(rowModels, skuPricing);
  if (!matched.ok) {
    throw new PddCliError({
      code: 'E_BUSINESS',
      message: 'SKU 表格规格行无法与源商品唯一匹配',
      detail: { issue: matched.issue, table_rows: rowCount, source_skus: skuPricing.length },
      exitCode: ExitCodes.BUSINESS,
    });
  }
  for (let pricingIndex = 0; pricingIndex < skuPricing.length; pricingIndex += 1) {
    const rowIndex = matched.rowIndexes[pricingIndex];
    const row = rows.nth(rowIndex);
    const rowModel = rowModels[rowIndex];
    const sku = skuPricing[pricingIndex];
    // React 会在每次单元格变更后重绘当前行；并行 fill 会让多个 locator 在重绘
    // 中命中同一输入框，出现库存串入拼单价。必须按列顺序写入并逐项读回。
    const results = [];
    results.push(await fillSkuCell(row, rowModel.domCellIndexes[columns.stock], sku.stock));
    results.push(await fillSkuCell(row, rowModel.domCellIndexes[columns.groupPrice], sku.groupPrice));
    results.push(await fillSkuCell(row, rowModel.domCellIndexes[columns.singlePrice], sku.singlePrice));
    if (results.some((result) => !result.ok)) {
      throw new PddCliError({
        code: 'E_BUSINESS',
        message: 'SKU 价格或库存填写后读回失败',
        detail: {
          sku_index: pricingIndex,
          fields: {
            stock: results[0].ok,
            group_price: results[1].ok,
            single_price: results[2].ok,
          },
        },
        exitCode: ExitCodes.BUSINESS,
      });
    }
  }
  log.info({ skuCount: rowCount }, 'goods-publish: SKU prices and stock filled');
}
