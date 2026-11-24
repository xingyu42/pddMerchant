import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { ExitCodes } from '../../src/infra/errors.js';
import { ORDER_TRACK_REPORT } from '../../src/services/views/logistics.js';
import { createOrderTrackFixtures, createUpstreamOrderDetail } from '../fixtures/test-data.js';
import { runCliAsync } from '../helpers/isolated-cli.js';

describe('pdd orders detail --with-track e2e', () => {
  it('returns order detail, after-sales cases, forward + reverse milestones, day deltas, and redacted summaries', async () => {
    const { envelope, status } = await runCliAsync(['orders', 'detail', '--sn', 'SYN-ORDER-TRACK-1', '--with-track'], {
      fixtures: createOrderTrackFixtures(),
    });
    assert.equal(status, ExitCodes.OK);
    assert.equal(envelope.ok, true);
    assert.equal(envelope.command, 'orders.detail');
    assert.equal(envelope.meta.xhr_count, 5);
    assert.equal(envelope.data.headline.length, 4);
    assert.equal(envelope.data.order.order_sn, 'SYN-ORDER-TRACK-1');
    assert.equal(envelope.data.after_sales_cases.length, 1);
    assert.equal(envelope.data.track.forward.shipping_id, '85');
    assert.equal(envelope.data.track.forward.delivered_at, '2026-11-20 15:00:00');
    assert.equal(envelope.data.track.forward.delivery_event, '已入柜/驿站待取');
    assert.equal(envelope.data.track.forward.transit_days, 2);
    assert.equal(envelope.data.track.returns.length, 1);
    assert.equal(envelope.data.track.returns[0].reverse_shipping_id, '85');
    assert.equal(envelope.data.track.returns[0].status, '待商家收货');
    assert.equal(envelope.data.track.returns[0].type, '退货退款');
    assert.equal(envelope.data.track.returns[0].delivery_to_apply_days, 1);
    assert.equal(envelope.data.track.returns[0].apply_to_return_arrived_days, 2);
    assert.equal(envelope.data.track.returns[0].delivery_to_return_arrived_days, 3);

    const serialized = JSON.stringify(envelope);
    for (const leaked of ['张三', '李四', '王五', '13812345678', '13987654321', '13700001111', '95554', 'SYN-SHIPPING-PHONE', 'SYN-POSTMAN-NAME', 'SYN-POSTMAN-PHONE', '998877', 'https://', '阳光小区']) {
      assert.equal(serialized.includes(leaked), false, `leaked: ${leaked}`);
    }
    assert.equal(envelope.data.track.forward.traces[0].summary, '快件已揽收');
    assert.equal(envelope.data.track.forward.traces[3].summary, '快件已签收');
  });

  it('handles normal order with empty forward track cleanly and rejects blank --sn with orders.detail command', async () => {
    const emptyRes = await runCliAsync(['orders', 'detail', '--sn', 'SYN-ORDER-EMPTY', '--with-track'], {
      fixtures: {
        'endpoints/orders.detail.json': {
          success: true,
          result: createUpstreamOrderDetail({
            order_sn: 'SYN-ORDER-EMPTY',
            after_sales_id: null,
            after_sales_status: '无售后',
            after_sales_status_code: null,
          }),
        },
        'endpoints/logistics.forwardTrack.json': { success: true, error_code: '成功', result: null },
      },
    });
    assert.equal(emptyRes.status, ExitCodes.OK);
    assert.equal(emptyRes.envelope.meta.xhr_count, 2);
    assert.equal(emptyRes.envelope.data.headline.length, 3);
    assert.deepEqual(emptyRes.envelope.data.after_sales_cases, []);
    assert.equal(emptyRes.envelope.data.track.forward.available, false);
    assert.deepEqual(emptyRes.envelope.data.track.returns, []);
    assert.deepEqual(emptyRes.envelope.data.hints, [ORDER_TRACK_REPORT.hints.forward_unavailable]);

    const badRes = await runCliAsync(['orders', 'detail', '--sn', '   ', '--with-track'], {});
    assert.equal(badRes.status, ExitCodes.USAGE);
    assert.equal(badRes.envelope.ok, false);
    assert.equal(badRes.envelope.command, 'orders.detail');
    assert.equal(badRes.envelope.error.code, 'E_USAGE');
  });
});
