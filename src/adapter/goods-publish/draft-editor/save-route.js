import { PddCliError, ExitCodes } from '../../../infra/errors.js';
import { getLogger } from '../../../infra/logger.js';
import { evaluateInMainWorld } from '../../browser.js';
import { SAVE_DRAFT_SUCCESS_RULE } from '../../endpoints/goods-publish.js';
import { isSuccessfulResponse } from '../../response-interpreter.js';
import { SELECTORS, findFirst } from './dom-helpers.js';

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

function injectCostTemplateOnly(postData, costTemplateId) {
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

function resolveNextPostData(postData, options, hasTemplate) {
  if (typeof options.prepareEditPayload === 'function') {
    const prepared = options.prepareEditPayload(postData, {
      costTemplateId: hasTemplate ? options.costTemplateId : undefined,
      expectedCostTemplateId: options.costTemplateId,
      expectedSkuPricing: options.expectedSkuPricing,
      expectedPropertyPlan: options.expectedPropertyPlan,
      expectedSkuPreviewPlan: options.expectedSkuPreviewPlan,
      expectedFullCountDiscountRate: options.expectedFullCountDiscountRate,
      strictPayload: Boolean(options.strictPayload),
    });
    return { nextPostData: prepared.postData, validation: prepared.validation };
  }
  if (options.strictPayload) {
    throw costTemplateBodyError('缺少出站载荷校验器 prepareEditPayload');
  }
  return {
    nextPostData: injectCostTemplateOnly(postData, options.costTemplateId),
    validation: null,
  };
}

function createSaveDraftRouteHandler(options, hasTemplate, state, rejectRouteFailure) {
  return async (route) => {
    try {
      const postData = route.request().postData();
      const { nextPostData, validation } = resolveNextPostData(postData, options, hasTemplate);
      state.payloadValidation = validation;
      state.injected = true;
      await route.continue({ postData: nextPostData });
    } catch (err) {
      state.routeError = err instanceof PddCliError
        ? err
        : costTemplateBodyError(err?.message || '保存草稿请求注入失败');
      await route.abort('failed').catch(() => {});
      rejectRouteFailure(state.routeError);
    }
  };
}

async function routeSaveDraftWithCostTemplate(page, options, run) {
  const hasTemplate = options.costTemplateId != null && String(options.costTemplateId).trim() !== '';
  if (!hasTemplate && !options.strictPayload) return { result: await run(), payloadValidation: null };

  const state = { injected: false, routeError: null, payloadValidation: null };
  let rejectRouteFailure;
  const routeFailure = new Promise((_, reject) => {
    rejectRouteFailure = reject;
  });
  const handler = createSaveDraftRouteHandler(options, hasTemplate, state, rejectRouteFailure);

  await page.route(isSaveDraftUrl, handler);
  try {
    let result;
    try {
      result = await Promise.race([run(), routeFailure]);
    } catch (err) {
      if (state.routeError) throw state.routeError;
      if (!state.injected) throw costTemplateBodyError('未捕获到保存草稿请求，无法写入运费模板');
      throw err;
    }
    if (state.routeError) throw state.routeError;
    if (!state.injected) throw costTemplateBodyError('未捕获到保存草稿请求，无法写入运费模板');
    return { result, payloadValidation: state.payloadValidation };
  } finally {
    await page.unroute(isSaveDraftUrl, handler).catch((err) => {
      getLogger().debug({ err: err?.message }, 'form-filler: save-draft unroute failed');
    });
  }
}

async function verifyDraft(page, goodsCommitId, log, options = {}) {
  if (typeof options.verifyDraftDetail !== 'function') {
    throw costTemplateBodyError('缺少草稿详情校验器 verifyDraftDetail');
  }
  try {
    const response = await evaluateInMainWorld(page, async (id) => {
      const r = await fetch('/glide/v2/mms/query/commit/detail', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ goods_commit_id: id }),
      });
      return { http_status: r.status, http_ok: r.ok, payload: await r.json() };
    }, goodsCommitId);

    const verification = options.verifyDraftDetail(response, {
      goodsCommitId,
      expectedCostTemplateId: options.expectedCostTemplateId,
      expectedFullCountDiscountRate: options.expectedFullCountDiscountRate,
      strictVerify: false,
    });
    log.debug({ goodsCommitId, ...verification.observation }, 'goods-publish: draft verification response observed');
    if (verification.skipped) {
      log.warn({ goodsCommitId, ...verification.observation }, 'goods-publish: draft verification unavailable');
      return verification;
    }
    if (!verification.ok) {
      log.warn({ issues: verification.issues, goodsCommitId }, 'goods-publish: draft verification found issues');
      if (options.strictVerify) {
        return options.verifyDraftDetail(response, {
          goodsCommitId,
          expectedCostTemplateId: options.expectedCostTemplateId,
          expectedFullCountDiscountRate: options.expectedFullCountDiscountRate,
          strictVerify: true,
        });
      }
    } else {
      log.info({ goodsCommitId }, 'goods-publish: draft verified OK');
    }
    return verification;
  } catch (err) {
    const verification = options.verifyDraftDetail(err);
    log.warn({ goodsCommitId, ...verification.observation }, 'goods-publish: draft verification unavailable');
    return verification;
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
      page.waitForResponse((r) => isSaveDraftUrl(r.url()), { timeout: 30000 }),
      saveBtn.click(),
    ]),
  );
  const [response] = routed.result;
  const result = await response.json();
  if (!isSuccessfulResponse(result, SAVE_DRAFT_SUCCESS_RULE)) {
    throw new PddCliError({
      code: 'E_BUSINESS',
      message: result.error_msg || '保存草稿失败',
      detail: { raw: result },
      exitCode: ExitCodes.BUSINESS,
    });
  }

  log.info('goods-publish: draft saved via UI');
  const verification = goodsCommitId
    ? await verifyDraft(page, goodsCommitId, log, {
        expectedCostTemplateId: options.costTemplateId,
        expectedFullCountDiscountRate: options.expectedFullCountDiscountRate,
        strictVerify: Boolean(options.strictVerify),
        verifyDraftDetail: options.verifyDraftDetail,
      })
    : { ok: true, issues: [], skipped: true };

  return { ...result, payload_validation: routed.payloadValidation?.summary ?? null, verification };
}
