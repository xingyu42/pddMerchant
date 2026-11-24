import { detectLiveMallContext, listMalls, SWITCHER_TRIGGER_SELECTORS } from './mall-reader.js';
import { switchTo } from './mall-writer.js';

export { SWITCHER_TRIGGER_SELECTORS };

/** Create a Live MallPort using the 6-layer browser probe chain and strict ID validation. */
export function createLiveMallPort() {
  return Object.freeze({
    detectCurrentMall: (target, opts) => detectLiveMallContext(target, opts),
    listMalls: (target) => listMalls(target),
    switchMall: (target, mallId, opts) => switchTo(target, mallId, opts),
  });
}
