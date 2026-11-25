import { PddCliError, ExitCodes } from '../infra/errors.js';

export const OWNER_TAG_PATTERN = /^[a-z0-9-]{1,32}$/;

export function browserRuntimeError(reason, message = '浏览器运行时配置无效') {
  return new PddCliError({
    code: 'E_BROWSER_RUNTIME',
    message,
    hint: '确认浏览器版本与当前操作系统受支持，并重新安装 Patchright Chromium',
    detail: { reason },
    exitCode: ExitCodes.GENERAL,
  });
}

export function assertValidOwnerTag(ownerTag) {
  if (ownerTag !== undefined && (typeof ownerTag !== 'string' || !OWNER_TAG_PATTERN.test(ownerTag))) {
    throw browserRuntimeError('invalid_owner_tag');
  }
}

export function assertValidStorageState(storageState, { required = false } = {}) {
  if (!storageState && !required) return;
  if (!Array.isArray(storageState?.cookies) || !Array.isArray(storageState?.origins)) {
    throw browserRuntimeError('snapshot_shape_invalid');
  }
}
