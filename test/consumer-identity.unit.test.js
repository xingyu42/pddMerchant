import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import {
  CONSUMER_IDENTITY_PATH,
  createConsumerIdentityObserver,
  normalizeConsumerIdentity,
} from '../src/adapter/consumer-identity.js';

class FakePage extends EventEmitter {}

function response(payload, { status = 200, path = CONSUMER_IDENTITY_PATH } = {}) {
  return {
    url: () => `https://mobile.yangkeduo.com${path}`,
    status: () => status,
    json: async () => payload,
  };
}

describe('consumer identity', () => {
  it('normalizes uid and nickname without exposing unrelated fields', () => {
    assert.deepEqual(normalizeConsumerIdentity({ uid: 123, nickname: ' 用户A ', avatar: 'secret' }), {
      uid: '123',
      nickname: '用户A',
    });
  });

  it('captures the verified user/me response', async () => {
    const page = new FakePage();
    const observer = createConsumerIdentityObserver(page);
    page.emit('response', response({ uid: 7, nickname: '昵称' }));
    assert.deepEqual(await observer.wait({ timeoutMs: 100 }), { uid: '7', nickname: '昵称' });
    observer.dispose();
  });

  it('rejects a user/me payload without nickname', async () => {
    const page = new FakePage();
    const observer = createConsumerIdentityObserver(page);
    page.emit('response', response({ uid: 7 }));
    await assert.rejects(observer.wait({ timeoutMs: 100 }), (error) => error.code === 'E_CONSUMER_IDENTITY_UNAVAILABLE');
    observer.dispose();
  });
});
