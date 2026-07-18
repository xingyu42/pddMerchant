import { describe, it } from 'vitest';
import assert from 'node:assert/strict';

import {
  mergeDynamicPropertyTemplate,
  readDynamicPropertyTemplate,
} from '../../src/adapter/goods-publish/dynamic-property-template.js';

const baseTemplate = {
  ok: true,
  issues: [],
  propertysTid: 53413,
  properties: [{
    templateModuleId: 72430,
    templatePid: 466501,
    pid: 7,
    refPid: '349',
    name: '面料俗称',
    required: false,
    important: true,
    controlType: 1,
    valueType: 0,
    chooseMaxNum: 1,
    values: [{ vid: 10348, value: '棉' }],
  }],
};

const dynamicDefinitions = [{
  templateModuleId: null,
  id: 466502,
  pid: 16,
  ref_pid: 317,
  name_alias: '材质',
  required: true,
  is_important: false,
  control_type: 1,
  value_type: 0,
  choose_max_num: 1,
  values: { content: [{ vid: 10571, value: '棉' }] },
}, {
  templateModuleId: null,
  id: 466523,
  pid: 56,
  ref_pid: 396,
  name_alias: '成分含量',
  required: true,
  is_important: false,
  control_type: 1,
  value_type: 1,
  choose_max_num: 1,
  values: { content: [{ vid: 4291987, value: '50%（含）-70%（不含）' }] },
}];

describe('dynamic property template', () => {
  it('merges bounded visible React property definitions into a single-module template', () => {
    const result = mergeDynamicPropertyTemplate(baseTemplate, dynamicDefinitions);

    assert.equal(result.ok, true);
    assert.deepEqual(result.properties.map((property) => property.name), [
      '面料俗称',
      '材质',
      '成分含量',
    ]);
    assert.equal(result.properties[2].templateModuleId, 72430);
    assert.deepEqual(result.properties[2].values, [{
      vid: 4291987,
      value: '50%(含)-70%(不含)',
    }]);
  });

  it('fails closed when a dynamic definition has no module evidence and the base has multiple modules', () => {
    const result = mergeDynamicPropertyTemplate({
      ...baseTemplate,
      properties: [
        ...baseTemplate.properties,
        { ...baseTemplate.properties[0], templateModuleId: 99999, templatePid: 499999 },
      ],
    }, dynamicDefinitions);

    assert.equal(result.ok, false);
    assert.deepEqual(result.issues, ['dynamic_property_template_invalid']);
  });

  it('fails closed when a dynamic definition conflicts with a known template PID', () => {
    const result = mergeDynamicPropertyTemplate(baseTemplate, [{
      ...dynamicDefinitions[0],
      id: 466501,
      name_alias: '材质',
    }]);

    assert.equal(result.ok, false);
    assert.deepEqual(result.issues, ['dynamic_property_template_invalid']);
  });

  it('reads through the main world and returns the merged stable template', async () => {
    const page = {
      evaluate: async (_pageFunction, arg, mainWorld) => {
        assert.equal(mainWorld, false);
        assert.deepEqual(arg.knownPropertyNames, ['面料俗称']);
        return dynamicDefinitions;
      },
    };

    const result = await readDynamicPropertyTemplate(page, baseTemplate);
    assert.equal(result.ok, true);
    assert.equal(result.properties.length, 3);
  });

  it('fails closed when a visible dynamic row has no exact projected model', async () => {
    const page = {
      evaluate: async () => ({
        definitions: [],
        visibleLabels: ['面料俗称', '材质'],
      }),
    };

    const result = await readDynamicPropertyTemplate(page, baseTemplate);
    assert.equal(result.ok, false);
    assert.deepEqual(result.issues, ['dynamic_property_template_invalid']);
  });
});
