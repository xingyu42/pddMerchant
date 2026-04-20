import { runDiagnoseCommand, collectGoodsInput } from './shop.js';
import { scoreInventoryHealth } from '../../services/diagnose/index.js';

export async function run(options = {}) {
  return runDiagnoseCommand({
    command: 'diagnose.inventory',
    options,
    fetchAndScore: async (page, ctx) => {
      const input = await collectGoodsInput(page, ctx);
      return scoreInventoryHealth(input ?? {});
    },
  });
}

export default run;
