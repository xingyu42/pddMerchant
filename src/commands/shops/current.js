import { withCommand } from '../_runner.js';
import { getCurrentShopView } from '../../services/shops.js';

export const run = withCommand({
  name: 'shops.current',
  needsAuth: true,
  needsMall: 'current',
  async run(ctx) {
    return getCurrentShopView(ctx);
  },
});

export default run;
