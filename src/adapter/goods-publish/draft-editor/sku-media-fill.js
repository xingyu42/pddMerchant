import { PddCliError, ExitCodes } from '../../../infra/errors.js';
import { getLogger } from '../../../infra/logger.js';
import { evaluateInMainWorld } from '../../browser.js';
import {
  downloadImagesToTemp,
  uploadCarouselImages,
  uploadDetailImages,
  uploadSkuPreviewImages,
} from '../image-handler.js';
import { parseSkuText } from '../source-scraper.js';
import { normalizeSkuSpecValue } from '../draft-contract.js';
import { SELECTORS, findFirst } from './dom-helpers.js';
import { fillGoodsProperties } from './property-final-state.js';

function countSkuCombinations(skuDims) {
  if (!Array.isArray(skuDims) || skuDims.length === 0) return 1;
  return skuDims.reduce((total, dim) => total * Math.max(0, dim?.values?.length ?? 0), 1);
}

function dimensionValueText(value) {
  if (value && typeof value === 'object') return String(value.text ?? value.name ?? value.value ?? '').trim();
  return String(value ?? '').trim();
}

async function dismissOverlays(page) {
  await evaluateInMainWorld(page, () => {
    document.querySelectorAll('[data-testid="beast-core-modal"]').forEach((el) => el.remove());
    document.querySelectorAll('[class*="MDL_outerWrapper"]').forEach((el) => el.remove());
  });
  await page.waitForTimeout(100);
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

async function findEmptyColorInput(inputs) {
  const inputCount = await inputs.count();
  for (let index = 0; index < inputCount; index += 1) {
    const candidate = inputs.nth(index);
    if (!(await candidate.inputValue()).trim()) return candidate;
  }
  throw new PddCliError({ code: 'E_BUSINESS', message: '没有可写入的主色输入行', exitCode: ExitCodes.BUSINESS });
}

async function selectSingleColorValue(page, inputs, value) {
  const input = await findEmptyColorInput(inputs);
  const items = page.locator('.spec-color-menu:visible .menu-item');
  const expected = normalizeSkuSpecValue(value);
  let matches = [];
  for (let queryAttempt = 0; queryAttempt < 2 && matches.length === 0; queryAttempt += 1) {
    await input.click();
    await input.fill('');
    await input.pressSequentially(value, { delay: 40 });
    for (let pollAttempt = 0; pollAttempt < 15; pollAttempt += 1) {
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

async function selectColorValues(page, root, dimension) {
  const values = dimension.values.map(dimensionValueText).filter(Boolean);
  const inputs = root.locator('input[placeholder="选择或输入主色"]');
  if (values.length === 0 || await inputs.count() === 0) {
    throw new PddCliError({ code: 'E_BUSINESS', message: '商家表单主色输入框未找到', exitCode: ExitCodes.BUSINESS });
  }
  for (const value of values) {
    await selectSingleColorValue(page, inputs, value);
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
  const unmatchedCount = selections.filter((selection) => selection.indexes.length !== 1).length;
  if (unmatchedCount > 0) {
    throw new PddCliError({
      code: 'E_BUSINESS',
      message: '源商品尺码无法与商家规格值唯一匹配',
      detail: { unmatched_count: unmatchedCount },
      exitCode: ExitCodes.BUSINESS,
    });
  }
  for (const selection of selections) {
    const label = labels.nth(selection.indexes[0]);
    const checkbox = label.locator('input[type="checkbox"]');
    if (!(await checkbox.isChecked())) await label.click();
  }
}

async function findSkuTable(page) {
  for (const selector of ['[class*="TB_outerWrapper"]', 'table']) {
    const tables = page.locator(selector);
    const count = await tables.count();
    for (let index = 0; index < count; index += 1) {
      const candidate = tables.nth(index);
      const text = await candidate.innerText().catch(() => '');
      if (/库存/.test(text) && /拼单价|团购价/.test(text) && /单买价/.test(text)) return candidate;
    }
  }
  return null;
}

async function waitForSkuRows(page, expectedCount) {
  let tableFound = false;
  let actualCount = 0;
  for (let attempt = 0; attempt < 30; attempt += 1) {
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

function mapSkuTableColumns(headers) {
  const normalized = headers.map((header) => String(header ?? '').replace(/[\s*]/g, ''));
  return {
    stock: normalized.findIndex((header) => header === '库存' || header.endsWith('库存')),
    groupPrice: normalized.findIndex((header) => header.includes('拼单价') || header.includes('团购价')),
    singlePrice: normalized.findIndex((header) => header.includes('单买价')),
  };
}

function findMatchingSkuRowIndex(rowModels, expectedValues, used) {
  const candidates = [];
  for (let index = 0; index < rowModels.length; index += 1) {
    if (used.has(index)) continue;
    const cells = (rowModels[index]?.texts ?? []).map(normalizeSkuSpecValue);
    if (expectedValues.every((value) => cells.includes(value))) candidates.push(index);
  }
  return candidates.length === 1 ? candidates[0] : -1;
}

function matchSkuPricingToTableRows(rowModels, skuPricing) {
  if (!Array.isArray(rowModels) || !Array.isArray(skuPricing) || rowModels.length !== skuPricing.length) {
    return { ok: false, issue: 'sku_combination_count_mismatch', rowIndexes: [] };
  }
  if (rowModels.length === 1 && Object.keys(skuPricing[0]?.specValues ?? {}).length === 0) {
    return { ok: true, issue: null, rowIndexes: [0] };
  }
  const used = new Set();
  const rowIndexes = [];
  for (const sku of skuPricing) {
    const expectedValues = Object.values(sku?.specValues ?? {}).map(normalizeSkuSpecValue).filter(Boolean);
    if (expectedValues.length === 0) return { ok: false, issue: 'sku_spec_values_missing', rowIndexes: [] };
    const matchedIndex = findMatchingSkuRowIndex(rowModels, expectedValues, used);
    if (matchedIndex < 0) return { ok: false, issue: 'sku_combination_mismatch', rowIndexes: [] };
    used.add(matchedIndex);
    rowIndexes.push(matchedIndex);
  }
  return { ok: true, issue: null, rowIndexes };
}

function skuValuesMatch(actual, expected) {
  const actualText = String(actual ?? '');
  const expectedText = String(expected ?? '');
  if (actualText === expectedText) return true;
  const actualNumber = Number(actualText);
  const expectedNumber = Number(expectedText);
  return actualText.trim() !== ''
    && Number.isFinite(actualNumber)
    && Number.isFinite(expectedNumber)
    && actualNumber === expectedNumber;
}

async function fillSkuCell(inputLocator, value) {
  if (!inputLocator || await inputLocator.count() === 0) return { ok: false, actual: null };
  const expected = String(value);
  await inputLocator.fill(expected);
  const actual = await inputLocator.inputValue();
  return { ok: skuValuesMatch(actual, expected), actual };
}

async function fillSkuRowFields(row, rowModel, columns, sku) {
  const fields = [
    { key: 'stock', domCellIndex: rowModel.domCellIndexes[columns.stock], value: sku.stock },
    { key: 'group_price', domCellIndex: rowModel.domCellIndexes[columns.groupPrice], value: sku.groupPrice },
    { key: 'single_price', domCellIndex: rowModel.domCellIndexes[columns.singlePrice], value: sku.singlePrice },
  ];
  const locators = fields.map((field) => (
    Number.isInteger(field.domCellIndex) && field.domCellIndex >= 0
      ? row.locator('td').nth(field.domCellIndex).locator('input').first()
      : null
  ));
  if (locators.some((locator) => locator == null)) {
    return { ok: false, mode: 'invalid', results: fields.map(() => ({ ok: false, actual: null })) };
  }
  const sequential = [];
  for (let index = 0; index < fields.length; index += 1) {
    sequential.push(await fillSkuCell(locators[index], fields[index].value));
  }
  return { ok: sequential.every((result) => result.ok), mode: 'sequential', results: sequential };
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

async function loadAndMatchSkuRows(page, skuPricing) {
  const table = await findSkuTable(page);
  if (!table) throw new PddCliError({ code: 'E_BUSINESS', message: 'SKU 表格未找到', exitCode: ExitCodes.BUSINESS });
  const columns = mapSkuTableColumns(await table.locator('thead th').allInnerTexts());
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
  return { rows, rowCount, rowModels, columns, rowIndexes: matched.rowIndexes };
}

export async function fillSkuTableRows(page, skuPricing, log = getLogger()) {
  if (!Array.isArray(skuPricing) || skuPricing.length === 0) {
    throw new PddCliError({ code: 'E_BUSINESS', message: '缺少逐 SKU 定价与库存计划', exitCode: ExitCodes.BUSINESS });
  }
  const { rows, rowCount, rowModels, columns, rowIndexes } = await loadAndMatchSkuRows(page, skuPricing);
  for (let i = 0; i < skuPricing.length; i += 1) {
    const rowIndex = rowIndexes[i];
    const filled = await fillSkuRowFields(rows.nth(rowIndex), rowModels[rowIndex], columns, skuPricing[i]);
    if (!filled.ok) {
      throw new PddCliError({
        code: 'E_BUSINESS',
        message: 'SKU 价格或库存填写后读回失败',
        detail: {
          sku_index: i,
          fill_mode: filled.mode,
          fields: {
            stock: filled.results[0]?.ok === true,
            group_price: filled.results[1]?.ok === true,
            single_price: filled.results[2]?.ok === true,
          },
        },
        exitCode: ExitCodes.BUSINESS,
      });
    }
  }
  log.info({ skuCount: rowCount }, 'goods-publish: SKU prices and stock filled');
}

async function fillPrices(page, pricing, warnings, log) {
  const { pricingPlan, pricingValidation } = pricing ?? {};
  if (!pricingPlan || !pricingValidation) {
    warnings.push('pricing_plan_missing');
    return;
  }
  if (pricingValidation.warnings.length > 0) warnings.push(...pricingValidation.warnings);
  if (!pricingValidation.ok) {
    throw new PddCliError({
      code: 'E_BUSINESS',
      message: `定价验证失败: ${pricingValidation.errors.join('; ')}`,
      exitCode: ExitCodes.BUSINESS,
    });
  }
  await fillSkuTableRows(page, pricingPlan.skuPricing, log);
  const marketInput = await findFirst(page, SELECTORS.marketPrice);
  if (marketInput) {
    await marketInput.fill(pricingPlan.marketPrice);
    log.info({ marketPrice: pricingPlan.marketPrice }, 'goods-publish: market price filled');
  }
}

async function uploadCarouselViaForm(page, urls, log) {
  const imgResult = await downloadImagesToTemp(urls);
  try {
    if (imgResult.filePaths.length === 0) return;
    const uploadedUrls = await uploadCarouselImages(page, imgResult.filePaths);
    log.info({ requested: imgResult.filePaths.length, completed: uploadedUrls.length }, 'goods-publish: carousel uploaded');
  } finally {
    imgResult.cleanup();
  }
}

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

async function fillTitleAndMedia(page, source, warnings, log) {
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
  if (source.detailImgs?.length > 0) {
    const result = await uploadDetailImagesViaForm(page, source.detailImgs, log);
    warnings.push(...result.warnings);
  }
}

export async function fillGoodsForm(page, source, warnings, options = {}) {
  const log = getLogger();
  const skuDims = Array.isArray(source.skuDimensions) && source.skuDimensions.length > 0
    ? source.skuDimensions
    : parseSkuText(source.skuText || '');
  const skuCount = Array.isArray(source.skus) && source.skus.length > 0
    ? source.skus.length
    : countSkuCombinations(skuDims);

  await findFirst(page, SELECTORS.goodsTitle, 8000);
  await dismissOverlays(page);
  await fillSkuDimensions(page, skuDims, skuCount, log);
  const uploadedSkuPreviewPlan = await uploadSkuPreviewImages(page, options.skuPreviewPlan);
  await fillTitleAndMedia(page, source, warnings, log);
  await fillPrices(page, options, warnings, log);
  // Fill merchant properties last so earlier React re-renders cannot restore stale vids.
  await fillGoodsProperties(page, options.propertyPlan);
  return { uploadedSkuPreviewPlan };
}
