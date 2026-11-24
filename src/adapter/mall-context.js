export function resolveTargetPage(target) {
  if (target && typeof target === 'object' && 'page' in target && target.page !== undefined) {
    return target.page;
  }
  return target;
}

export function normalizeMallRecord(raw, activeId) {
  if (!raw || typeof raw !== 'object') {
    return { id: '', name: '', is_current: false };
  }
  const id = String(raw.mallId ?? raw.mall_id ?? raw.id ?? '').trim();
  const name = String(raw.mallName ?? raw.mall_name ?? raw.name ?? '');
  const isCurrent = activeId != null && String(activeId) === id && id.length > 0;
  return { id, name, is_current: isCurrent };
}

function normalizeMallList(rawList, activeId) {
  if (!Array.isArray(rawList)) return [];
  return rawList.map((item) => normalizeMallRecord(item, activeId)).filter((m) => m.id);
}

function resolveActiveName(activeName, malls, activeId) {
  if (typeof activeName === 'string' && activeName.length > 0) return activeName;
  if (activeId == null || !Array.isArray(malls)) return '';
  const hit = malls.find((m) => m.id === String(activeId));
  return typeof hit?.name === 'string' ? hit.name : '';
}

export function buildMallContext({ activeId, activeName, malls, source }) {
  const normalizedId = activeId == null || String(activeId).trim() === '' ? null : String(activeId).trim();
  const normalizedMalls = normalizeMallList(malls, normalizedId);
  return {
    activeId: normalizedId,
    activeName: resolveActiveName(activeName, normalizedMalls, normalizedId),
    malls: normalizedMalls,
    source: source ?? null,
  };
}
