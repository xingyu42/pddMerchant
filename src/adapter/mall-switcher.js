// Re-export shim — kept for one release to avoid breaking downstream imports.
// Import directly from mall-reader.js, mall-writer.js, mall-xhr-probe.js instead.
export {
  resolveMallContext,
  currentMall,
  listMalls,
  readPath,
} from './mall-reader.js';

export { switchTo } from './mall-writer.js';

export {
  readActiveIdFromXhr,
  findActiveIdInPayload,
} from './mall-xhr-probe.js';
