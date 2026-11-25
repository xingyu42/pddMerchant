import { withCommand } from './_runner.js';
import {
  setConfigValue,
  showConfig,
  unsetConfigValue,
  validateConfig,
} from '../services/config.js';

export const show = withCommand({
  name: 'config.show',
  lifecycle: 'maintenance',
  run: (ctx) => showConfig(ctx.configOptions),
});

export const validate = withCommand({
  name: 'config.validate',
  lifecycle: 'maintenance',
  run: (ctx) => validateConfig(ctx.configOptions),
});

export const set = withCommand({
  name: 'config.set',
  lifecycle: 'maintenance',
  run(ctx) {
    const [key, value] = ctx.config.args ?? [];
    return setConfigValue(key, value, ctx.configOptions);
  },
});

export const unset = withCommand({
  name: 'config.unset',
  lifecycle: 'maintenance',
  run(ctx) {
    const [key] = ctx.config.args ?? [];
    return unsetConfigValue(key, ctx.configOptions);
  },
});
