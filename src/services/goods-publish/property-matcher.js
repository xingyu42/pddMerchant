import { PddCliError, ExitCodes } from '../../infra/errors.js';

const NAME_ALIASES = {
  '面料材质': ['重要面料俗称', '面料', '材质', '面料/材质'],
  '风格': ['风格'],
  '款式': ['款式', '服装款式'],
  '裙长': ['裙长', '裙型/裙长'],
  '袖长': ['袖长', '袖型/袖长'],
  '领型': ['领型'],
  '年龄': ['适用年龄', '年龄段'],
  '颜色': ['颜色', '花色'],
  '尺码': ['尺码', '尺寸'],
  '品牌': ['品牌'],
};

export function normalizePropertyText(text) {
  return String(text ?? '').trim().toLowerCase().replace(/[\s/·・、，,]/g, '');
}

function buildAliasIndex() {
  const index = new Map();
  for (const [canonical, aliases] of Object.entries(NAME_ALIASES)) {
    for (const alias of aliases) {
      index.set(normalizePropertyText(alias), normalizePropertyText(canonical));
    }
    index.set(normalizePropertyText(canonical), normalizePropertyText(canonical));
  }
  return index;
}

const ALIAS_INDEX = buildAliasIndex();

function resolveCanonical(name) {
  const normalized = normalizePropertyText(name);
  return ALIAS_INDEX.get(normalized) ?? normalized;
}

export function parsePropertiesText(propertiesText) {
  if (!propertiesText || typeof propertiesText !== 'string') return [];
  return propertiesText
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .flatMap(line => {
      const match = line.match(/^(.+?)[：:](.+)$/);
      if (!match) return [];
      const key = match[1].trim();
      const raw = match[2].trim();
      const values = raw.split(/[,，、]/).map(v => v.trim()).filter(Boolean);
      return [{ key, values }];
    });
}

export function matchGoodsProperties(sourceProps, templateModules) {
  if (!Array.isArray(templateModules)) {
    throw new PddCliError({
      code: 'E_PROPERTY_MATCH_INVALID_INPUT',
      message: 'templateModules must be an array',
      exitCode: ExitCodes.USAGE,
    });
  }

  const parsedSource = Array.isArray(sourceProps)
    ? sourceProps
    : parsePropertiesText(sourceProps);

  const sourceByRefPid = new Map();
  const sourceByNormName = new Map();
  for (const prop of parsedSource) {
    if (prop.ref_pid != null) sourceByRefPid.set(String(prop.ref_pid), prop);
    const canonical = resolveCanonical(prop.key ?? '');
    if (!sourceByNormName.has(canonical)) sourceByNormName.set(canonical, prop);
  }

  const matched = [];
  const unmatched = [];

  for (const module of templateModules) {
    const moduleId = module.module_id ?? module.id ?? 0;
    const properties = module.propertys ?? module.properties ?? [];

    for (const templateProp of properties) {
      const refPid = templateProp.ref_pid;
      const pid = templateProp.pid ?? templateProp.property_id;
      const propName = templateProp.name ?? '';
      const required = Boolean(templateProp.required);

      let sourceProp = null;
      if (refPid != null) sourceProp = sourceByRefPid.get(String(refPid)) ?? null;
      if (!sourceProp) {
        const canonical = resolveCanonical(propName);
        sourceProp = sourceByNormName.get(canonical) ?? null;
      }

      if (!sourceProp) {
        unmatched.push({ name: propName, required });
        continue;
      }

      const valueContents = templateProp.values?.content ?? templateProp.values ?? [];
      const sourceValues = Array.isArray(sourceProp.values) ? sourceProp.values : [String(sourceProp.values ?? '')];

      let vidFound = null;
      let valueFound = null;
      for (const sourceVal of sourceValues) {
        const normSourceVal = normalizePropertyText(sourceVal);
        for (const vc of valueContents) {
          const vcText = typeof vc === 'string' ? vc : (vc.value ?? vc.name ?? '');
          if (normalizePropertyText(vcText) === normSourceVal) {
            vidFound = vc.vid ?? vc.id ?? null;
            valueFound = vcText;
            break;
          }
        }
        if (vidFound != null) break;
      }

      if (vidFound != null) {
        matched.push({
          template_pid: templateProp.template_pid ?? null,
          template_module_id: moduleId,
          ref_pid: refPid ?? null,
          pid,
          vid: vidFound,
          value: valueFound,
          value_unit: '',
          content: '',
        });
      } else {
        unmatched.push({ name: propName, required });
      }
    }
  }

  return { matched, unmatched };
}
