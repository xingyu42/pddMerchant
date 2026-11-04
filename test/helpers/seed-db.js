import { openDatabase, closeDatabase, run, transaction, getDatabasePath } from '../../src/infra/db.js';
import { saveAuthStateSnapshot } from '../../src/adapter/auth-state.js';
import { getMasterKey } from '../../src/infra/master-key.js';
import { savePasswordCredential } from '../../src/adapter/password-credential.js';
import { putReloginState } from '../../src/infra/account-store.js';

export const DEFAULT_ACCOUNT = Object.freeze({ slug: 'synthetic-shop', display_name: 'Synthetic Shop', identity: '900001', is_default: 1 });

export function seedDb(dbPath, { accounts = [], authStates = [], passwordCredentials = [], reloginStates = [] } = {}) {
  const previous = process.env.PDD_DB_PATH ? getDatabasePath() : null;
  openDatabase(dbPath);
  try {
    if (authStates.length > 0 || passwordCredentials.length > 0) getMasterKey();
    transaction(() => {
      const ids = new Map();
      for (const account of accounts) {
        const now = new Date().toISOString();
        const result = run(`INSERT INTO accounts(kind, slug, display_name, identity, is_default,
          created_at, updated_at, last_login_at, last_used_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        account.kind ?? 'merchant', account.slug, account.display_name ?? account.slug, String(account.identity),
        Number(account.is_default ?? false), account.created_at ?? now,
        account.updated_at ?? now, account.last_login_at ?? null, account.last_used_at ?? null);
        ids.set(account.slug, Number(result.lastInsertRowid));
      }
      for (const entry of authStates) {
        saveAuthStateSnapshot(entry.state, entry.accountId ?? ids.get(entry.slug));
      }
      for (const entry of passwordCredentials) {
        savePasswordCredential(entry.accountId ?? ids.get(entry.slug), entry);
      }
      for (const entry of reloginStates) {
        putReloginState(entry.accountId ?? ids.get(entry.slug), entry);
      }
    });
  } finally {
    closeDatabase();
    if (previous) openDatabase(previous);
  }
}
