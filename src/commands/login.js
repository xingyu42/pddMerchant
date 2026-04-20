import { runInteractiveLogin } from './init.js';

export async function run(options = {}) {
  return runInteractiveLogin({ ...options, command: 'login' });
}

export default run;
