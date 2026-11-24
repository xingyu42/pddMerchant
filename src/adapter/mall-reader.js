import { buildMallContext } from './mall-context.js';
import { listLiveMalls } from './mall-port.js';

export async function listMalls(page) {
  return listLiveMalls(page);
}

export { buildMallContext };
