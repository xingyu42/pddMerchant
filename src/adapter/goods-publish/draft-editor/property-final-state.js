import { PddCliError, ExitCodes } from '../../../infra/errors.js';
import { getLogger } from '../../../infra/logger.js';

const SIZE_CHART_DISABLE_SELECTOR = 'a[data-tracking-click-viewid="disable_size_chart"]';
const SIZE_CHART_TABLE_SELECTOR = '[class*="sizeChart_sizeTable"]';
const FULL_COUNT_DISCOUNT_SELECTOR = 'input[data-tracking-viewid="count_discount"]';

function normalizePropertyText(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/[‐‑‒–—―]/g, '-')
    .replace(/\s+/g, '')
    .replace(/^重要/, '')
    .trim();
}

function matchPropertyRowIndex(labels, targetName) {
  const expected = normalizePropertyText(targetName);
  const matches = (Array.isArray(labels) ? labels : [])
    .map((label, index) => ({ label: normalizePropertyText(label), index }))
    .filter((item) => item.label === expected);
  return matches.length === 1 ? matches[0].index : -1;
}

function propertyFillError(issue, message, property, detail = {}) {
  return new PddCliError({
    code: 'E_BUSINESS',
    message,
    hint: '商家后台属性控件或候选值与模板不一致，已停止保存草稿',
    detail: {
      issue,
      property_name: property?.name ?? null,
      expected_values: Array.isArray(property?.values)
        ? property.values.map((item) => item?.value).filter(Boolean)
        : [],
      template_pid: property?.templatePid ?? null,
      template_module_id: property?.templateModuleId ?? null,
      required: property?.required === true,
      important: property?.important === true,
      ...detail,
    },
    exitCode: ExitCodes.BUSINESS,
  });
}

async function resolvePropertyRow(page, property) {
  const rows = page.locator('.property-list');
  const labels = await rows.evaluateAll((elements) => elements.map((element) =>
    element.querySelector('label')?.innerText ?? ''
  ));
  const rowIndex = matchPropertyRowIndex(labels, property.name);
  if (rowIndex >= 0) return rows.nth(rowIndex);

  const matchCount = labels.filter((label) =>
    normalizePropertyText(label) === normalizePropertyText(property.name)
  ).length;
  throw propertyFillError('property_row_unmapped', '商品属性行无法唯一匹配', property, {
    row_match_count: matchCount,
  });
}

async function typePropertySearch(row, property, expectedValue) {
  const inputSelector = property.name === '品牌'
    ? 'input[placeholder*="请输入品牌名称搜索"]'
    : 'input[placeholder="请选择"]';
  let inputs = row.locator(inputSelector);
  if (property.name !== '品牌' && property.controlType === 1 && await inputs.count() === 0) {
    inputs = row.locator('input[type="text"]');
  }
  const inputCount = await inputs.count();
  if (inputCount !== 1) {
    throw propertyFillError('property_input_unmapped', '商品属性输入框无法唯一匹配', property, {
      input_match_count: inputCount,
    });
  }
  const input = inputs.first();
  try {
    await input.click();
    if (await input.inputValue()) {
      await input.press('Control+A');
      await input.press('Backspace');
    }
    await input.pressSequentially(expectedValue, { delay: 40 });
  } catch {
    // 部分商家下拉在按键过程中会替换输入框；后续可见选项与读回仍是权威判定。
  }
}

async function waitForUniqueOption(page, options, property, expected) {
  let matchCount = 0;
  for (let attempt = 0; attempt < 15; attempt += 1) {
    const texts = await options.allInnerTexts();
    matchCount = texts.filter((text) => normalizePropertyText(text) === expected).length;
    if (matchCount > 0) break;
    await page.waitForTimeout(100);
  }
  if (matchCount !== 1) {
    throw propertyFillError('property_option_unmapped', '商品属性候选值无法唯一匹配', property, {
      option_match_count: matchCount,
    });
  }
}

async function selectPropertyValue(page, property, expectedValue) {
  const row = await resolvePropertyRow(page, property);
  await typePropertySearch(row, property, expectedValue);

  const options = page.locator('ul[role="listbox"]:visible li[role="option"]:visible');
  const expected = normalizePropertyText(expectedValue);
  await waitForUniqueOption(page, options, property, expected);

  try {
    const texts = await options.allInnerTexts();
    const matches = texts
      .map((text, index) => ({ text: normalizePropertyText(text), index }))
      .filter((item) => item.text === expected);
    if (matches.length !== 1) throw new Error('exact option changed during click');
    // Trusted pointer click is required to fire PDD's dependent-property chain.
    await options.nth(matches[0].index).click();
  } catch {
    throw propertyFillError('property_option_click_failed', '商品属性候选值点击失败', property);
  }
  try { await page.keyboard?.press?.('Escape'); } catch { /* best-effort close */ }
  await page.waitForTimeout(100);
}

async function readPropertyValues(page, property) {
  const row = await resolvePropertyRow(page, property);
  const inputLocator = row.locator('input');
  const chipLocator = row.locator('[class*="Tag"], [class*="tag"], [class*="token"]');
  const [inputValues, inputPlaceholders, chipTexts, rowText] = await Promise.all([
    inputLocator.evaluateAll((inputs) => inputs.map((input) => input.value)).catch(() => []),
    inputLocator.evaluateAll((inputs) => inputs.map((input) => input.getAttribute('placeholder') ?? '')).catch(() => []),
    chipLocator.allInnerTexts().catch(() => []),
    row.innerText().catch(() => ''),
  ]);
  const exactValues = [...inputValues, ...inputPlaceholders, ...chipTexts]
    .map(normalizePropertyText)
    .filter(Boolean);
  const normalizedRowText = normalizePropertyText(rowText)
    .replace(normalizePropertyText(property.name), '');
  return property.values.every((item) => {
    const expected = normalizePropertyText(item.value);
    return exactValues.includes(expected) || normalizedRowText.includes(expected);
  });
}

async function waitForPropertyValues(page, property, { attempts = 15, intervalMs = 100 } = {}) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (await readPropertyValues(page, property)) return true;
    if (attempt < attempts - 1) await page.waitForTimeout(intervalMs);
  }
  return false;
}

export async function fillGoodsProperties(page, propertyPlan) {
  if (!Array.isArray(propertyPlan) || propertyPlan.length === 0) {
    throw propertyFillError('property_plan_missing', '商品属性填写计划为空');
  }
  for (const property of propertyPlan) {
    if (await readPropertyValues(page, property)) continue;
    for (const value of property.values) {
      await selectPropertyValue(page, property, value.value);
    }
    if (!(await waitForPropertyValues(page, property))) {
      throw propertyFillError('property_readback_mismatch', '商品属性页面读回失败', property);
    }
  }
}

function sizeChartDisableError(issue, message, detail = {}) {
  return new PddCliError({
    code: 'E_BUSINESS',
    message,
    hint: '商家尺码表仍处于启用状态，已在保存草稿前停止',
    detail: { issue, ...detail },
    exitCode: ExitCodes.BUSINESS,
  });
}

async function waitForUniqueLocator(page, locator, attempts, intervalMs) {
  let count = 0;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    count = await locator.count();
    if (count !== 0) return count;
    if (attempt < attempts - 1) await page.waitForTimeout(intervalMs);
  }
  return count;
}

async function waitForSizeChartRemoval(page, disableLink, sizeChartTable, attempts, intervalMs) {
  let linkCount = 1;
  let tableCount = 1;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    [linkCount, tableCount] = await Promise.all([disableLink.count(), sizeChartTable.count()]);
    if (linkCount === 0 && tableCount === 0) return { removed: true, linkCount, tableCount };
    if (attempt < attempts - 1) await page.waitForTimeout(intervalMs);
  }
  return { removed: false, linkCount, tableCount };
}

export async function disableSizeChart(page, options = {}) {
  const confirmAttempts = options.confirmAttempts ?? 15;
  const readbackAttempts = options.readbackAttempts ?? 15;
  const intervalMs = options.intervalMs ?? 100;
  const disableLink = page.locator(SIZE_CHART_DISABLE_SELECTOR);
  const sizeChartTable = page.locator(SIZE_CHART_TABLE_SELECTOR);
  const [initialLinkCount, initialTableCount] = await Promise.all([disableLink.count(), sizeChartTable.count()]);

  if (initialLinkCount === 0 && initialTableCount === 0) {
    return { changed: false, disabled: true };
  }
  if (initialLinkCount !== 1) {
    throw sizeChartDisableError('size_chart_disable_control_unmapped', '尺码表停用入口无法唯一匹配', {
      control_count: initialLinkCount,
      table_count: initialTableCount,
    });
  }

  await disableLink.click();
  const confirmButton = page.getByRole('button', { name: '确认停用', exact: true });
  const confirmCount = await waitForUniqueLocator(page, confirmButton, confirmAttempts, intervalMs);
  if (confirmCount !== 1) {
    throw sizeChartDisableError('size_chart_disable_confirmation_missing', '尺码表停用确认按钮无法唯一匹配', {
      confirmation_count: confirmCount,
    });
  }

  await confirmButton.click();
  const readback = await waitForSizeChartRemoval(page, disableLink, sizeChartTable, readbackAttempts, intervalMs);
  if (readback.removed) return { changed: true, disabled: true };

  throw sizeChartDisableError('size_chart_disable_readback_mismatch', '尺码表停用状态读回失败', {
    control_count: readback.linkCount,
    table_count: readback.tableCount,
  });
}

function fullCountDiscountPayloadValue(discountRate) {
  const rate = Number(discountRate);
  const payloadValue = Math.round(rate * 100);
  if (!Number.isFinite(rate) || rate < 0.5 || rate > 0.99 || Math.abs((rate * 100) - payloadValue) >= 1e-9) {
    throw new PddCliError({
      code: 'E_CONFIG_INVALID',
      message: '满件折扣运行配置无效',
      hint: '将 fullCountDiscountRate 配置为 0.50-0.99，步长 0.01',
      detail: { field: 'fullCountDiscountRate', value_type: typeof discountRate },
      exitCode: ExitCodes.GENERAL,
    });
  }
  return payloadValue;
}

export async function fillFullCountDiscount(page, discountRate, log = getLogger()) {
  const payloadValue = fullCountDiscountPayloadValue(discountRate);
  const input = page.locator(FULL_COUNT_DISCOUNT_SELECTOR);
  const count = await input.count();
  if (count !== 1) {
    throw new PddCliError({
      code: 'E_BUSINESS',
      message: '满件折扣输入框无法唯一定位',
      detail: { issue: 'full_count_discount_control_unmapped', control_count: count },
      exitCode: ExitCodes.BUSINESS,
    });
  }

  const displayValue = (payloadValue / 10).toFixed(1);
  await input.fill(displayValue);
  await input.blur();
  const actualValue = Number(await input.inputValue());
  if (!Number.isFinite(actualValue) || Math.abs(actualValue - (payloadValue / 10)) >= 1e-9) {
    throw new PddCliError({
      code: 'E_BUSINESS',
      message: '满件折扣输入值读回不一致',
      detail: { issue: 'full_count_discount_readback_mismatch' },
      exitCode: ExitCodes.BUSINESS,
    });
  }

  log.info({ full_count_discount_percent: payloadValue }, 'goods-publish: full-count discount filled');
  return { rate: payloadValue / 100, displayValue, payloadValue };
}
