import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { it, vi } from 'vitest';
import sharp from 'sharp';
import { createLatestFrames } from '../../src/adapter/latest-frames.js';
import { FIXTURE_QR_IMAGE, openFixtureTakeover } from '../../src/adapter/console-login-fixture.js';
import { streamFrames } from '../../src/daemon/sse.js';

function response() {
  const output = new EventEmitter();
  output.setHeader = vi.fn();
  output.flushHeaders = vi.fn();
  output.write = vi.fn(() => true);
  output.end = vi.fn(() => output.emit('close'));
  return output;
}

it('drops intermediate frames under SSE backpressure and resumes with only the latest frame', async () => {
  vi.useFakeTimers();
  const frames = createLatestFrames();
  const output = response();
  output.write.mockReturnValueOnce(false);
  streamFrames(frames, output);
  assert.equal(output.statusCode, 200);
  assert.deepEqual(output.setHeader.mock.calls, [['Content-Type', 'text/event-stream'],
    ['Cache-Control', 'no-store'], ['X-Accel-Buffering', 'no']]);
  frames.publish({ jpeg: 'one', width: 10, height: 20 });
  await vi.advanceTimersByTimeAsync(200);
  frames.publish({ jpeg: 'discarded', width: 10, height: 20 });
  await vi.advanceTimersByTimeAsync(1000);
  assert.equal(output.write.mock.calls.length, 1);
  frames.publish({ jpeg: 'latest', width: 10, height: 20 });
  output.emit('drain');
  await vi.advanceTimersByTimeAsync(200);
  assert.equal(output.write.mock.calls.length, 2);
  assert.match(output.write.mock.calls[1][0], /event: frame\ndata: .*latest/);
  frames.close();
  assert.equal(output.end.mock.calls.length, 1);
  assert.equal(output.listenerCount('drain'), 0);
});

it('unsubscribes on client disconnect without ending the shared frame producer', async () => {
  vi.useFakeTimers();
  const frames = createLatestFrames();
  const first = response();
  const second = response();
  streamFrames(frames, first);
  streamFrames(frames, second);
  first.emit('close');
  frames.publish({ jpeg: 'shared', width: 1, height: 1 });
  await vi.advanceTimersByTimeAsync(200);
  assert.equal(first.write.mock.calls.length, 0);
  assert.equal(second.write.mock.calls.length, 1);
  frames.close();
  assert.equal(second.end.mock.calls.length, 1);
});

it('fixture frame and QR are decodable fixed 1x1 images', async () => {
  const takeover = openFixtureTakeover();
  try {
    const iterator = takeover.frames[Symbol.asyncIterator]();
    const { value: frame } = await iterator.next();
    await iterator.return();
    for (const data of [frame.jpeg, FIXTURE_QR_IMAGE.split(',')[1]]) {
      const decoded = await sharp(Buffer.from(data, 'base64')).raw().toBuffer({ resolveWithObject: true });
      assert.equal(decoded.info.width, 1);
      assert.equal(decoded.info.height, 1);
    }
  } finally { takeover.close(); }
});
