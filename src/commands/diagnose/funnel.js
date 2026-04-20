import { runDiagnoseCommand } from './shop.js';
import { scoreFunnelHealth } from '../../services/diagnose/index.js';

export async function run(options = {}) {
  return runDiagnoseCommand({
    command: 'diagnose.funnel',
    options,
    fetchAndScore: async () => {
      return scoreFunnelHealth({ data: null });
    },
  });
}

export default run;
