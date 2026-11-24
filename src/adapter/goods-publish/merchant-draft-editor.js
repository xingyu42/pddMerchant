import { throwIfAborted } from '../../infra/abort.js';
import { PddCliError, ExitCodes } from '../../infra/errors.js';
import { getLogger } from '../../infra/logger.js';
import { GOODS_PUBLISH_SUBMIT, GOODS_PUBLISH_TEMPLATE } from '../endpoints/goods-publish.js';
import { interpretResponse } from '../response-interpreter.js';
import { runEndpoint } from '../run-endpoint.js';
import { createWriteThrottle } from './draft-editor/write-throttle.js';
import { selectCategory } from './draft-editor/category-draft.js';
import { fillGoodsForm } from './draft-editor/sku-media-fill.js';
import {
  disableSizeChart,
  fillFullCountDiscount,
  fillGoodsProperties,
} from './draft-editor/property-final-state.js';
import { clickSaveDraft } from './draft-editor/save-route.js';
import { mergeDynamicPropertyTemplate } from './property-template.js';
import { readDynamicPropertyTemplate as defaultReadDynamicTemplate } from './dynamic-property-template.js';
import { assertNoRiskControl } from './risk-detector.js';

function appendUniqueWarnings(target, source) {
  if (!Array.isArray(target) || !Array.isArray(source)) return;
  for (const warning of source) {
    if (warning && !target.includes(warning)) target.push(warning);
  }
}

export function createLiveDraftSession({
  page,
  draft,
  log = getLogger(),
  checkRisk = assertNoRiskControl,
  fillForm = fillGoodsForm,
  readDynamicTemplate = defaultReadDynamicTemplate,
  fillProperties = fillGoodsProperties,
  disableChart = disableSizeChart,
  fillDiscount = fillFullCountDiscount,
  saveDraftRequest = clickSaveDraft,
  mergeTemplate = mergeDynamicPropertyTemplate,
} = {}) {
  return Object.freeze({
    fillBaseAndMedia({ source, pricingPlan, pricingValidation, propertyPlan, skuPreviewPlan, warnings }) {
      return fillForm(page, source, warnings, {
        pricingPlan,
        pricingValidation,
        propertyPlan,
        skuPreviewPlan,
      });
    },
    readDynamicTemplate(currentTemplate) {
      return readDynamicTemplate(page, currentTemplate, { mergeTemplate });
    },
    fillDependentProperties(dependentPropertyPlan) {
      return fillProperties(page, dependentPropertyPlan);
    },
    disableSizeChart() {
      return disableChart(page);
    },
    fillFullCountDiscount(rate) {
      return fillDiscount(page, rate, log);
    },
    saveDraft(saveOptions) {
      return saveDraftRequest(page, draft.goodsCommitId, saveOptions);
    },
    checkRiskControl(phase) {
      return checkRisk(page, { phase });
    },
  });
}

function requireConvergeHelper(convergeDynamic) {
  if (typeof convergeDynamic === 'function') return convergeDynamic;
  throw new PddCliError({
    code: 'E_CONFIG_INVALID',
    message: 'MerchantDraftEditorPort 需要注入 convergeDynamic 函数',
    exitCode: ExitCodes.GENERAL,
  });
}

export function createLiveMerchantDraftEditor({
  endpoint = null,
  page: boundPage = null,
  writeThrottle = null,
  writeRateTokensPerMinute = 20,
  throttleEnabled,
  mode = 'live',
  clock,
  log = getLogger(),
  createDraftSession = createLiveDraftSession,
  openCategoryDraft = selectCategory,
  checkRisk = assertNoRiskControl,
  convergeDynamic = null,
  preparePayload = null,
  verifyDetail = null,
} = {}) {
  const throttle = writeThrottle ?? createWriteThrottle({
    tokensPerMinute: writeRateTokensPerMinute,
    enabled: throttleEnabled,
    mode,
    now: clock?.now,
    sleep: clock?.sleep,
  });

  async function openDraft({
    categorySearchText,
    catId,
    page = boundPage,
    client = endpoint,
    signal,
    deadlineAt,
    clock: callClock,
    log: callLog,
  } = {}) {
    throwIfAborted(signal);
    const effectiveLog = callLog ?? log;
    const draft = await throttle.run('publish.create_draft', async () => {
      effectiveLog.info('goods-publish: Phase C — UI category selection + draft creation');
      const created = await openCategoryDraft(page, categorySearchText);
      await checkRisk(page, { phase: 'category' });
      return created;
    }, signal);

    effectiveLog.info('goods-publish: loading merchant property template');
    const initialTemplate = await runEndpoint(page, GOODS_PUBLISH_TEMPLATE, {
      cat_id: catId,
      goods_commit_id: draft.goodsCommitId,
      goods_id: draft.goodsId,
    }, {
      client,
      signal,
      deadlineAt,
      clock: callClock ?? clock,
      log: effectiveLog,
    });
    return { draft, initialTemplate };
  }

  async function finalizeAndSaveSession({
    session,
    draft,
    plan,
    initialTemplate,
    initialPropertyPlan,
    uploadedSkuPreviewPlan,
    warnings,
    signal,
    effectiveLog,
  }) {
    const converge = requireConvergeHelper(convergeDynamic);
    const { propertyPlan: convergedPlan } = await converge({
      sourceProperties: plan.source.goodsProperties,
      initialTemplate,
      initialPlan: initialPropertyPlan,
      readDynamicTemplate: (currentTemplate) => session.readDynamicTemplate(currentTemplate),
      fillDependentProperties: (dependentPlan) => throttle.run(
        'publish.fill_dependent_properties',
        async () => {
          await session.fillDependentProperties(dependentPlan);
          await session.checkRiskControl('form:dependent-properties');
        },
        signal,
      ),
    });

    const chartResult = await session.disableSizeChart();
    effectiveLog.info({ changed: chartResult.changed }, 'goods-publish: size chart disabled before draft save');
    await session.checkRiskControl('form:size-chart-disabled');

    await throttle.run('publish.fill_full_count_discount', async () => {
      await session.fillFullCountDiscount(plan.fullCountDiscountRate);
      await session.checkRiskControl('form:full-count-discount');
    }, signal);

    appendUniqueWarnings(warnings, convergedPlan.warnings);

    const saved = await throttle.run('publish.save_draft', async () => {
      effectiveLog.info({ costTemplateId: plan.costTemplateId }, 'goods-publish: Phase E — saving draft');
      return session.saveDraft({
        costTemplateId: plan.costTemplateId,
        expectedSkuPricing: plan.pricingPlan?.skuPricing,
        expectedPropertyPlan: convergedPlan.plan,
        expectedSkuPreviewPlan: uploadedSkuPreviewPlan,
        expectedFullCountDiscountRate: plan.fullCountDiscountRate,
        strictPayload: true,
        strictVerify: true,
        prepareEditPayload: preparePayload,
        verifyDraftDetail: verifyDetail,
      });
    }, signal);

    appendUniqueWarnings(warnings, saved.verification?.warnings);
    return {
      propertyMapping: convergedPlan,
      uploadedSkuPreviewPlan,
      saved,
      warnings,
    };
  }

  async function populateAndSaveDraft({
    draft,
    plan,
    initialTemplate,
    initialPropertyPlan,
    page = boundPage,
    signal,
    warnings = [],
    log: callLog,
  } = {}) {
    throwIfAborted(signal);
    const effectiveLog = callLog ?? log;
    const session = createDraftSession({ page, draft, log: effectiveLog, signal });

    const { uploadedSkuPreviewPlan } = await throttle.run('publish.fill_form', async () => {
      effectiveLog.info({ ...draft }, 'goods-publish: Phase D — filling form');
      const filled = await session.fillBaseAndMedia({
        source: plan.source,
        pricingPlan: plan.pricingPlan,
        pricingValidation: plan.pricingValidation,
        propertyPlan: initialPropertyPlan.plan,
        skuPreviewPlan: plan.skuPreviewPlan,
        warnings,
      });
      await session.checkRiskControl('form');
      return filled;
    }, signal);

    return finalizeAndSaveSession({
      session,
      draft,
      plan,
      initialTemplate,
      initialPropertyPlan,
      uploadedSkuPreviewPlan,
      warnings,
      signal,
      effectiveLog,
    });
  }

  async function submitDraft(draft, {
    page = boundPage,
    client = endpoint,
    signal,
    deadlineAt,
    clock: callClock,
    log: callLog,
  } = {}) {
    throwIfAborted(signal);
    const effectiveLog = callLog ?? log;
    await checkRisk(page, { phase: 'submit:before' });

    const submitResult = await throttle.run('publish.submit', async () => {
      effectiveLog.info('goods-publish: Phase F — submitting goods');
      return runEndpoint(page, GOODS_PUBLISH_SUBMIT, {
        goods_commit_id: draft.goodsCommitId,
        goods_id: draft.goodsId,
      }, {
        client,
        signal,
        deadlineAt,
        clock: callClock ?? clock,
        log: effectiveLog,
      });
    }, signal);

    await checkRisk(page, { phase: 'submit:after' });

    if (submitResult?.success === false && submitResult?.raw) {
      interpretResponse(GOODS_PUBLISH_SUBMIT, { status: 200, raw: submitResult.raw, params: draft });
    }
    return { success: submitResult?.success === true };
  }

  return Object.freeze({
    openDraft,
    populateAndSaveDraft,
    submitDraft,
  });
}
