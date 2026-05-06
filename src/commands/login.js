import { runInteractiveLogin } from './init.js';
import { loginWithPassword } from '../adapter/password-login.js';
import { resolveAccountContext } from '../infra/account-resolver.js';
import { emit } from '../infra/output.js';
import { errorToEnvelope } from '../infra/errors.js';
import { getLogger } from '../infra/logger.js';
import { createInterface } from 'node:readline';

export async function run(options = {}) {
  if (options.password) {
    return runPasswordLogin(options);
  }

  const authStatePath = await resolveAuthPath(options);
  return runInteractiveLogin({ ...options, command: 'login', authStatePath });
}

export async function resolveAuthPath(opts) {
  if (opts.authStatePath) return opts.authStatePath;
  const ctx = await resolveAccountContext(opts.account ? { account: opts.account } : {});
  return ctx.authPath;
}

async function runPasswordLogin(opts) {
  const startedAt = Date.now();
  const log = getLogger();

  try {
    const authPath = await resolveAuthPath(opts);
    const rl = createInterface({ input: process.stdin, output: process.stderr });
    const mobile = await new Promise((r) => rl.question('手机号: ', r));
    const password = await new Promise((r) => rl.question('密码: ', r));
    rl.close();

    const result = await loginWithPassword({
      mobile,
      password,
      authStatePath: authPath,
      headed: opts.headed,
      log,
    });

    const envelope = {
      ok: true,
      command: 'login',
      data: result,
      meta: { latency_ms: Date.now() - startedAt, warnings: [] },
    };
    emit(envelope, { json: opts.json, noColor: opts.noColor });
    return envelope;
  } catch (err) {
    const envelope = errorToEnvelope('login', err, { latency_ms: Date.now() - startedAt });
    emit(envelope, { json: opts.json, noColor: opts.noColor });
    return envelope;
  }
}

export default run;
