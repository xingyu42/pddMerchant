import { verifyMerchantContext } from '../../src/adapter/merchant-auth.js';
import { withMerchantAuthUpdate, commitMerchantCandidate } from '../../src/adapter/merchant-auth-storage.js';
import { getAuthStateRevision } from '../../src/adapter/auth-state.js';
import { closeDatabase } from '../../src/infra/db.js';

const accountId = Number(process.argv[2]);
const revision = getAuthStateRevision(accountId);
const result = await verifyMerchantContext(null);
process.once('message', async () => {
  try {
    await withMerchantAuthUpdate(accountId, (tx) => commitMerchantCandidate(result.candidate, tx, { expectedRevision: revision }));
    process.send({ code: 'OK' });
  } catch (error) {
    process.send({ code: error.code ?? 'E_GENERAL' });
  } finally {
    closeDatabase();
    process.disconnect();
  }
});
process.send({ ready: true });
