import { lognormalSample } from '../infra/random-utils.js';

function randomBetween(lo, hi, random = Math.random) {
  return lo + Math.floor(random() * (hi - lo + 1));
}

export async function pickTargetElements(page, count = 3) {
  const priorities = [
    'img[src*="goods"]',
    '[class*="sku"]',
    '[class*="price"]',
    'div:not([onclick])',
  ];

  const targets = [];
  for (const sel of priorities) {
    if (targets.length >= count) break;
    try {
      const els = await page.locator(sel).all();
      for (const el of els) {
        if (targets.length >= count) break;
        const visible = await el.isVisible().catch(() => false);
        if (visible) targets.push(el);
      }
    } catch { /* selector not found */ }
  }
  return targets;
}

export async function naturalScroll(page, opts = {}) {
  const segments = opts.segments ?? 2;
  const range = opts.range ?? [200, 500];
  const random = opts.random ?? Math.random;
  let totalPx = 0;

  for (let i = 0; i < segments; i++) {
    const amount = Math.round(lognormalSample(Math.log(300), 0.4, random));
    const px = Math.min(Math.max(amount, range[0]), range[1]);

    const reverse = random() < 0.12;
    const delta = reverse ? -Math.round(px * 0.3) : px;

    await page.mouse.wheel(0, delta);
    totalPx += delta;

    const pause = randomBetween(300, 1200, random);
    await page.waitForTimeout(pause);
  }
  return totalPx;
}

export async function simulateHumanBrowsing(page, opts = {}) {
  let createCursor;
  try {
    const mod = await import('ghost-cursor-playwright');
    createCursor = mod.createCursor;
  } catch {
    return { cursor: null, moves: 0, scrollPx: 0, dwellMs: 0 };
  }

  let cursor;
  try {
    cursor = createCursor(page);
  } catch {
    return { cursor: null, moves: 0, scrollPx: 0, dwellMs: 0 };
  }
  const moveCount = opts.moveCount ?? 3;
  const noClick = opts.noClick ?? false;
  const random = opts.random ?? Math.random;

  const targets = await pickTargetElements(page, moveCount);
  let moves = 0;

  for (const target of targets) {
    try {
      await cursor.actions.move(target, {
        paddingPercentage: 15,
        waitBeforeMove: [100, 500],
      });
      moves++;

      if (!noClick && random() < 0.3) {
        await cursor.actions.click({
          target,
          waitBeforeClick: [200, 800],
        });
      }
    } catch { /* element gone */ }
  }

  const scrollPx = await naturalScroll(page, {
    segments: opts.scrollSegments ?? 2,
    range: opts.scrollRange ?? [200, 500],
    random,
  });

  const dwellMs = randomBetween(opts.dwellMs?.[0] ?? 800, opts.dwellMs?.[1] ?? 2000, random);
  await page.waitForTimeout(dwellMs);

  return { cursor, moves, scrollPx, dwellMs };
}
