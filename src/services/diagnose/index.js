import { summarizeOrders } from './orders-health.js';
import { summarizeInventory } from './inventory-health.js';
import { summarizePromo } from './promo-health.js';
import { summarizeAfterSales } from './after-sales-health.js';

export function diagnoseShop({ orders, goods, promo, after_sales: afterSales } = {}) {
  const dimensions = {
    orders: summarizeOrders(orders ?? {}),
    inventory: summarizeInventory(goods ?? {}),
    promo: summarizePromo(promo ?? {}),
    after_sales: summarizeAfterSales(afterSales ?? {}),
  };

  const issues = [];
  const hints = [];
  for (const [name, dim] of Object.entries(dimensions)) {
    for (const issue of dim.issues ?? []) issues.push({ dimension: name, message: issue });
    for (const hint of dim.hints ?? []) hints.push({ dimension: name, message: hint });
  }

  return {
    status: Object.values(dimensions).every((dim) => dim.status === 'full') ? 'full' : 'partial',
    dimensions,
    issues,
    hints,
  };
}

export {
  summarizeOrders,
  summarizeInventory,
  summarizePromo,
  summarizeAfterSales,
};
