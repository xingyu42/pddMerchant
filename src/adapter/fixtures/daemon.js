import { createLiveDaemonProcessPort } from '../daemon-process.js';

/** Create a Fixture DaemonProcessPort bound to the caller's resolved sandbox environment. */
export function createFixtureDaemonProcessPort(options = {}) {
  return createLiveDaemonProcessPort(options);
}
