import { withCommand } from './_runner.js';
import { diagnoseEnvironment } from '../services/doctor.js';
import { renderDoctor } from '../services/views/auth.js';

export const run = withCommand({
  name: 'doctor',
  lifecycle: 'local',
  needsAccount: 'optional',
  needsMall: 'none',
  render: renderDoctor,
  async run(ctx) {
    const report = await diagnoseEnvironment(
      {
        account: ctx.accountId != null
          ? { accountId: ctx.accountId, slug: ctx.accountSlug, account: ctx.account }
          : null,
        consumerAccount: ctx.config?.consumerAccount,
        signal: ctx.signal,
        deadlineAt: ctx.deadlineAt ?? undefined,
      },
      {
        browser: ctx.runtime.ports.browser,
        auth: ctx.runtime.ports.auth,
        log: ctx.log,
      },
    );
    if (report.warnings.length > 0) ctx.warnings.push(...report.warnings);
    if (!report.ok) throw report.failure;
    return report.view;
  },
});
