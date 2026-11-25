import { createLiveDaemonProcessPort } from '../daemon-process.js';

/** Create a Fixture DaemonProcessPort bound to the caller's resolved sandbox environment. */
export function createFixtureDaemonProcessPort(options = {}) {
  const baseEnv = { ...(options.env ?? process.env), PDD_TEST_ADAPTER: 'fixture' };
  const port = createLiveDaemonProcessPort({ ...options, env: baseEnv });
  return Object.freeze({
    ...port,
    spawnDetached({ env: extraEnv } = {}) {
      return port.spawnDetached({
        env: { ...(extraEnv ?? {}), PDD_TEST_ADAPTER: 'fixture' },
      });
    },
  });
}
