import { PddCliError, ExitCodes } from './errors.js';

function invalidCandidate() {
  return new PddCliError({
    code: 'E_AUTH_CANDIDATE_INVALID',
    message: '只有本次校验通过的冻结材料可以提交',
    exitCode: ExitCodes.AUTH,
  });
}

/** Recursively freeze an object graph while guarding against cycles. */
export function deepFreeze(value, seen = new WeakSet()) {
  if (value && typeof value === 'object') {
    if (seen.has(value)) return value;
    seen.add(value);
    for (const child of Object.values(value)) deepFreeze(child, seen);
    Object.freeze(value);
  }
  return value;
}

/** Create an isolated, instance-scoped seal for verified merchant candidates. */
export function createCandidateSeal() {
  const verified = new WeakSet();
  return Object.freeze({
    seal(candidate) {
      if (!candidate || typeof candidate !== 'object') throw invalidCandidate();
      const frozen = deepFreeze(candidate);
      verified.add(frozen);
      return frozen;
    },
    assert(candidate) {
      if (!candidate || typeof candidate !== 'object' || !verified.has(candidate)) {
        throw invalidCandidate();
      }
      return candidate;
    },
    has(candidate) {
      return Boolean(candidate && typeof candidate === 'object' && verified.has(candidate));
    },
  });
}
