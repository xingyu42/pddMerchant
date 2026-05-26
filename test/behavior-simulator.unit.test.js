import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { naturalScroll, pickTargetElements, simulateHumanBrowsing } from '../src/adapter/behavior-simulator.js';

function makeFakePage(opts = {}) {
  const locatorMap = opts.locatorMap ?? {};
  const wheelCalls = [];
  const timeouts = [];

  return {
    locator(sel) {
      const els = locatorMap[sel] ?? [];
      return {
        all: async () => els.map(e => ({
          isVisible: async () => e.visible ?? true,
        })),
        first() {
          return {
            isVisible: async () => (els[0]?.visible ?? false),
          };
        },
      };
    },
    mouse: {
      wheel: async (x, y) => { wheelCalls.push({ x, y }); },
      move: async () => {},
      click: async () => {},
    },
    on() {},
    evaluate: async () => JSON.stringify({ x: 100, y: 100 }),
    waitForTimeout: async (ms) => { timeouts.push(ms); },
    _wheelCalls: wheelCalls,
    _timeouts: timeouts,
  };
}

function seededRandom(seed) {
  let s = seed;
  return () => {
    s = (s * 16807 + 0) % 2147483647;
    return s / 2147483647;
  };
}

describe('pickTargetElements', () => {
  it('returns visible elements up to count', async () => {
    const page = makeFakePage({
      locatorMap: {
        'img[src*="goods"]': [{ visible: true }, { visible: true }, { visible: false }],
        '[class*="sku"]': [{ visible: true }],
      },
    });
    const targets = await pickTargetElements(page, 3);
    assert.equal(targets.length, 3);
  });

  it('returns empty array when no elements', async () => {
    const page = makeFakePage();
    const targets = await pickTargetElements(page, 3);
    assert.equal(targets.length, 0);
  });
});

describe('naturalScroll', () => {
  it('scrolls the specified number of segments', async () => {
    const page = makeFakePage();
    const random = seededRandom(42);
    await naturalScroll(page, { segments: 3, random });
    assert.equal(page._wheelCalls.length, 3);
  });

  it('adds a pause between segments', async () => {
    const page = makeFakePage();
    const random = seededRandom(42);
    await naturalScroll(page, { segments: 2, random });
    assert.equal(page._timeouts.length, 2);
    for (const t of page._timeouts) {
      assert.ok(t >= 300 && t <= 1200, `pause ${t} not in [300, 1200]`);
    }
  });

  it('returns total scroll pixels', async () => {
    const page = makeFakePage();
    const random = seededRandom(99);
    const px = await naturalScroll(page, { segments: 2, range: [200, 500], random });
    assert.equal(typeof px, 'number');
  });
});

describe('simulateHumanBrowsing', () => {
  it('runs with ghost-cursor and scrolls', async () => {
    const page = makeFakePage({
      locatorMap: {
        'img[src*="goods"]': [{ visible: true }],
      },
    });
    const result = await simulateHumanBrowsing(page, {
      moveCount: 1,
      scrollSegments: 1,
      dwellMs: [100, 200],
      random: seededRandom(42),
    });
    assert.ok(result.cursor !== null, 'cursor should be created');
    assert.ok(result.dwellMs >= 100 && result.dwellMs <= 200);
  });
});
