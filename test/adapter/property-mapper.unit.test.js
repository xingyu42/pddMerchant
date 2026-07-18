import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import {
  buildPropertyPlan,
  normalizeGoodsPropertyTemplate,
  normalizeSourceGoodsProperties,
} from '../../src/adapter/goods-publish/property-mapper.js';
import { GOODS_PUBLISH_TEMPLATE } from '../../src/adapter/endpoints/goods-publish.js';

function property({
  id,
  name,
  refPid,
  required = false,
  important = false,
  chooseMaxNum = 1,
  values,
}) {
  return {
    id,
    name_alias: important ? `重要${name}` : name,
    pid: id + 1000,
    ref_pid: refPid,
    required,
    is_important: important,
    choose_max_num: chooseMaxNum,
    values: { content: values.map(([vid, value]) => ({ vid, value })) },
  };
}

function template(propertys) {
  return { id: 53673, modules: [{ id: 72984, propertys }] };
}

describe('normalizeSourceGoodsProperties', () => {
  it('projects only bounded structured property fields', () => {
    const result = normalizeSourceGoodsProperties([{ key: '品牌', values: ['恋雨萌'], ref_pid: 310, reference_id: 0 }]);
    assert.deepEqual(result, [{ name: '品牌', values: ['恋雨萌'], refPid: '310', referenceId: '0' }]);
  });

  it('does not invent properties from missing or malformed input', () => {
    assert.deepEqual(normalizeSourceGoodsProperties(null), []);
    assert.deepEqual(normalizeSourceGoodsProperties([{ key: '', values: ['值'] }]), []);
  });
});

describe('buildPropertyPlan', () => {
  it('prefers a unique refPid match and supports exact-name fallback', () => {
    const result = buildPropertyPlan([
      { name: '品牌', values: ['恋雨萌'], refPid: '310' },
      { name: '袖长', values: ['短袖'], refPid: '' },
    ], template([
      property({ id: 1, name: '品牌', refPid: 310, values: [[11, '恋雨萌']] }),
      property({ id: 2, name: '袖长', refPid: 320, values: [[22, '短袖']] }),
    ]));

    assert.equal(result.ok, true);
    assert.equal(result.plan.length, 2);
    assert.deepEqual(result.plan.map((item) => item.values), [
      [{ vid: 11, value: '恋雨萌' }],
      [{ vid: 22, value: '短袖' }],
    ]);
  });

  it('allows only the explicit fabric alias and duplicate slash-value collapse', () => {
    const result = buildPropertyPlan([
      { name: '面料/材质', values: ['棉/棉'], refPid: '' },
    ], template([
      property({ id: 7, name: '面料俗称', refPid: -6045, important: true, values: [[100, '棉']] }),
    ]));

    assert.equal(result.ok, true);
    assert.equal(result.plan[0].name, '面料俗称');
    assert.deepEqual(result.plan[0].values, [{ vid: 100, value: '棉' }]);
  });

  it('maps the verified fabric source to both fabric-name and required material targets', () => {
    const result = buildPropertyPlan([
      { name: '面料/材质', values: ['棉/棉'], refPid: '-6045' },
      { name: '成分含量', values: ['50%（含）-70%（不含）'], refPid: '396' },
    ], template([
      property({ id: 7, name: '面料俗称', refPid: 349, important: true, values: [[100, '棉']] }),
      property({ id: 8, name: '材质', refPid: 317, required: true, values: [[101, '棉']] }),
      property({
        id: 9,
        name: '成分含量',
        refPid: 396,
        required: true,
        values: [[102, '50%（含）-70%（不含）']],
      }),
    ]));

    assert.equal(result.ok, true);
    assert.deepEqual(result.plan.map((item) => item.name), ['面料俗称', '材质', '成分含量']);
    assert.deepEqual(result.plan.map((item) => item.values[0]), [
      { vid: 100, value: '棉' },
      { vid: 101, value: '棉' },
      { vid: 102, value: '50%(含)-70%(不含)' },
    ]);
  });

  it('maps all values only when each value is unique and within chooseMaxNum', () => {
    const result = buildPropertyPlan([
      { name: '流行元素', values: ['印花', '纯色'], refPid: '321' },
    ], template([
      property({
        id: 3,
        name: '流行元素',
        refPid: 321,
        chooseMaxNum: 2,
        values: [[31, '印花'], [32, '纯色']],
      }),
    ]));

    assert.equal(result.ok, true);
    assert.deepEqual(result.plan[0].values, [{ vid: 31, value: '印花' }, { vid: 32, value: '纯色' }]);
  });

  it('fails for required or important missing mappings and skips optional mappings atomically', () => {
    const result = buildPropertyPlan([
      { name: '可选属性', values: ['不存在', '候选'] },
    ], template([
      property({ id: 4, name: '必填属性', refPid: 400, required: true, values: [[41, '值']] }),
      property({ id: 5, name: '重要属性', refPid: 500, important: true, values: [[51, '值']] }),
      property({ id: 6, name: '可选属性', refPid: 600, chooseMaxNum: 2, values: [[61, '候选']] }),
    ]));

    assert.equal(result.ok, false);
    assert.ok(result.issues.includes('required_property_unmapped'));
    assert.ok(result.issues.includes('important_property_unmapped'));
    assert.deepEqual(result.warnings, ['property_mapping_partial']);
    assert.deepEqual(result.plan, []);
  });

  it('does not fuzzy-match, choose the first candidate, or accept ambiguous candidates', () => {
    const result = buildPropertyPlan([
      { name: '面料', values: ['棉'] },
      { name: '图案', values: ['卡通'] },
    ], template([
      property({ id: 8, name: '面料俗称', values: [[81, '棉']] }),
      property({ id: 9, name: '图案', values: [[91, '卡通'], [92, '卡通']] }),
    ]));

    assert.equal(result.ok, true);
    assert.deepEqual(result.plan, []);
    assert.deepEqual(result.warnings, ['property_mapping_partial']);
    assert.equal(result.skippedCount, 2);
  });

  it('rejects template drift instead of falling back to DOM order', () => {
    const result = buildPropertyPlan([{ name: '品牌', values: ['恋雨萌'] }], { modules: [] });
    assert.equal(result.ok, false);
    assert.deepEqual(result.issues, ['property_template_invalid']);
  });
});

describe('GOODS_PUBLISH_TEMPLATE', () => {
  it('returns a validated normalized contract without retaining the raw response', () => {
    const raw = template([
      property({ id: 7, name: '面料俗称', refPid: -6045, important: true, values: [[100, '棉']] }),
    ]);
    const normalized = normalizeGoodsPropertyTemplate(raw);

    assert.equal(GOODS_PUBLISH_TEMPLATE.isSuccess(raw), true);
    assert.deepEqual(GOODS_PUBLISH_TEMPLATE.normalize(raw), normalized);
    assert.equal(normalized.propertysTid, 53673);
    assert.equal(normalized.properties[0].important, true);
    assert.equal(Object.hasOwn(normalized, 'raw'), false);
    assert.equal(GOODS_PUBLISH_TEMPLATE.isSuccess({ modules: [] }), false);
  });

  it('unwraps the live merchant success envelope before normalizing modules', () => {
    const raw = {
      success: true,
      error_code: 1000000,
      result: template([
        property({ id: 7, name: '面料俗称', refPid: -6045, important: true, values: [[100, '棉']] }),
        {
          id: 8,
          name_alias: '商品货号',
          pid: 1008,
          ref_pid: 2119,
          required: false,
          is_important: false,
          control_type: 0,
          value_type: 0,
        },
      ]),
    };

    assert.equal(GOODS_PUBLISH_TEMPLATE.isSuccess(raw), true);
    const normalized = GOODS_PUBLISH_TEMPLATE.normalize(raw);
    assert.equal(normalized.ok, true);
    assert.equal(normalized.propertysTid, 53673);
    assert.equal(normalized.properties[0].name, '面料俗称');
    assert.equal(normalized.properties[1].name, '商品货号');
    assert.equal(normalized.properties[1].controlType, 0);
    assert.deepEqual(normalized.properties[1].values, []);
    assert.equal(Object.hasOwn(normalized, 'raw'), false);
  });
});
