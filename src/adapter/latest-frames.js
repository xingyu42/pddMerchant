// Each subscriber gets only the newest frame, including after a slow consumer resumes.
export function createLatestFrames() {
  const subscribers = new Set();
  let latest = null;
  let closed = false;
  const timer = setInterval(() => {
    if (latest) for (const subscriber of subscribers) subscriber(latest);
  }, 200);
  timer.unref?.();
  return {
    publish(frame) { if (!closed) latest = frame; },
    subscribe(callback) {
      if (closed) { callback(null); return () => {}; }
      subscribers.add(callback);
      return () => subscribers.delete(callback);
    },
    close() {
      if (closed) return;
      closed = true;
      latest = null;
      clearInterval(timer);
      for (const subscriber of subscribers) subscriber(null);
      subscribers.clear();
    },
    [Symbol.asyncIterator]() { return frameIterator(this); },
  };
}

function frameIterator(frames) {
  let latest = null;
  let ended = false;
  let wake;
  const unsubscribe = frames.subscribe((frame) => {
    latest = frame;
    ended = frame === null;
    wake?.();
  });
  return {
    async next() {
      if (!latest && !ended) await new Promise((resolve) => { wake = resolve; });
      wake = null;
      const value = latest;
      latest = null;
      return { value, done: ended };
    },
    async return() { ended = true; unsubscribe(); wake?.(); return { done: true }; },
    [Symbol.asyncIterator]() { return this; },
  };
}
