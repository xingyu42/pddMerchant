import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { stripVTControlCharacters } from 'node:util';
import { describe, it } from 'vitest';
import {
  createAccounts, createAfterSalesFixtures, createUpstreamAfterSalesCase, createUpstreamAfterSalesParams,
} from '../fixtures/test-data.js';
import { createCliSandbox, runCli, spawnNode } from '../helpers/isolated-cli.js';
import { DEFAULT_ACCOUNT, seedDb } from '../helpers/seed-db.js';

const command = ['orders', 'after-sales'];

function windowSecond(value) {
  assert.match(value, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  return Date.parse(`${value.replace(' ', 'T')}+08:00`) / 1000;
}

describe('orders after-sales fixture CLI', () => {
  it('reports a 30-day rolling window and reason totals over multiple pages in one JSON line', () => {
    const before = Math.floor(Date.now() / 1000);
    const { status, stdout, envelope } = runCli(command, { fixtures: createAfterSalesFixtures({ count: 103 }) });
    const after = Math.floor(Date.now() / 1000);
    assert.equal(status, 0);
    assert.equal(stdout.trim().split(/\r?\n/).length, 1);
    assert.equal(envelope.command, 'orders.after-sales');
    const { data } = envelope;
    assert.equal(data.window.days, 30);
    const end = windowSecond(data.window.end_at);
    assert.ok(end >= before && end <= after);
    assert.equal(end - windowSecond(data.window.start_at), 30 * 86400);
    assert.deepEqual(data.filters, { sn: null, goods_id: null, status: '全部', type: '全部' });
    assert.equal(data.mall_id, '900001');
    assert.equal(data.total, 103);
    assert.equal(data.fetched_count, 103);
    assert.equal(data.items.length, 103);
    assert.equal(data.items.at(-1).after_sales_id, '123558');
    assert.equal(data.truncated, false);
    assert.deepEqual(data.hints, []);
    assert.deepEqual(data.reason_summary, [{
      reason_desc: '不想要了', reason_category: '七天无理由退货', count: 103, share_pct: 100, refund_amount_yuan: 1831.34,
    }]);
  });

  it.each(['0', '366', '1.5', '-1', 'abc'])('rejects --days %s before authentication', (value) => {
    const { status, envelope } = runCli([...command, '--days', value], { authInvalid: true });
    assert.equal(status, 2);
    assert.equal(envelope.command, 'orders.after-sales');
    assert.equal(envelope.error.code, 'E_USAGE');
    assert.equal(envelope.meta.xhr_count, 0);
  });

  it('reports the requested window even when there are no cases', () => {
    const { envelope } = runCli([...command, '--days', '7'], { fixtures: createAfterSalesFixtures({ count: 0 }) });
    assert.equal(envelope.ok, true);
    const { data } = envelope;
    assert.equal(data.window.days, 7);
    assert.equal(windowSecond(data.window.end_at) - windowSecond(data.window.start_at), 7 * 86400);
    assert.deepEqual(data.headline, ['近 7 天无售后单']);
    assert.equal(data.total, 0);
    assert.equal(data.fetched_count, 0);
    assert.deepEqual(data.items, []);
    assert.deepEqual(data.reason_summary, []);
  });

  it('keeps the platform total when truncating at 2000 and computes shares over collected cases', () => {
    const items = Array.from({ length: 2050 }, (_, id) => ({
      id, afterSalesReasonCode: 88, afterSalesReasonDesc: '不想要了', refundAmount: 1,
    }));
    const { envelope } = runCli(command, { fixtures: createAfterSalesFixtures({ items }) });
    assert.equal(envelope.ok, true);
    const { data } = envelope;
    assert.equal(data.total, 2050);
    assert.equal(data.fetched_count, 2000);
    assert.equal(data.items.length, 2000);
    assert.equal(data.items.at(-1).after_sales_id, '1999');
    assert.equal(data.truncated, true);
    assert.deepEqual(data.reason_summary, [{
      reason_desc: '不想要了', reason_category: '七天无理由退货', count: 2000, share_pct: 100, refund_amount_yuan: 20,
    }]);
    for (const lines of [data.headline, data.hints]) {
      assert.ok(lines.some((line) => /2000 条上限.*已截断.*--since\/--until/.test(line)));
    }
  });

  it('keeps the list and summary available when the reason dictionary fails', () => {
    const { envelope } = runCli(command, {
      fixtures: createAfterSalesFixtures({ params: { __throws: true } }),
    });
    assert.equal(envelope.ok, true);
    assert.equal(envelope.data.items[0].reason_category, null);
    assert.deepEqual(envelope.data.reason_summary, [{
      reason_desc: '不想要了', reason_category: null, count: 1, share_pct: 100, refund_amount_yuan: 17.78,
    }]);
    assert.deepEqual(envelope.data.hints, ['售后参数字典拉取失败，售后原因大类暂不可用']);
  });

  it.each([['E_TIMEOUT', 5], ['E_INTERNAL', 1]])('propagates a dictionary %s', (code, exitCode) => {
    const { status, envelope } = runCli(command, {
      fixtures: createAfterSalesFixtures({ params: { __throws: true, __error: { code, exitCode } } }),
    });
    assert.equal(status, exitCode);
    assert.equal(envelope.error.code, code);
    assert.equal(envelope.data, null);
  });

  it('aggregates shared reason labels, preserves ungrouped codes, and excludes private fields', () => {
    const items = [
      ...[88, 66, 197].map((afterSalesReasonCode) => createUpstreamAfterSalesCase({ afterSalesReasonCode })),
      createUpstreamAfterSalesCase({ afterSalesReasonCode: 405030, afterSalesReasonDesc: '尺码没选对', refundAmount: 100 }),
      ...[81, 95].map((afterSalesReasonCode) => createUpstreamAfterSalesCase({
        afterSalesReasonCode, afterSalesReasonDesc: '其他问题', refundAmount: 500,
      })),
    ];
    const params = { success: true, errorCode: 0, result: createUpstreamAfterSalesParams({
      reasonCodeParams: { 七天无理由退货: [88, 66, 197], 质量问题: [81], 其他原因: [95] },
    }) };
    const { envelope, stdout, stderr } = runCli(command, { fixtures: createAfterSalesFixtures({ items, params }) });
    assert.equal(envelope.ok, true);
    assert.deepEqual(envelope.data.reason_summary, [
      { reason_desc: '不想要了', reason_category: '七天无理由退货', count: 3, share_pct: 50, refund_amount_yuan: 53.34 },
      { reason_desc: '其他问题', reason_category: null, count: 2, share_pct: 33.33, refund_amount_yuan: 10 },
      { reason_desc: '尺码没选对', reason_category: null, count: 1, share_pct: 16.67, refund_amount_yuan: 1 },
    ]);
    const ungrouped = envelope.data.items.find((item) => item.reason_code === 405030);
    assert.equal(ungrouped.reason_desc, '尺码没选对');
    assert.equal(ungrouped.reason_category, null);
    assert.doesNotMatch(stdout + stderr, /SYN-AFTER-SALES-PRIVATE|thumbUrl|mallRemark|uid|returnAddressId|actions|expireActionDesc/);
  });

  it('renders a summary and case table without --json', async () => {
    const sandbox = createCliSandbox(createAfterSalesFixtures());
    try {
      seedDb(sandbox.env.PDD_DB_PATH, {
        accounts: [DEFAULT_ACCOUNT], authStates: [{ slug: DEFAULT_ACCOUNT.slug, state: { cookies: [], origins: [] } }],
      });
      const { status, stdout, error } = await spawnNode([
        '--import', new URL('../helpers/offline-preload.js', import.meta.url).href,
        fileURLToPath(new URL('../../bin/pdd.js', import.meta.url)), ...command,
      ], { env: sandbox.env });
      assert.ifError(error);
      assert.equal(status, 0);
      assert.match(stdout, /^OK +orders\.after-sales/m);
      assert.match(stdout, /近 30 天售后单 1 条，已采集 1 条/);
      assert.match(stdout, /高频售后原因：不想要了 1 条（100%）/);
      const table = stripVTControlCharacters(stdout);
      assert.match(table, /│ after_sales_id .*│ reason_desc /);
      assert.match(table, /│ 123456 /);
      assert.doesNotMatch(stdout, /SYN-AFTER-SALES-PRIVATE/);
    } finally {
      sandbox.dispose();
    }
  });

  it('returns the report for every account in batch mode', () => {
    const { envelope } = runCli([...command, '--all-accounts'], {
      accounts: createAccounts(), fixtures: createAfterSalesFixtures(),
    });
    assert.equal(envelope.ok, true);
    assert.equal(envelope.command, 'orders.after-sales');
    assert.deepEqual(envelope.data.summary, { total_accounts: 2, attempted: 2, succeeded: 2, failed: 0 });
    for (const slug of ['shop-a', 'shop-b']) {
      const result = envelope.data.accounts[slug];
      assert.equal(result.ok, true);
      assert.equal(result.data.fetched_count, 1);
      assert.equal(result.data.items[0].reason_desc, '不想要了');
    }
  });
});
