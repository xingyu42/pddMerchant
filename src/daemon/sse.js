export function streamFrames(frames, response) {
  response.statusCode = 200;
  response.setHeader('Content-Type', 'text/event-stream');
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Accel-Buffering', 'no');
  response.flushHeaders();
  let writable = true;
  const onDrain = () => { writable = true; };
  const unsubscribe = frames.subscribe((frame) => {
    if (frame === null) { response.end(); return; }
    if (writable && !response.destroyed) writable = response.write(`event: frame\ndata: ${JSON.stringify(frame)}\n\n`);
  });
  response.on('drain', onDrain);
  response.once('close', () => { unsubscribe(); response.removeListener('drain', onDrain); });
}
