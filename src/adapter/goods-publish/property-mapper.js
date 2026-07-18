const MAX_SOURCE_PROPERTIES = 100;
const MAX_VALUES_PER_PROPERTY = 20;
const MAX_PROPERTY_TEXT_LENGTH = 200;

const PROPERTY_NAME_ALIASES = new Map([
  ['面料/材质', ['面料俗称', '材质']],
]);

function asObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function normalizeText(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/[‐‑‒–—―]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizePropertyName(value) {
  return normalizeText(value).replace(/^重要\s*/, '');
}

function normalizeSourceValue(value) {
  const normalized = normalizeText(value);
  // 仅处理源站偶发的 “棉/棉” 重复写法；无斜杠时直接返回。
  if (!normalized.includes('/')) return normalized;
  const parts = normalized.split('/').map(normalizeText).filter(Boolean);
  if (parts.length > 1 && new Set(parts).size === 1) return parts[0];
  return normalized;
}

function normalizeSourceProperty(rawProperty) {
  const property = asObject(rawProperty);
  if (!property) return null;
  const name = normalizeText(property.name ?? property.key ?? property.propertyName ?? property.property_name);
  const rawValues = property.values ?? property.valueList ?? property.value_list;
  if (!name || !Array.isArray(rawValues)) return null;
  const values = rawValues
    .slice(0, MAX_VALUES_PER_PROPERTY)
    .map((value) => normalizeText(asObject(value)?.value ?? asObject(value)?.text ?? value))
    .filter((value) => value && value.length <= MAX_PROPERTY_TEXT_LENGTH);
  if (values.length === 0) return null;
  const refPid = property.refPid ?? property.ref_pid;
  const referenceId = property.referenceId ?? property.reference_id;
  return {
    name: name.slice(0, MAX_PROPERTY_TEXT_LENGTH),
    values: [...new Set(values)],
    refPid: refPid == null ? '' : normalizeText(refPid),
    referenceId: referenceId == null ? '' : normalizeText(referenceId),
  };
}

export function normalizeSourceGoodsProperties(rawProperties) {
  if (!Array.isArray(rawProperties)) return [];
  return rawProperties.slice(0, MAX_SOURCE_PROPERTIES).map(normalizeSourceProperty).filter(Boolean);
}

function normalizeTemplateValue(rawValue) {
  const value = asObject(rawValue);
  if (!value) return null;
  const vid = value.vid ?? value.id ?? value.value_id;
  const text = normalizeText(value.value ?? value.text ?? value.name);
  return vid != null && text ? { vid, value: text } : null;
}

function normalizeTemplateProperty(rawProperty, templateModuleId) {
  const property = asObject(rawProperty);
  if (!property) return null;
  const templatePid = property.id ?? property.template_pid;
  const pid = property.pid;
  const name = normalizePropertyName(property.name_alias ?? property.name);
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
    refPid: property.ref_pid == null ? '' : normalizeText(property.ref_pid),
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
  const code = envelope.error_code ?? envelope.errorCode;
  const succeeded = envelope.success === true || code === 0 || code === 1000000;
  return succeeded ? result : null;
}

export function normalizeGoodsPropertyTemplate(rawTemplate) {
  const normalized = normalizeTemplate(unwrapTemplatePayload(rawTemplate));
  return normalized
    ? { ok: true, issues: [], ...normalized }
    : { ok: false, issues: ['property_template_invalid'], propertysTid: null, properties: [] };
}

function propertyCandidates(sourceProperty, templateProperties) {
  const sourceName = normalizePropertyName(sourceProperty.name);
  const aliasTargets = PROPERTY_NAME_ALIASES.get(sourceName);
  const candidates = [];
  if (sourceProperty.refPid) {
    const byRefPid = templateProperties.filter((item) => item.refPid === sourceProperty.refPid);
    if (byRefPid.length > 1) return null;
    if (byRefPid.length === 1) candidates.push(byRefPid[0]);
    if (byRefPid.length === 1 && !aliasTargets) return candidates;
  }
  const targetNames = aliasTargets ?? [sourceName];
  for (const targetName of targetNames) {
    const matches = templateProperties.filter((item) => normalizePropertyName(item.name) === targetName);
    if (matches.length > 1) return null;
    if (matches.length === 1) candidates.push(matches[0]);
  }
  return [...new Map(candidates.map((item) => [String(item.templatePid), item])).values()];
}

function matchValues(sourceProperty, templateProperty) {
  const selected = [];
  for (const rawValue of sourceProperty.values) {
    const expected = normalizeSourceValue(rawValue);
    const matches = templateProperty.values.filter((candidate) => normalizeText(candidate.value) === expected);
    if (matches.length !== 1) return null;
    selected.push(matches[0]);
  }
  const unique = [...new Map(selected.map((item) => [String(item.vid), item])).values()];
  if (unique.length === 0 || unique.length > templateProperty.chooseMaxNum) return null;
  return unique;
}

function criticalIssue(property) {
  if (property.required) return 'required_property_unmapped';
  if (property.important) return 'important_property_unmapped';
  return null;
}

export function buildPropertyPlan(rawSourceProperties, rawTemplate) {
  const templateResult = rawTemplate?.ok === true && Array.isArray(rawTemplate?.properties)
    ? rawTemplate
    : normalizeGoodsPropertyTemplate(rawTemplate);
  if (!templateResult.ok) {
    return { ok: false, issues: ['property_template_invalid'], warnings: [], plan: [], skippedCount: 0 };
  }
  const template = templateResult;
  const sourceProperties = normalizeSourceGoodsProperties(rawSourceProperties);
  const issues = new Set();
  const matchedTemplatePids = new Set();
  const plan = [];
  let skippedCount = 0;

  if (sourceProperties.length === 0) issues.add('source_properties_missing');
  for (const sourceProperty of sourceProperties) {
    const candidates = propertyCandidates(sourceProperty, template.properties);
    if (!candidates || candidates.length === 0) {
      skippedCount += 1;
      continue;
    }
    for (const templateProperty of candidates) {
      matchedTemplatePids.add(String(templateProperty.templatePid));
      const values = matchValues(sourceProperty, templateProperty);
      if (!values) {
        const issue = criticalIssue(templateProperty);
        if (issue) issues.add(issue);
        else skippedCount += 1;
        continue;
      }
      plan.push({
        templateModuleId: templateProperty.templateModuleId,
        templatePid: templateProperty.templatePid,
        pid: templateProperty.pid,
        refPid: templateProperty.refPid,
        name: templateProperty.name,
        sourceName: sourceProperty.name,
        required: templateProperty.required,
        important: templateProperty.important,
        controlType: templateProperty.controlType,
        valueType: templateProperty.valueType,
        chooseMaxNum: templateProperty.chooseMaxNum,
        values,
      });
    }
  }

  for (const templateProperty of template.properties) {
    if (matchedTemplatePids.has(String(templateProperty.templatePid))) continue;
    const issue = criticalIssue(templateProperty);
    if (issue) issues.add(issue);
  }
  const warnings = skippedCount > 0 ? ['property_mapping_partial'] : [];
  return {
    ok: issues.size === 0,
    issues: [...issues],
    warnings,
    plan: issues.size === 0 ? plan : [],
    skippedCount,
    propertysTid: template.propertysTid,
  };
}
