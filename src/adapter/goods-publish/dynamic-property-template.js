import { evaluateInMainWorld } from '../browser.js';
import { normalizeGoodsPropertyTemplate } from './property-mapper.js';

const MAX_VISIBLE_PROPERTY_ROWS = 100;
const MAX_REACT_OBJECTS = 10_000;
const MAX_REACT_DEPTH = 10;
const MAX_TEMPLATE_VALUES = 200;

function invalidDynamicTemplate(baseTemplate) {
  return {
    ok: false,
    issues: ['dynamic_property_template_invalid'],
    propertysTid: baseTemplate?.propertysTid ?? null,
    properties: [],
  };
}

function propertySignature(property) {
  return JSON.stringify({
    templateModuleId: String(property.templateModuleId),
    templatePid: String(property.templatePid),
    pid: String(property.pid),
    refPid: String(property.refPid),
    name: property.name,
    required: property.required,
    important: property.important,
    controlType: property.controlType,
    valueType: property.valueType,
    chooseMaxNum: property.chooseMaxNum,
    values: property.values.map((value) => [String(value.vid), value.value]),
  });
}

export function mergeDynamicPropertyTemplate(baseTemplate, rawDefinitions) {
  if (baseTemplate?.ok !== true || !Array.isArray(baseTemplate.properties)) {
    return invalidDynamicTemplate(baseTemplate);
  }
  if (!Array.isArray(rawDefinitions) || rawDefinitions.length === 0) return baseTemplate;

  const baseModules = new Map(baseTemplate.properties.map((property) => [
    String(property.templateModuleId),
    property.templateModuleId,
  ]));
  const fallbackModuleId = baseModules.size === 1
    ? [...baseModules.values()][0]
    : null;
  const grouped = new Map();
  for (const definition of rawDefinitions) {
    const moduleId = definition?.templateModuleId
      ?? fallbackModuleId;
    if (moduleId == null) return invalidDynamicTemplate(baseTemplate);
    const key = String(moduleId);
    if (!grouped.has(key)) grouped.set(key, { moduleId, propertys: [] });
    grouped.get(key).propertys.push(definition);
  }

  const normalized = normalizeGoodsPropertyTemplate({
    id: baseTemplate.propertysTid,
    modules: [...grouped.values()].map(({ moduleId, propertys }) => ({
      id: moduleId,
      propertys,
    })),
  });
  if (!normalized.ok) return invalidDynamicTemplate(baseTemplate);

  const merged = new Map(baseTemplate.properties.map((property) => [
    String(property.templatePid),
    property,
  ]));
  for (const property of normalized.properties) {
    const key = String(property.templatePid);
    const existing = merged.get(key);
    if (existing && propertySignature(existing) !== propertySignature(property)) {
      return invalidDynamicTemplate(baseTemplate);
    }
    if (!existing) merged.set(key, property);
  }
  return {
    ok: true,
    issues: [],
    propertysTid: baseTemplate.propertysTid,
    properties: [...merged.values()],
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
    for (const element of [row, ...row.querySelectorAll('*')]) {
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

export async function readDynamicPropertyTemplate(page, baseTemplate) {
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
  const merged = mergeDynamicPropertyTemplate(baseTemplate, projected?.definitions ?? projected);
  if (!merged.ok) return merged;

  const knownNames = new Set(merged.properties.map((property) => property.name));
  const unresolvedVisibleNames = (projected?.visibleLabels ?? [])
    .filter((name) => !knownNames.has(name));
  return unresolvedVisibleNames.length > 0 ? invalidDynamicTemplate(baseTemplate) : merged;
}

export {
  MAX_VISIBLE_PROPERTY_ROWS,
  MAX_REACT_OBJECTS,
  MAX_REACT_DEPTH,
  MAX_TEMPLATE_VALUES,
};
