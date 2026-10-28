export function streamFrames(frames, response) {
  response.statusCode = 200;
  response.setHeader('Content-Type', 'text/event-stream');
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Accel-Buffering', 'no');
  response.flushHeaders();
  let writable = true;
  let latest = null;
  const flush = () => {
    if (!latest || !writable || response.destroyed) return;
    const frame = latest;
    latest = null;
    writable = response.write(`event: frame\ndata: ${JSON.stringify(frame)}\n\n`);
  };
  const onDrain = () => { writable = true; flush(); };
  const unsubscribe = frames.subscribe((frame) => {
    if (frame === null) { response.end(); return; }
    latest = frame;
    flush();
  });
  response.on('drain', onDrain);
  response.once('close', () => { unsubscribe(); response.removeListener('drain', onDrain); });
}
