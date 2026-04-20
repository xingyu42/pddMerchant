import { getDdkPromo } from '../../services/promo.js';
import { emit } from '../../infra/output.js';

export async function run(options = {}) {
  const { json = false, mall } = options;
  const startedAt = Date.now();
  const placeholder = await getDdkPromo(null, { mall });

  return emit(
    {
      ok: false,
      command: 'promo.ddk',
      data: { mallId: mall ?? null, status: 'not_implemented' },
      error: placeholder.error,
      meta: {
        latency_ms: Date.now() - startedAt,
        warnings: ['DDK V0.1 未接入'],
      },
    },
    { json }
  );
}

export default run;
