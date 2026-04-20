import { runDiagnoseCommand, collectOrdersInput } from './shop.js';
import { scoreOrdersHealth } from '../../services/diagnose/index.js';

export async function run(options = {}) {
  return runDiagnoseCommand({
    command: 'diagnose.orders',
    options,
    fetchAndScore: async (page, ctx) => {
      const input = await collectOrdersInput(page, ctx);
      return scoreOrdersHealth(input ?? {});
    },
  });
}

export default run;
