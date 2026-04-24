export function createFakeClock(startMs = 0) {
  let now = startMs;
  return {
    now: () => now,
    advance: (ms) => { now += ms; },
    set: (ms) => { now = ms; },
    sleep: (ms) => {
      now += ms;
      return Promise.resolve();
    },
  };
}
