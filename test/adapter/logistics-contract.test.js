import { describe, it, vi } from 'vitest';
import assert from 'node:assert/strict';
import {
  ORDER_FORWARD_TRACK,
  AFTER_SALES_REVERSE_TRACK,
} from '../../src/adapter/endpoints/logistics.js';
import { interpretResponse } from '../../src/adapter/response-interpreter.js';
import { ExitCodes } from '../../src/infra/errors.js';
import { buildEnvelope } from '../../src/infra/output.js';
import { createUpstreamForwardTrack, createUpstreamReverseTrack } from '../fixtures/test-data.js';

const LOGISTICS_SPECS = [ORDER_FORWARD_TRACK, AFTER_SALES_REVERSE_TRACK];
const RAW_WITH_PII = {
  success: false,
  error_code: 54001,
  error_msg: '操作太过频繁',
  result: {
    orderSn: 'SYN-SECRET-ORDER',
    waybillList: [{ shippingPhone: '13812345678' }],
    traceList: [{ time: '2026-11-20 15:00:00', info: '已由张三签收，地址阳光小区3号楼，取件码889900' }],
  },
};

function captureError(spec, raw, expected, status = 200) {
  let caught;
  assert.throws(() => interpretResponse(spec, { status, raw, response: { status: () => status } }), (error) => {
    caught = error;
    for (const [key, value] of Object.entries(expected)) assert.equal(error[key], value);
    return true;
  });
  return caught;
}

function captureDebugRaw(error) {
  vi.stubEnv('PDD_DEBUG_RAW', '1');
  const write = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
  try {
    buildEnvelope({ ok: false, command: 'orders.detail', data: null, error, meta: {} });
    const output = write.mock.calls.map(([chunk]) => String(chunk)).join('');
    assert.equal(JSON.parse(output).type, 'raw_debug');
    return output;
  } finally {
    write.mockRestore();
  }
}

function assertNoLeaks(output, sensitiveValues) {
  for (const value of sensitiveValues) assert.equal(output.includes(value), false, `leaked: ${value}`);
}

describe('logistics endpoint contracts', () => {
  it('ORDER_FORWARD_TRACK builds payload, whitelists fields, rejects missing result, and strips PII', () => {
    assert.equal(ORDER_FORWARD_TRACK.method, 'POST');
    assert.equal(ORDER_FORWARD_TRACK.fixtureVariantKey, 'orderSn');
    assert.deepEqual(ORDER_FORWARD_TRACK.buildPayload({ orderSn: ' 261120-001 ' }), {
      orderSn: '261120-001',
      source: 'mms_order_detail',
      filterInvalidDefaultTrace: true,
    });

    const normalized = ORDER_FORWARD_TRACK.normalize(createUpstreamForwardTrack());
    assert.equal(normalized.available, true);
    assert.equal(normalized.orderSn, 'SYN-ORDER-TRACK-1');
    assert.equal(Object.hasOwn(normalized.waybills[0], 'shippingPhone'), false);
    assert.equal(Object.hasOwn(normalized.traces[0], 'postman_contact'), false);
    assertNoLeaks(JSON.stringify(normalized), ['SYN-SHIPPING-PHONE']);

    assert.deepEqual(ORDER_FORWARD_TRACK.normalize({ success: true, error_code: '成功', result: null }), {
      available: false,
      orderSn: null,
      wideGotTime: null,
      waybills: [],
      traces: [],
    });

    assert.throws(() => ORDER_FORWARD_TRACK.normalize({ success: true, error_code: '成功' }), { code: 'E_NETWORK' });
    assert.throws(() => ORDER_FORWARD_TRACK.normalize({ success: true, result: { traceList: 'bad' } }), { code: 'E_NETWORK' });
  });

  it('AFTER_SALES_REVERSE_TRACK resolves GET url dynamically, rejects missing result, and strips PII', () => {
    assert.equal(AFTER_SALES_REVERSE_TRACK.method, 'GET');
    assert.equal(AFTER_SALES_REVERSE_TRACK.fixtureVariantKey, 'trackingNumber');
    assert.equal(AFTER_SALES_REVERSE_TRACK.buildPayload(), null);
    assert.equal(
      AFTER_SALES_REVERSE_TRACK.apiUrl({ shippingId: 85, trackingNumber: 'YT 123/A' }),
      '/express_base/mms/track/sale_back?shippingId=85&trackingNumber=YT+123%2FA',
    );
    assert.throws(() => AFTER_SALES_REVERSE_TRACK.apiUrl({ trackingNumber: 'YT123' }), { code: 'E_USAGE' });
    assert.throws(() => AFTER_SALES_REVERSE_TRACK.apiUrl({ shippingId: 85 }), { code: 'E_USAGE' });

    const normalized = AFTER_SALES_REVERSE_TRACK.normalize(createUpstreamReverseTrack());
    assert.equal(normalized.available, true);
    assert.equal(normalized.shippingId, 85);
    assert.equal(normalized.shippingName, '中通快递');
    assert.equal(normalized.trackingNumber, 'SYN-REV-TN-1');
    assert.equal(normalized.traces.length, 3);
    assert.equal(Object.hasOwn(normalized.traces[0], 'postman_name'), false);
    assert.equal(Object.hasOwn(normalized.traces[0], 'postman_contact'), false);
    assertNoLeaks(JSON.stringify(normalized), ['SYN-POSTMAN-NAME', 'SYN-POSTMAN-PHONE']);

    assert.throws(() => AFTER_SALES_REVERSE_TRACK.normalize({ success: true, error_code: '0' }), { code: 'E_NETWORK' });
    assert.equal(AFTER_SALES_REVERSE_TRACK.normalize({ success: true, error_code: '0', result: null }).available, false);
  });

  it('uses consistent trace-key precedence between redactRaw and normalize', () => {
    const conflictingReverse = {
      success: true,
      result: {
        traces: [{ time: '2026-11-23 15:00:00', info: 'primary' }],
        trace_list: [{ time: '2026-11-22 15:00:00', info: 'a' }, { time: '2026-11-22 16:00:00', info: 'b' }],
        traceList: [
          { time: '2026-11-21 15:00:00', info: 'x' },
          { time: '2026-11-21 16:00:00', info: 'y' },
          { time: '2026-11-21 17:00:00', info: 'z' },
        ],
      },
    };
    assert.equal(AFTER_SALES_REVERSE_TRACK.redactRaw(conflictingReverse).trace_count, 1);
    assert.equal(AFTER_SALES_REVERSE_TRACK.normalize(conflictingReverse).traces.length, 1);
    assert.equal(
      AFTER_SALES_REVERSE_TRACK.redactRaw({ result: { traceList: [{ info: 'x' }, { info: 'y' }] } }).trace_count,
      2,
    );
    assert.equal(
      ORDER_FORWARD_TRACK.redactRaw({ result: { traces: [{ info: 'ignored' }] } }).trace_count,
      undefined,
    );
  });

  it('retains only boolean success, result_present, and trace_count from raw responses', () => {
    assert.deepEqual(ORDER_FORWARD_TRACK.redactRaw(RAW_WITH_PII), {
      success: false,
      result_present: true,
      trace_count: 1,
    });
    assert.deepEqual(
      ORDER_FORWARD_TRACK.redactRaw({
        success: '收件人张三13812345678',
        error_code: 54001,
        errorCode: '13812345678',
        error_msg: '地址阳光小区3号楼取件码956025',
        errorMsg: '收件人张三',
        result: null,
      }),
      {
        result_present: false,
      },
    );
  });

  it('redacts both rate-limit detail and debug output', () => {
    const err = captureError(ORDER_FORWARD_TRACK, RAW_WITH_PII, { code: 'E_RATE_LIMIT' });
    const sensitive = ['张三', '阳光小区', '889900', '13812345678', 'SYN-SECRET-ORDER'];
    assertNoLeaks(JSON.stringify(err.detail), sensitive);
    assertNoLeaks(captureDebugRaw(err), sensitive);
  });

  it.each([
    [ORDER_FORWARD_TRACK, {
      success: '非布尔敏感值李四',
      error_code: 50001,
      error_msg: '收件人张三13812345678在阳光小区取件码956025',
      result: { traceList: [{ time: '2026-11-20 15:00:00', info: '李四签收' }] },
    }, undefined, ['张三', '李四', '13812345678', '阳光小区', '956025', '非布尔敏感值', '50001']],
    [AFTER_SALES_REVERSE_TRACK, {
      success: false,
      errorCode: '40002',
      errorMsg: '逆向单由王五在某绿洲签收13987654321',
      result: null,
    }, 'high-frequency-or-risk-control', ['王五', '某绿洲', '13987654321', '40002']],
    [ORDER_FORWARD_TRACK, {
      success: false,
      errorCode: 956025,
      errorMsg: '敏感手机号与ASCII错误码USER_ZHANGSAN_138',
      result: null,
    }, undefined, ['956025', 'USER_ZHANGSAN_138']],
  ])('redacts business error text, errorCode, and non-boolean success (row %#)', (spec, raw, classification, sensitive) => {
    const err = captureError(spec, raw, {
      code: 'E_BUSINESS',
      exitCode: ExitCodes.BUSINESS,
      message: `${spec.name}: 平台返回业务错误`,
    });
    assert.equal(err.detail.errorCode, undefined);
    assert.equal(err.detail.classification, classification);
    assertNoLeaks(JSON.stringify({ message: err.message, hint: err.hint, detail: err.detail }), sensitive);
    assertNoLeaks(captureDebugRaw(err), sensitive);
  });

  it('treats HTTP 503 without a non-success code as network failure', () => {
    const rawBodies = [
      null, {},
      { success: false, errorCode: null, errorMsg: '' },
      { success: false, errorCode: null, errorMsg: 'Service Unavailable' },
      { success: false, errorCode: '  ', errorMsg: 'Service Unavailable' },
      ...[0, 1000000, '0', ' 1000000 ', '成功'].map((error_code) => ({ success: true, error_code })),
    ];
    for (const spec of LOGISTICS_SPECS) {
      for (const raw of rawBodies) {
        const err = captureError(spec, raw, { code: 'E_NETWORK', exitCode: ExitCodes.NETWORK }, 503);
        assertNoLeaks(err.message, ['Service Unavailable']);
      }
    }
  });

  it.each([400, 503])('maps a failure code with numeric HTTP %i status to fixed E_BUSINESS', (status) => {
    const raw = { success: false, error_code: '50001', errorMsg: '原始错误' };
    assert.throws(
      () => interpretResponse(ORDER_FORWARD_TRACK, { status, response: { status }, raw }),
      { code: 'E_BUSINESS', exitCode: ExitCodes.BUSINESS, message: 'logistics.forwardTrack: 平台返回业务错误' },
    );
  });

  it('accepts string success code on HTTP 200 and still validates result', () => {
    for (const spec of LOGISTICS_SPECS) {
      const raw = { success: true, error_code: '0' };
      assert.equal(spec.errorMapper(raw), null);
      captureError(spec, raw, { code: 'E_NETWORK', exitCode: ExitCodes.NETWORK });
      const normalized = interpretResponse(spec, { status: 200, raw: { ...raw, result: null } });
      assert.equal(normalized.available, false);
    }
  });
});
