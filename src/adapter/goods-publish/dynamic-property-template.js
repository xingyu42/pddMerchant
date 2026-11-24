import { evaluateInMainWorld } from '../browser.js';
import { mergeDynamicPropertyTemplate } from './property-template.js';

const MAX_VISIBLE_PROPERTY_ROWS = 100;
const MAX_REACT_OBJECTS = 4_000;
const MAX_REACT_DEPTH = 8;
const MAX_TEMPLATE_VALUES = 200;

function invalidDynamicTemplate(baseTemplate) {
  return {
    ok: false,
    issues: ['dynamic_property_template_invalid'],
    propertysTid: baseTemplate?.propertysTid ?? null,
    properties: [],
  };
}

function projectVisiblePropertyDefinitions(limits) {
  const {
    maxVisiblePropertyRows,
    maxReactObjects,
    maxReactDepth,
    maxTemplateValues,
    knownPropertyNames,
  } = limits;
  const normalizeName = (value) => String(value ?? '')
    .normalize('NFKC')
    .replace(/^重要\s*/, '')
    .trim();
  const definitions = [];
  const visibleLabels = [];
  const definitionKeys = new Set();
  const knownNames = new Set(knownPropertyNames);
  const rows = [...document.querySelectorAll('.property-list')]
    .filter((row) => row.getClientRects().length > 0)
    .slice(0, maxVisiblePropertyRows);

  for (const row of rows) {
    const seen = new Set();
    const rowLabel = normalizeName(row.querySelector('label')?.innerText);
    if (!rowLabel) continue;
    visibleLabels.push(rowLabel);
    if (knownNames.has(rowLabel)) continue;
    let visitedObjectCount = 0;
    const queue = [];
    const enqueue = (value, depth, moduleId) => {
      if (queue.length + visitedObjectCount >= maxReactObjects) return;
      queue.push({ value, depth, moduleId });
    };
    // 先从行根取 React 句柄；没有再浅扫交互子节点，避免每个属性行扫全子树。
    const seedElements = [row];
    const rowHasReact = Object.getOwnPropertyNames(row).some((key) => key.startsWith('__react'));
    if (!rowHasReact) {
      seedElements.push(
        ...row.querySelectorAll('input, select, [class*="Select"], [class*="select"], [class*="property"]'),
      );
    }
    for (const element of seedElements) {
      for (const key of Object.getOwnPropertyNames(element)) {
        if (!key.startsWith('__react')) continue;
        try {
          enqueue(element[key], 0, null);
        } catch {
          // Ignore inaccessible framework properties.
        }
      }
    }

    while (queue.length > 0 && visitedObjectCount < maxReactObjects) {
      const { value, depth, moduleId } = queue.shift();
      if (!value || typeof value !== 'object' || seen.has(value) || depth > maxReactDepth) continue;
      seen.add(value);
      visitedObjectCount += 1;
      const nextModuleId = Array.isArray(value.propertys) && value.id != null
        ? value.id
        : moduleId;
      const name = normalizeName(value.name_alias ?? value.name);
      const rawValues = value.values?.content ?? value.values;
      const freeInput = Number(value.control_type ?? value.controlType) === 0 && rawValues == null;
      if (name === rowLabel
        && value.id != null
        && value.pid != null
        && (Array.isArray(rawValues) || freeInput)) {
        const definitionKey = `${nextModuleId ?? ''}:${value.id}`;
        if (!definitionKeys.has(definitionKey)) {
          definitionKeys.add(definitionKey);
          definitions.push({
            templateModuleId: value.template_module_id ?? value.templateModuleId ?? nextModuleId,
            id: value.id,
            pid: value.pid,
            ref_pid: value.ref_pid ?? value.refPid ?? '',
            name_alias: value.name_alias ?? value.name,
            required: value.required === true,
            is_important: value.is_important === true,
            control_type: value.control_type ?? value.controlType ?? 1,
            value_type: value.value_type ?? value.valueType ?? 0,
            choose_max_num: value.choose_max_num ?? value.chooseMaxNum ?? 1,
            values: Array.isArray(rawValues)
              ? { content: rawValues.slice(0, maxTemplateValues).map((item) => ({
                  vid: item?.vid ?? item?.id,
                  value: item?.value ?? item?.text ?? item?.name,
                })) }
              : undefined,
          });
        }
      }
      for (const key of Object.keys(value)) {
        try {
          const nested = value[key];
          if (nested && typeof nested === 'object') {
            enqueue(nested, depth + 1, nextModuleId);
          }
        } catch {
          // Ignore framework getters that throw outside their owner component.
        }
      }
    }
  }
  return { definitions, visibleLabels };
}

export async function readDynamicPropertyTemplate(page, baseTemplate, {
  mergeTemplate = mergeDynamicPropertyTemplate,
} = {}) {
  let projected;
  try {
    projected = await evaluateInMainWorld(page, projectVisiblePropertyDefinitions, {
      maxVisiblePropertyRows: MAX_VISIBLE_PROPERTY_ROWS,
      maxReactObjects: MAX_REACT_OBJECTS,
      maxReactDepth: MAX_REACT_DEPTH,
      maxTemplateValues: MAX_TEMPLATE_VALUES,
      knownPropertyNames: Array.isArray(baseTemplate?.properties)
        ? baseTemplate.properties.map((property) => property.name)
        : [],
    });
  } catch {
    return invalidDynamicTemplate(baseTemplate);
  }
  return mergeTemplate(
    baseTemplate,
    projected?.definitions ?? projected,
    projected?.visibleLabels ?? null,
  );
}
