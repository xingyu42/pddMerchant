import { runDiagnoseCommand, collectPromoInput } from './shop.js';
import { scorePromoHealth } from '../../services/diagnose/index.js';

export async function run(options = {}) {
  return runDiagnoseCommand({
    command: 'diagnose.promo',
    options,
    fetchAndScore: async (page, ctx) => {
      const input = await collectPromoInput(page, ctx);
      return scorePromoHealth(input ?? {});
    },
  });
}

export default run;
