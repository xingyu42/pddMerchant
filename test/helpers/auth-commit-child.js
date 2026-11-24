import { composeCommandRuntime } from '../../src/runtime/command-runtime.js';
import { withMerchantAuthUpdate, commitMerchantCandidate } from '../../src/adapter/merchant-auth-storage.js';
import { getAuthStateRevision } from '../../src/adapter/auth-state.js';
import { closeDatabase } from '../../src/infra/db.js';

const accountId = Number(process.argv[2]);
const revision = getAuthStateRevision(accountId);
const runtime = await composeCommandRuntime({
  mode: 'fixture',
  runtimeConfigPolicy: 'maintenance',
});
const result = await runtime.ports.auth.verifyAndSeal(null, { seal: runtime.seal });
process.once('message', async () => {
  try {
    await withMerchantAuthUpdate(
      accountId,
      (tx) => commitMerchantCandidate(result.candidate, tx, { expectedRevision: revision, seal: runtime.seal }),
      { seal: runtime.seal },
    );
    process.send({ code: 'OK' });
  } catch (error) {
    process.send({ code: error.code ?? 'E_GENERAL' });
  } finally {
    await runtime.closeAll();
    closeDatabase();
    process.disconnect();
  }
});
process.send({ ready: true });
