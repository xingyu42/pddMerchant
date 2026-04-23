// Zero-dep property-based testing harness.
// PRNG: mulberry32（32-bit state，确定性、可复现）
// Usage: see test/pbt/README.md

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function getSeed() {
  const fromEnv = Number.parseInt(process.env.PBT_SEED ?? '', 10);
  return Number.isFinite(fromEnv) ? fromEnv : 42;
}

export function getRuns() {
  const fromEnv = Number.parseInt(process.env.PBT_RUNS ?? '', 10);
  return Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : 100;
}

export const gen = {
  int(min, max) {
    return (rng) => Math.floor(rng() * (max - min + 1)) + min;
  },
  float(min, max) {
    return (rng) => rng() * (max - min) + min;
  },
  bool() {
    return (rng) => rng() < 0.5;
  },
  oneOf(items) {
    if (!Array.isArray(items) || items.length === 0) {
      throw new Error('gen.oneOf: items must be a non-empty array');
    }
    return (rng) => items[Math.floor(rng() * items.length)];
  },
  constant(value) {
    return () => value;
  },
  arrayOf(itemGen, { minLen = 0, maxLen = 10 } = {}) {
    return (rng) => {
      const len = Math.floor(rng() * (maxLen - minLen + 1)) + minLen;
      const out = new Array(len);
      for (let i = 0; i < len; i += 1) out[i] = itemGen(rng);
      return out;
    };
  },
  record(shape) {
    const entries = Object.entries(shape);
    return (rng) => {
      const out = {};
      for (const [key, g] of entries) out[key] = g(rng);
      return out;
    };
  },
  tuple(...gens) {
    return (rng) => gens.map((g) => g(rng));
  },
  string({ minLen = 0, maxLen = 10, chars = 'abcdefghijklmnopqrstuvwxyz0123456789' } = {}) {
    return (rng) => {
      const len = Math.floor(rng() * (maxLen - minLen + 1)) + minLen;
      let s = '';
      for (let i = 0; i < len; i += 1) s += chars[Math.floor(rng() * chars.length)];
      return s;
    };
  },
};

// Fisher-Yates with rng; returns new array.
export function shuffle(rng, arr) {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// Run `predicate` on `runs` samples from `generator`.
// predicate returning false OR throwing → counterexample.
export async function property(name, generator, predicate, { runs = getRuns(), seed = getSeed() } = {}) {
  const rng = mulberry32(seed);
  for (let i = 0; i < runs; i += 1) {
    const sample = generator(rng);
    let result;
    try {
      result = await predicate(sample, { rng, run: i, seed });
    } catch (err) {
      throw new Error(
        `Property "${name}" threw at run ${i + 1}/${runs} (seed=${seed}): ${err?.message ?? err}\nSample: ${safeStringify(sample)}`,
      );
    }
    if (result === false) {
      throw new Error(
        `Property "${name}" falsified at run ${i + 1}/${runs} (seed=${seed}).\nSample: ${safeStringify(sample)}`,
      );
    }
  }
}

function safeStringify(value) {
  try {
    return JSON.stringify(value, (_, v) => (typeof v === 'bigint' ? v.toString() : v));
  } catch {
    return String(value);
  }
}

export { mulberry32 };
