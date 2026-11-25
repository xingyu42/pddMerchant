import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { ExitCodes, PddCliError } from '../../src/infra/errors.js';
import {
  buildPricingPlan,
  validatePricingPlan,
  validateFullCountDiscountRate,
  planPreDraftPublish,
  normalizeGoodsPropertyTemplate,
  buildInitialPropertyPlan,
  mergeDynamicPropertyTemplate,
  reconcileDynamicTemplate,
  convergeDynamicProperties,
} from '../../src/services/goods-publish/draft-planner.js';

function makeValidSource(overrides = {}) {
  return {
    goodsID: '123456',
    goodsName: 'Pure Cotton Tee',
    catID: 1003,
    catID1: 1001,
    catID2: 1002,
    catID3: 1003,
    sourceReferencePriceCents: 5900,
    carousel: ['https://img.pddpic.com/carousel-1.jpg'],
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
        sourceSkuId: 'sku-w',
        specValues: { 颜色: '白色' },
        sourcePriceCents: 1470,
        sourceNormalPriceCents: 2580,
        stock: 10,
        thumbUrl: 'https://img.pddpic.com/white.jpg',
      },
      {
        sourceSkuId: 'sku-b',
        specValues: { 颜色: '黑色' },
        sourcePriceCents: 1600,
        sourceNormalPriceCents: 2800,
        stock: 0,
        thumbUrl: 'https://img.pddpic.com/black.jpg',
      },
    ],
    goodsProperties: [
      { name: '面料俗称', values: ['棉'], refPid: '101', referenceId: '1' },
    ],
    ...overrides,
  };
}

describe('draft-planner (pre-draft planning)', () => {
  describe('buildPricingPlan & validatePricingPlan', () => {
    it.each([
      {
        label: 'explicit integer cents without markup including stock=0',
        source: makeValidSource(),
        expectedMarketPrice: '59.00',
        expectedSkus: [
          { sourceSkuId: 'sku-w', groupPrice: '14.70', singlePrice: '25.80', stock: 10 },
          { sourceSkuId: 'sku-b', groupPrice: '16.00', singlePrice: '28.00', stock: 0 },
        ],
      },
      {
        label: 'raw yuan strings and integers converted to exact cents without markup',
        source: makeValidSource({
          sourceReferencePriceCents: undefined,
          linePrice: '59.9',
          skus: [
            {
              sourceSkuId: 'sku-w',
              specValues: { 颜色: '白色' },
              groupPrice: 15,
              normalPrice: '25.8',
              stock: 2,
              thumbUrl: 'https://img.pddpic.com/white.jpg',
            },
            {
              sourceSkuId: 'sku-b',
              specValues: { 颜色: '黑色' },
              groupPrice: '19.99',
              normalPrice: 30,
              stock: 0,
              thumbUrl: 'https://img.pddpic.com/black.jpg',
            },
          ],
        }),
        expectedMarketPrice: '59.90',
        expectedSkus: [
          { sourceSkuId: 'sku-w', groupPrice: '15.00', singlePrice: '25.80', stock: 2 },
          { sourceSkuId: 'sku-b', groupPrice: '19.99', singlePrice: '30.00', stock: 0 },
        ],
      },
      {
        label: 'single-SKU with empty specValues and reference price 1 cent above single price',
        source: makeValidSource({
          sourceReferencePriceCents: 2001,
          skuDimensions: [],
          skus: [
            {
              sourceSkuId: 'sku-only',
              specValues: {},
              sourcePriceCents: 1000,
              sourceNormalPriceCents: 2000,
              stock: 0,
              thumbUrl: 'https://img.pddpic.com/only.jpg',
            },
          ],
        }),
        expectedMarketPrice: '20.01',
        expectedSkus: [
          { sourceSkuId: 'sku-only', groupPrice: '10.00', singlePrice: '20.00', stock: 0 },
        ],
      },
    ])('builds and validates valid plan for $label', ({ source, expectedMarketPrice, expectedSkus }) => {
      const plan = buildPricingPlan(source);
      assert.equal(plan.marketPrice, expectedMarketPrice);
      assert.deepEqual(
        plan.skuPricing.map(({ sourceSkuId, groupPrice, singlePrice, stock }) => ({
          sourceSkuId,
          groupPrice,
          singlePrice,
          stock,
        })),
        expectedSkus,
      );
      assert.deepEqual(plan.warnings, []);
      const validation = validatePricingPlan(plan);
      assert.equal(validation.ok, true);
      assert.deepEqual(validation.errors, []);
    });

    it.each([
      {
        label: 'reference price equal to max singlePrice',
        patchPlan: { marketPrice: '28.00' },
        expectedFragment: 'greater than max singlePrice',
      },
      {
        label: 'reference price below max singlePrice',
        patchPlan: { marketPrice: '27.99' },
        expectedFragment: 'greater than max singlePrice',
      },
      {
        label: 'reference price zero',
        patchPlan: { marketPrice: '0.00' },
        expectedFragment: 'must be positive',
      },
      {
        label: 'groupPrice above singlePrice on SKU',
        patchSource: {
          skus: [
            {
              sourceSkuId: 'sku-bad',
              specValues: { 颜色: '白色' },
              sourcePriceCents: 2600,
              sourceNormalPriceCents: 2500,
              stock: 1,
            },
          ],
        },
        expectedFragment: 'groupPrice > singlePrice',
      },
      {
        label: 'negative stock',
        patchSource: {
          skus: [
            {
              sourceSkuId: 'sku-bad',
              specValues: { 颜色: '白色' },
              sourcePriceCents: 1470,
              sourceNormalPriceCents: 2580,
              stock: -1,
            },
          ],
        },
        expectedFragment: 'stock missing',
      },
      {
        label: 'duplicate multi-SKU specification combinations',
        patchSource: {
          skus: [
            {
              sourceSkuId: 'sku-1',
              specValues: { 颜色: '白色' },
              sourcePriceCents: 1470,
              sourceNormalPriceCents: 2580,
              stock: 1,
            },
            {
              sourceSkuId: 'sku-2',
              specValues: { 颜色: '白色' },
              sourcePriceCents: 1470,
              sourceNormalPriceCents: 2580,
              stock: 2,
            },
          ],
        },
        expectedFragment: 'specification duplicate',
      },
      {
        label: 'twoPiecesDiscount below 0.50',
        constraints: { twoPiecesDiscount: 0.49 },
        expectedFragment: 'twoPiecesDiscount',
      },
      {
        label: 'twoPiecesDiscount above 0.99',
        constraints: { twoPiecesDiscount: 1.0 },
        expectedFragment: 'twoPiecesDiscount',
      },
      {
        label: 'twoPiecesDiscount with non-0.01 step',
        constraints: { twoPiecesDiscount: 0.885 },
        expectedFragment: 'twoPiecesDiscount',
      },
    ])('rejects invalid pricing plan for $label', ({ patchPlan, patchSource, constraints, expectedFragment }) => {
      const source = patchSource ? makeValidSource(patchSource) : makeValidSource();
      const plan = { ...buildPricingPlan(source), ...(patchPlan ?? {}) };
      const validation = validatePricingPlan(plan, constraints);
      assert.equal(validation.ok, false);
      assert.ok(validation.errors.some((err) => err.includes(expectedFragment)), JSON.stringify(validation.errors));
    });

    it('accepts boundary twoPiecesDiscount values 0.50, 0.88, and 0.99 in validatePricingPlan and validateFullCountDiscountRate', () => {
      const plan = buildPricingPlan(makeValidSource());
      for (const [rate, payloadValue, displayValue] of [[0.5, 50, '5.0'], [0.88, 88, '8.8'], [0.99, 99, '9.9']]) {
        const validated = validatePricingPlan(plan, { twoPiecesDiscount: rate });
        assert.equal(validated.ok, true);
        assert.deepEqual(validateFullCountDiscountRate(rate), { rate, displayValue, payloadValue });
      }
    });

    it.each([0.49, 1, 1.01, 0.885, '', null, undefined, 'bad', Number.NaN, true])(
      'rejects invalid fullCountDiscountRate %j with E_CONFIG_INVALID without leaking raw value',
      (badRate) => {
        assert.throws(
          () => validateFullCountDiscountRate(badRate),
          (err) => err instanceof PddCliError
            && err.code === 'E_CONFIG_INVALID'
            && err.exitCode === ExitCodes.GENERAL
            && err.detail?.field === 'fullCountDiscountRate'
            && !Object.hasOwn(err.detail ?? {}, 'value'),
        );
      },
    );
  });

  describe('planPreDraftPublish', () => {
    it('fails before draft creation when structured properties, SKU preview images, pricing, or fullCountDiscountRate are invalid', () => {
      assert.throws(
        () => planPreDraftPublish(makeValidSource({ goodsProperties: [] })),
        (err) => err instanceof PddCliError && err.code === 'E_BUSINESS' && err.detail?.issues?.includes('source_properties_missing'),
      );

      assert.throws(
        () => planPreDraftPublish(makeValidSource({
          skus: makeValidSource().skus.map((sku) => ({ ...sku, thumbUrl: 'https://img.pddpic.com/same.jpg' })),
        })),
        (err) => err instanceof PddCliError
          && err.code === 'E_BUSINESS'
          && err.detail?.issues?.includes('sku_preview_mapping_ambiguous')
          && !JSON.stringify(err.detail).includes('same.jpg'),
      );

      assert.throws(
        () => planPreDraftPublish(makeValidSource({ sourceReferencePriceCents: 2800 })),
        (err) => err instanceof PddCliError && err.code === 'E_BUSINESS' && err.detail?.issues?.includes('pricing_plan_invalid'),
      );

      assert.throws(
        () => planPreDraftPublish(makeValidSource(), { fullCountDiscountRate: 0.45 }),
        (err) => err instanceof PddCliError && err.code === 'E_CONFIG_INVALID',
      );
    });
  });
});

function makeRawProp(id, pid, refPid, name, valueTexts, {
  required = true,
  important = false,
  controlType = 1,
  valueType = 0,
  chooseMaxNum = 1,
  omitValues = false,
} = {}) {
  return {
    id,
    pid,
    ref_pid: refPid,
    name_alias: name,
    required,
    is_important: important,
    control_type: controlType,
    value_type: valueType,
    choose_max_num: chooseMaxNum,
    ...(omitValues ? {} : {
      values: valueTexts.map((text, index) => ({ vid: (id * 10) + index + 1, value: text })),
    }),
  };
}

function makeTemplate(properties, { id = 9001, moduleId = 8001 } = {}) {
  return {
    id,
    modules: [{ id: moduleId, propertys: properties }],
  };
}

describe('draft-planner (post-draft property planning & dynamic convergence)', () => {
  describe('normalizeGoodsPropertyTemplate', () => {
    it('unwraps both direct templates and live success envelopes using root id as propertysTid', () => {
      const raw = makeTemplate([makeRawProp(1001, 2001, '101', '重要 面料俗称', ['棉'])], { id: 9123, moduleId: 8001 });
      const direct = normalizeGoodsPropertyTemplate(raw);
      assert.equal(direct.ok, true);
      assert.equal(direct.propertysTid, 9123);
      assert.equal(direct.properties[0].name, '面料俗称');

      const enveloped = normalizeGoodsPropertyTemplate({
        success: true,
        error_code: 1000000,
        result: raw,
      });
      assert.equal(enveloped.ok, true);
      assert.equal(enveloped.propertysTid, 9123);
    });

    it('allows control_type=0 free-input without candidates while rejecting enumerated control_type=1 without candidates or failed envelopes', () => {
      const freeInput = normalizeGoodsPropertyTemplate(makeTemplate([
        makeRawProp(1001, 2001, '', '货号', [], { controlType: 0, omitValues: true }),
      ]));
      assert.equal(freeInput.ok, true);
      assert.equal(freeInput.properties[0].controlType, 0);
      assert.deepEqual(freeInput.properties[0].values, []);

      for (const bad of [
        null,
        { success: false, error_code: 40001, result: makeTemplate([makeRawProp(1001, 2001, '', 'A', ['1'])]) },
        makeTemplate([makeRawProp(1001, 2001, '', 'A', [], { controlType: 1, omitValues: true })]),
        { id: 1, modules: [] },
      ]) {
        const res = normalizeGoodsPropertyTemplate(bad);
        assert.equal(res.ok, false);
        assert.deepEqual(res.issues, ['property_template_invalid']);
      }
    });
  });

  describe('buildInitialPropertyPlan', () => {
    it('matches by unique refPid, exact normalized name (NFKC + Unicode dashes), collapses identical slash values, and maps free-input properties', () => {
      const template = makeTemplate([
        makeRawProp(1001, 2001, '101', '面料俗称', ['棉']),
        makeRawProp(1002, 2002, '', '尺码\u2014规格', ['均码—标准']),
        makeRawProp(1003, 2003, '', '货号', [], { required: false, controlType: 0, omitValues: true }),
      ]);
      const sourceProperties = [
        { name: '未知来源名', values: ['棉/棉'], refPid: '101' },
        { name: '尺码-规格', values: ['均码‐标准'] },
        { name: '货号', values: ['TEE-2026'] },
      ];

      const result = buildInitialPropertyPlan(sourceProperties, template);
      assert.equal(result.ok, true);
      assert.equal(result.propertysTid, 9001);
      assert.equal(result.skippedCount, 0);
      assert.deepEqual(result.warnings, []);
      assert.deepEqual(
        result.plan.map((item) => ({ name: item.name, values: item.values })),
        [
          { name: '面料俗称', values: [{ vid: 10011, value: '棉' }] },
          { name: '尺码-规格', values: [{ vid: 10021, value: '均码-标准' }] },
          { name: '货号', values: [{ vid: null, value: 'TEE-2026' }] },
        ],
      );
    });

    it('supports 面料/材质 one-to-many alias with single-target initial mapping and keeps non-identical slash values uncollapsed', () => {
      const template = makeTemplate([
        makeRawProp(1001, 2001, '', '面料俗称', ['棉', '棉/涤纶']),
      ]);
      const identicalAlias = buildInitialPropertyPlan([{ name: '面料/材质', values: ['棉/棉'] }], template);
      assert.equal(identicalAlias.ok, true);
      assert.equal(identicalAlias.plan.length, 1);
      assert.equal(identicalAlias.plan[0].name, '面料俗称');

      const mixedSlash = buildInitialPropertyPlan([{ name: '面料/材质', values: ['棉/涤纶'] }], template);
      assert.equal(mixedSlash.ok, true);
      assert.deepEqual(mixedSlash.plan[0].values, [{ vid: 10012, value: '棉/涤纶' }]);
    });

    it.each([
      {
        label: 'unmapped required property',
        template: makeTemplate([makeRawProp(1001, 2001, '101', '必填项', ['A'], { required: true, important: false })]),
        sourceProps: [{ name: '其他', values: ['X'] }],
        expectedIssue: 'required_property_unmapped',
      },
      {
        label: 'unmapped important property',
        template: makeTemplate([makeRawProp(1001, 2001, '101', '重要项', ['A'], { required: false, important: true })]),
        sourceProps: [{ name: '其他', values: ['X'] }],
        expectedIssue: 'important_property_unmapped',
      },
      {
        label: 'atomic multi-value failure on required property when one value is missing',
        template: makeTemplate([makeRawProp(1001, 2001, '101', '风格', ['休闲'], { required: true, chooseMaxNum: 2 })]),
        sourceProps: [{ name: '风格', values: ['休闲', '不存在'], refPid: '101' }],
        expectedIssue: 'required_property_unmapped',
      },
      {
        label: 'duplicate template refPid fails closed on required property',
        template: makeTemplate([
          makeRawProp(1001, 2001, '101', 'A', ['1'], { required: true }),
          makeRawProp(1002, 2002, '101', 'B', ['1'], { required: true }),
        ]),
        sourceProps: [{ name: 'A', values: ['1'], refPid: '101' }],
        expectedIssue: 'required_property_unmapped',
      },
    ])('fails closed on $label', ({ template, sourceProps, expectedIssue }) => {
      const result = buildInitialPropertyPlan(sourceProps, template);
      assert.equal(result.ok, false);
      assert.ok(result.issues.includes(expectedIssue));
      assert.deepEqual(result.plan, []);
    });

    it('atomically skips unmapped optional property and emits property_mapping_partial warning', () => {
      const template = makeTemplate([
        makeRawProp(1001, 2001, '101', '面料俗称', ['棉'], { required: true }),
        makeRawProp(1002, 2002, '102', '可选风格', ['休闲'], { required: false, important: false, chooseMaxNum: 2 }),
      ]);
      const result = buildInitialPropertyPlan([
        { name: '面料俗称', values: ['棉'], refPid: '101' },
        { name: '可选风格', values: ['休闲', '不存在的值'], refPid: '102' },
      ], template);
      assert.equal(result.ok, true);
      assert.equal(result.skippedCount, 1);
      assert.deepEqual(result.warnings, ['property_mapping_partial']);
      assert.deepEqual(result.plan.map((item) => item.name), ['面料俗称']);
    });
  });

  describe('reconcileDynamicTemplate & convergeDynamicProperties', () => {
    it('merges dynamic definitions with single-module fallback and filters incremental PIDs', () => {
      const base = normalizeGoodsPropertyTemplate(makeTemplate([
        makeRawProp(1001, 2001, '101', '面料俗称', ['棉']),
      ]));
      const initialPlan = buildInitialPropertyPlan([{ name: '面料/材质', values: ['棉'] }], base);
      const mappedPids = new Set(initialPlan.plan.map((p) => String(p.templatePid)));

      const step = reconcileDynamicTemplate({
        sourceProperties: [{ name: '面料/材质', values: ['棉'] }],
        baseTemplate: base,
        mappedTemplatePids: mappedPids,
        candidateDefinitions: [
          makeRawProp(1002, 2002, '102', '材质', ['棉']),
        ],
        visibleLabels: ['面料俗称', '材质'],
      });
      assert.equal(step.ok, true);
      assert.equal(step.converged, false);
      assert.deepEqual(step.addedPlan.map((p) => p.name), ['材质']);
      assert.deepEqual(step.propertyPlan.plan.map((p) => p.name), ['面料俗称', '材质']);
    });

    it.each([
      {
        label: 'conflicting property definition for same templatePid',
        base: normalizeGoodsPropertyTemplate(makeTemplate([
          makeRawProp(1001, 2001, '101', '面料俗称', ['棉']),
        ])),
        candidateDefinitions: [makeRawProp(1001, 2001, '101', '面料俗称', ['涤纶'])],
        visibleLabels: ['面料俗称'],
      },
      {
        label: 'missing templateModuleId when base template has multiple modules',
        base: normalizeGoodsPropertyTemplate({
          id: 9001,
          modules: [
            { id: 8001, propertys: [makeRawProp(1001, 2001, '101', '面料俗称', ['棉'])] },
            { id: 8002, propertys: [makeRawProp(1002, 2002, '102', '风格', ['休闲'], { required: false })] },
          ],
        }),
        candidateDefinitions: [makeRawProp(1003, 2003, '103', '材质', ['棉'])],
        visibleLabels: ['面料俗称', '风格', '材质'],
      },
      {
        label: 'unresolved visible label absent from merged template',
        base: normalizeGoodsPropertyTemplate(makeTemplate([
          makeRawProp(1001, 2001, '101', '面料俗称', ['棉']),
        ])),
        candidateDefinitions: [],
        visibleLabels: ['面料俗称', '未知动态行'],
      },
    ])('rejects $label with dynamic_property_template_invalid', ({ base, candidateDefinitions, visibleLabels }) => {
      const merged = mergeDynamicPropertyTemplate(base, candidateDefinitions, visibleLabels);
      assert.equal(merged.ok, false);
      assert.deepEqual(merged.issues, ['dynamic_property_template_invalid']);
    });

    it('converges within 5 rounds and rejects instability after 5 non-converging rounds', async () => {
      const initialTemplate = normalizeGoodsPropertyTemplate(makeTemplate([
        makeRawProp(1001, 2001, '101', '面料俗称', ['棉']),
      ]));
      const sourceProperties = [
        { name: '面料俗称', values: ['棉'], refPid: '101' },
        { name: '材质', values: ['棉'], refPid: '102' },
        { name: '成分含量', values: ['100%棉'], refPid: '103' },
        { name: '风格', values: ['休闲'], refPid: '104' },
        { name: '领型', values: ['圆领'], refPid: '105' },
        { name: '袖长', values: ['短袖'], refPid: '106' },
      ];
      const initialPlan = buildInitialPropertyPlan(sourceProperties, initialTemplate);

      const dynamicProps = [
        makeRawProp(1002, 2002, '102', '材质', ['棉']),
        makeRawProp(1003, 2003, '103', '成分含量', ['100%棉']),
        makeRawProp(1004, 2004, '104', '风格', ['休闲']),
        makeRawProp(1005, 2005, '105', '领型', ['圆领']),
        makeRawProp(1006, 2006, '106', '袖长', ['短袖']),
      ];

      let round = 0;
      const applied = [];
      const converged = await convergeDynamicProperties({
        sourceProperties,
        initialTemplate,
        initialPlan,
        readDynamicTemplate: async (currentTemplate) => {
          const next = dynamicProps.slice(0, 4)[round++];
          return next
            ? mergeDynamicPropertyTemplate(currentTemplate, [next], currentTemplate.properties.map((p) => p.name).concat(next.name_alias))
            : currentTemplate;
        },
        fillDependentProperties: async (added) => {
          applied.push(added.map((p) => p.name));
        },
      });
      assert.deepEqual(applied, [['材质'], ['成分含量'], ['风格'], ['领型']]);
      assert.equal(converged.propertyPlan.plan.length, 5);

      let unstableRound = 0;
      await assert.rejects(
        convergeDynamicProperties({
          sourceProperties,
          initialTemplate,
          initialPlan,
          readDynamicTemplate: async (currentTemplate) => {
            const next = dynamicProps[unstableRound++];
            return mergeDynamicPropertyTemplate(
              currentTemplate,
              [next],
              currentTemplate.properties.map((p) => p.name).concat(next.name_alias),
            );
          },
          fillDependentProperties: async () => {},
        }),
        (err) => err instanceof PddCliError
          && err.code === 'E_BUSINESS'
          && err.detail?.issues?.includes('dynamic_property_template_unstable'),
      );
    });
  });
});
