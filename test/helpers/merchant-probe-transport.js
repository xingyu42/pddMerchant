import { EventEmitter } from 'node:events';
import https from 'node:https';
import { vi } from 'vitest';

// 伪造商家协议三端点（checkLogin / querySimpleCredential / queryMallAuditInfo）的 200 响应。
// options 可为对象，或每次请求时求值的函数（便于测试中途切换控制量）。
export function mockMerchantProbeTransport(options = {}) {
  return vi.spyOn(https, 'request').mockImplementation((url, _options, callback) => {
    const request = new EventEmitter();
    request.destroy = () => {};
    request.end = () => queueMicrotask(() => {
      const {
        mallId = 900001, mallName = 'Synthetic Shop', login = true, malformed = false,
      } = typeof options === 'function' ? options() : options;
      const response = new EventEmitter();
      response.statusCode = 200;
      response.destroy = () => {};
      callback(response);
      const body = malformed ? { success: true }
        : url.includes('checkLogin') ? { success: true, result: { login } }
          : url.includes('querySimpleCredential') ? { success: true, result: { merchantMainSimpleVO: { mallId, mallName } } }
            : { success: true, result: { auditInfoVOList: [] } };
      response.emit('data', Buffer.from(JSON.stringify(body)));
      response.emit('end');
    });
    return request;
  });
}
