import { withCommand } from '../_runner.js';
import { getShopListView } from '../../services/shops.js';

export const run = withCommand({
  name: 'shops.list',
  needsAuth: true,
  needsMall: 'current',
  async run(ctx) {
    return getShopListView(ctx);
  },
});

export default run;
