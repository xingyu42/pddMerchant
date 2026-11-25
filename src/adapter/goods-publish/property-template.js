import { isSuccessfulResponse } from '../response-interpreter.js';

function asObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

export function normalizeTemplateText(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/[‐‑‒–—―]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeTemplatePropertyName(value) {
  return normalizeTemplateText(value).replace(/^重要\s*/, '');
}

export function normalizeCompactPropertyText(value) {
  return normalizeTemplateText(value)
    .replace(/\s+/g, '')
    .replace(/^重要/, '');
}

function normalizeTemplateValue(rawValue) {
  const value = asObject(rawValue);
  if (!value) return null;
  const vid = value.vid ?? value.id ?? value.value_id;
  const text = normalizeTemplateText(value.value ?? value.text ?? value.name);
  return vid != null && text ? { vid, value: text } : null;
}

function normalizeTemplateProperty(rawProperty, templateModuleId) {
  const property = asObject(rawProperty);
  if (!property) return null;
  const templatePid = property.id ?? property.template_pid;
  const pid = property.pid;
  const name = normalizeTemplatePropertyName(property.name_alias ?? property.name);
  const rawValues = property.values?.content ?? property.values;
  const controlType = Number(property.control_type ?? property.controlType ?? 1);
  const valueType = Number(property.value_type ?? property.valueType ?? 0);
  const isFreeInput = controlType === 0 && rawValues == null;
  if (templatePid == null || pid == null || !name || (!Array.isArray(rawValues) && !isFreeInput)) return null;
  const values = Array.isArray(rawValues) ? rawValues.map(normalizeTemplateValue).filter(Boolean) : [];
  const chooseMaxNum = Number(property.choose_max_num ?? property.chooseMaxNum ?? 1);
  return {
    templateModuleId,
    templatePid,
    pid,
    refPid: property.ref_pid == null ? '' : normalizeTemplateText(property.ref_pid),
    name,
    required: property.required === true,
    important: property.is_important === true,
    controlType,
    valueType,
    chooseMaxNum: Number.isSafeInteger(chooseMaxNum) && chooseMaxNum > 0 ? chooseMaxNum : 1,
    values,
  };
}

function normalizeTemplate(template) {
  const modules = Array.isArray(template?.modules) ? template.modules : [];
  if (modules.length === 0) return null;
  const properties = [];
  for (const rawModule of modules) {
    const module = asObject(rawModule);
    if (!module || module.id == null || !Array.isArray(module.propertys)) return null;
    for (const rawProperty of module.propertys) {
      const property = normalizeTemplateProperty(rawProperty, module.id);
      if (!property) return null;
      properties.push(property);
    }
  }
  return properties.length > 0 ? { propertysTid: template.id ?? modules[0].id, properties } : null;
}

function unwrapTemplatePayload(rawTemplate) {
  const envelope = asObject(rawTemplate);
  if (!envelope) return null;
  const result = asObject(envelope.result);
  if (!result) return envelope;
  const succeeded = isSuccessfulResponse(envelope, { mode: 'flag-or-code' });
  return succeeded ? result : null;
}

export function normalizeGoodsPropertyTemplate(rawTemplate) {
  const normalized = normalizeTemplate(unwrapTemplatePayload(rawTemplate));
  return normalized
    ? { ok: true, issues: [], ...normalized }
    : { ok: false, issues: ['property_template_invalid'], propertysTid: null, properties: [] };
}

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

function groupDynamicDefinitions(baseTemplate, rawDefinitions) {
  const baseModules = new Map(baseTemplate.properties.map((property) => [
    String(property.templateModuleId),
    property.templateModuleId,
  ]));
  const fallbackModuleId = baseModules.size === 1 ? [...baseModules.values()][0] : null;
  const grouped = new Map();
  for (const definition of rawDefinitions) {
    const moduleId = definition?.templateModuleId ?? definition?.template_module_id ?? fallbackModuleId;
    if (moduleId == null) return null;
    const key = String(moduleId);
    if (!grouped.has(key)) grouped.set(key, { moduleId, propertys: [] });
    grouped.get(key).propertys.push(definition);
  }
  return grouped;
}

function hasUnresolvedVisibleLabels(properties, visibleLabels) {
  if (!Array.isArray(visibleLabels) || visibleLabels.length === 0) return false;
  const knownNames = new Set(properties.map((property) => normalizeTemplatePropertyName(property.name)));
  return visibleLabels.some((label) => !knownNames.has(normalizeTemplatePropertyName(label)));
}

export function mergeDynamicPropertyTemplate(baseTemplate, rawDefinitions, visibleLabels = null) {
  if (baseTemplate?.ok !== true || !Array.isArray(baseTemplate.properties)) {
    return invalidDynamicTemplate(baseTemplate);
  }
  const hasDefinitions = Array.isArray(rawDefinitions) && rawDefinitions.length > 0;
  if (!hasDefinitions) {
    return hasUnresolvedVisibleLabels(baseTemplate.properties, visibleLabels)
      ? invalidDynamicTemplate(baseTemplate)
      : baseTemplate;
  }

  const grouped = groupDynamicDefinitions(baseTemplate, rawDefinitions);
  if (!grouped) return invalidDynamicTemplate(baseTemplate);

  const normalized = normalizeGoodsPropertyTemplate({
    id: baseTemplate.propertysTid,
    modules: [...grouped.values()].map(({ moduleId, propertys }) => ({ id: moduleId, propertys })),
  });
  if (!normalized.ok) return invalidDynamicTemplate(baseTemplate);

  const merged = new Map(baseTemplate.properties.map((property) => [String(property.templatePid), property]));
  for (const property of normalized.properties) {
    const key = String(property.templatePid);
    const existing = merged.get(key);
    if (existing && propertySignature(existing) !== propertySignature(property)) {
      return invalidDynamicTemplate(baseTemplate);
    }
    if (!existing) merged.set(key, property);
  }

  const properties = [...merged.values()];
  if (hasUnresolvedVisibleLabels(properties, visibleLabels)) {
    return invalidDynamicTemplate(baseTemplate);
  }
  return { ok: true, issues: [], propertysTid: baseTemplate.propertysTid, properties };
}
