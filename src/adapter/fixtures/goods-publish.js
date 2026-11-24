import { throwIfAborted } from '../../infra/abort.js';
import { PddCliError, ExitCodes } from '../../infra/errors.js';
import { buildCategorySearchText } from '../goods-publish/category-resolver.js';
import { mergeDynamicPropertyTemplate } from '../goods-publish/property-template.js';

function throwFixtureError(fixture, name) {
  if (!fixture?.__throws) return;
  const error = fixture.__error ?? {};
  throw new PddCliError({
    code: error.code ?? 'E_BUSINESS',
    message: error.message ?? `fixture ${name} error`,
    hint: error.hint ?? '',
    detail: error.detail ?? null,
    exitCode: error.exitCode ?? ExitCodes.BUSINESS,
  });
}

function tryLoadFixture(fixtureStore, relPath) {
  if (!fixtureStore || typeof fixtureStore.load !== 'function') return null;
  try {
    return fixtureStore.load(relPath);
  } catch (error) {
    if (error?.code !== 'E_FIXTURE_MISSING') throw error;
    return null;
  }
}

/**
 * In-memory empty source cache for fixture mode; never reads or writes disk cache dirs.
 */
export function createNullSourceGoodsCache() {
  const store = new Map();
  return Object.freeze({
    async read(goodsId) {
      const entry = store.get(String(goodsId));
      return entry ? structuredClone(entry) : null;
    },
    async write(goodsId, source) {
      store.set(String(goodsId), structuredClone(source));
      return true;
    },
    async remove(goodsId) {
      return store.delete(String(goodsId));
    },
  });
}

function defaultSourceObservation(goodsId) {
  const id = String(goodsId);
  return {
    goodsID: id,
    goodsName: 'Synthetic Cotton Tee',
    catID: 1003,
    catID1: 1001,
    catID2: 1002,
    catID3: 1003,
    price: '14.70',
    carousel: ['https://img.pddpic.com/carousel-1.jpg'],
    skuText: '颜色\n白色\n黑色',
    properties: '',
    detailImgs: ['https://img.pddpic.com/detail-1.jpg'],
    _fiberFound: true,
    _maskHint: false,
    _url: `https://mobile.yangkeduo.com/goods.html?goods_id=${id}`,
    _title: 'Synthetic Cotton Tee',
    _bodyLen: 800,
    _roots: 'app',
    _appWall: false,
    _decodedSkuSource: {
      goodsID: id,
      linePrice: '59',
      skuDimensions: [
        {
          name: '颜色',
          values: [
            { id: '1', text: '白色' },
            { id: '2', text: '黑色' },
          ],
        },
      ],
      skus: [
        {
          skuID: 'sku-w',
          groupPrice: '14.70',
          normalPrice: '25.80',
          quantity: 10,
          thumbUrl: 'https://img.pddpic.com/white.jpg',
          specValues: { 颜色: '白色' },
        },
        {
          skuID: 'sku-b',
          groupPrice: '16.00',
          normalPrice: '28.00',
          quantity: 0,
          thumbUrl: 'https://img.pddpic.com/black.jpg',
          specValues: { 颜色: '黑色' },
        },
      ],
      goodsProperties: [
        { name: '面料俗称', values: ['棉'], refPid: '101', referenceId: '1' },
      ],
      visitedObjects: 10,
    },
  };
}

function toSourceObservation(raw, goodsId) {
  const cloned = structuredClone(raw);
  if (cloned._fiberFound !== undefined || cloned._decodedSkuSource !== undefined) {
    return {
      ...cloned,
      goodsID: cloned.goodsID ?? String(goodsId),
    };
  }
  const resolvedId = cloned.goodsID ?? String(goodsId);
  return {
    goodsID: resolvedId,
    goodsName: cloned.goodsName ?? '',
    catID: cloned.catID ?? cloned.catID3 ?? null,
    catID1: cloned.catID1 ?? null,
    catID2: cloned.catID2 ?? null,
    catID3: cloned.catID3 ?? cloned.catID ?? null,
    price: cloned.price ?? '14.70',
    carousel: cloned.carousel ?? [],
    skuText: cloned.skuText ?? '',
    properties: cloned.properties ?? '',
    detailImgs: cloned.detailImgs ?? [],
    _fiberFound: true,
    _maskHint: false,
    _url: `https://mobile.yangkeduo.com/goods.html?goods_id=${resolvedId}`,
    _title: cloned.goodsName ?? '',
    _bodyLen: 800,
    _roots: 'app',
    _appWall: false,
    _decodedSkuSource: {
      goodsID: resolvedId,
      ...(cloned.sourceReferencePriceCents != null
        ? { sourceReferencePriceCents: cloned.sourceReferencePriceCents }
        : { linePrice: cloned.linePrice }),
      skuDimensions: cloned.skuDimensions ?? [],
      skus: cloned.skus ?? [],
      goodsProperties: cloned.goodsProperties ?? cloned.goodsProperty ?? [],
      visitedObjects: 10,
    },
  };
}

export function createFixtureObserveSourcePage({ fixtureStore } = {}) {
  return async function observeFixtureSourcePage(page, goodsId) {
    const raw = tryLoadFixture(fixtureStore, `goods-publish/source.${goodsId}.json`)
      ?? tryLoadFixture(fixtureStore, 'goods-publish/source.json');
    if (raw) throwFixtureError(raw, 'goods-publish/source.json');

    const observation = raw
      ? toSourceObservation(raw, goodsId)
      : defaultSourceObservation(goodsId);
    const pageUrl = observation._url
      ?? page?.url?.()
      ?? `https://mobile.yangkeduo.com/goods.html?goods_id=${goodsId}`;
    return { earlyObservation: null, observation, pageUrl };
  };
}

export function createFixtureCategoryResolver({ fixtureStore } = {}) {
  return Object.freeze({
    async resolve(catIds, { signal } = {}) {
      throwIfAborted(signal);
      const raw = tryLoadFixture(fixtureStore, 'goods-publish/category.json');
      if (raw) throwFixtureError(raw, 'goods-publish/category.json');

      const catId1 = Number(catIds?.catId1 ?? catIds?.catID1 ?? 1001);
      const catId2 = Number(catIds?.catId2 ?? catIds?.catID2 ?? 1002);
      const catId3 = Number(catIds?.catId3 ?? catIds?.catID3 ?? catIds?.catID ?? 1003);
      const resolved = raw
        ? structuredClone(raw)
        : {
          root: '服饰',
          cates: ['服饰', '女装', 'T恤'],
          cat_id: catId3,
          cat_ids: [catId1, catId2, catId3, null],
          cats: ['服饰', '女装', 'T恤', null],
        };
      return {
        ...resolved,
        searchText: buildCategorySearchText(resolved),
      };
    },
  });
}

export function createFixtureOpenCategoryDraft({ fixtureStore } = {}) {
  return async function openFixtureCategoryDraft() {
    const raw = tryLoadFixture(fixtureStore, 'goods-publish/draft.json');
    if (raw) throwFixtureError(raw, 'goods-publish/draft.json');
    return {
      goodsCommitId: String(raw?.goodsCommitId ?? raw?.goods_commit_id ?? '7001'),
      goodsId: String(raw?.goodsId ?? raw?.goods_id ?? '5001'),
    };
  };
}

function toOutgoingProperties(propertyPlan = []) {
  const rows = [];
  for (const property of propertyPlan) {
    for (const value of property.values ?? []) {
      rows.push({
        template_module_id: property.templateModuleId,
        template_pid: property.templatePid,
        pid: property.pid,
        vid: value.vid ?? null,
        value: value.value ?? '',
      });
    }
  }
  return rows;
}

function skuColorFromSpecValues(specValues) {
  const entries = Object.entries(specValues ?? {}).filter(([name]) => /颜色|花色/.test(name));
  return entries.length === 1 ? String(entries[0][1]).trim() : '';
}

function buildOutgoingSkus(skuPricing, uploadedSkuPreviewPlan) {
  const previewByColor = new Map(
    (uploadedSkuPreviewPlan ?? []).map((item) => [String(item.merchantColor).trim(), item.uploadedImageUrl]),
  );
  return (skuPricing ?? []).map((sku) => {
    const color = skuColorFromSpecValues(sku.specValues);
    const thumbUrl = previewByColor.get(color) ?? '';
    return {
      spec: Object.values(sku.specValues ?? {}),
      multi_price: Math.round(Number(sku.groupPrice) * 100),
      price: Math.round(Number(sku.singlePrice) * 100),
      quantity: sku.stock,
      ...(thumbUrl ? { thumb_url: thumbUrl } : {}),
    };
  });
}

function appendOutgoingProperties(target, additions) {
  const seen = new Set(target.map((item) => `${item.template_pid}:${item.vid ?? ''}:${item.value ?? ''}`));
  for (const entry of additions) {
    const key = `${entry.template_pid}:${entry.vid ?? ''}:${entry.value ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    target.push(entry);
  }
}

export function createFixtureDraftSession({ draft, fixtureStore, fullCountDiscountPayload } = {}) {
  const state = {
    goods_name: '',
    gallery: [],
    skus: [],
    goods_properties: [],
    two_pieces_discount: undefined,
  };
  let dynamicStep = 0;

  return Object.freeze({
    async fillBaseAndMedia({ source, pricingPlan, propertyPlan, skuPreviewPlan }) {
      const uploadedSkuPreviewPlan = (skuPreviewPlan ?? []).map((item, idx) => ({
        merchantColor: item.merchantColor,
        uploadedImageUrl: `https://img.pddpic.com/fixture-uploaded-${idx + 1}.jpg`,
      }));
      state.goods_name = source?.goodsName ?? '';
      state.gallery = [...(source?.carousel ?? [])];
      state.skus = buildOutgoingSkus(pricingPlan?.skuPricing, uploadedSkuPreviewPlan);
      appendOutgoingProperties(state.goods_properties, toOutgoingProperties(propertyPlan));
      return { uploadedSkuPreviewPlan };
    },
    async readDynamicTemplate(currentTemplate) {
      const raw = tryLoadFixture(fixtureStore, 'goods-publish/dynamic-template.json');
      if (!raw) return currentTemplate;
      throwFixtureError(raw, 'goods-publish/dynamic-template.json');
      const steps = Array.isArray(raw.steps) ? raw.steps : [];
      const definitions = steps[dynamicStep];
      dynamicStep += 1;
      if (!definitions) return currentTemplate;
      return mergeDynamicPropertyTemplate(currentTemplate, definitions);
    },
    async fillDependentProperties(dependentPropertyPlan) {
      appendOutgoingProperties(state.goods_properties, toOutgoingProperties(dependentPropertyPlan));
    },
    async disableSizeChart() {
      const raw = tryLoadFixture(fixtureStore, 'goods-publish/size-chart.json');
      if (raw) throwFixtureError(raw, 'goods-publish/size-chart.json');
      return { changed: Boolean(raw?.active), disabled: true };
    },
    async fillFullCountDiscount(rate) {
      if (rate === undefined) return { rate: undefined, displayValue: null, payloadValue: null };
      const payloadValue = fullCountDiscountPayload(rate);
      state.two_pieces_discount = payloadValue;
      return { rate, displayValue: (payloadValue / 10).toFixed(1), payloadValue };
    },
    async saveDraft(saveOptions) {
      let body = {
        goods_name: state.goods_name,
        gallery: state.gallery,
        skus: state.skus,
        goods_properties: state.goods_properties,
        ...(state.two_pieces_discount != null ? { two_pieces_discount: state.two_pieces_discount } : {}),
      };
      const override = tryLoadFixture(fixtureStore, 'goods-publish/edit-payload.json');
      if (override) {
        throwFixtureError(override, 'goods-publish/edit-payload.json');
        body = { ...body, ...structuredClone(override) };
      }

      const prepared = saveOptions.prepareEditPayload(JSON.stringify(body), {
        costTemplateId: saveOptions.costTemplateId,
        expectedCostTemplateId: saveOptions.costTemplateId,
        expectedSkuPricing: saveOptions.expectedSkuPricing,
        expectedPropertyPlan: saveOptions.expectedPropertyPlan,
        expectedSkuPreviewPlan: saveOptions.expectedSkuPreviewPlan,
        expectedFullCountDiscountRate: saveOptions.expectedFullCountDiscountRate,
        strictPayload: Boolean(saveOptions.strictPayload),
      });

      const detailOverride = tryLoadFixture(fixtureStore, 'goods-publish/draft-detail.json');
      const detailResponse = detailOverride
        ? structuredClone(detailOverride)
        : {
          success: true,
          error_code: 1000000,
          result: {
            goods_name: prepared.body.goods_name,
            cost_template_id: prepared.body.cost_template_id,
            gallery: prepared.body.gallery,
            ...(prepared.body.two_pieces_discount != null
              ? { two_pieces_discount: prepared.body.two_pieces_discount }
              : {}),
          },
        };

      const verification = saveOptions.verifyDraftDetail(detailResponse, {
        goodsCommitId: draft?.goodsCommitId,
        expectedCostTemplateId: saveOptions.costTemplateId,
        expectedFullCountDiscountRate: saveOptions.expectedFullCountDiscountRate,
        strictVerify: Boolean(saveOptions.strictVerify),
      });
      return {
        success: true,
        payload_validation: prepared.validation?.summary ?? null,
        verification,
      };
    },
    async checkRiskControl() {},
  });
}
