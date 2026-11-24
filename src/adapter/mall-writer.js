import { createLiveMallPort } from './mall-port.js';

export async function switchTo(page, mallId, { strict } = {}) {
  return createLiveMallPort().switchMall(page, mallId, { strict });
}
