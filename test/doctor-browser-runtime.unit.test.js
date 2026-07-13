import { describe, expect, it, vi } from 'vitest';

const browserMock = vi.hoisted(() => ({ executablePath: process.execPath }));

vi.mock('../src/adapter/browser.js', async (importOriginal) => ({
  ...(await importOriginal()),
  getBrowserExecutablePath: vi.fn(() => browserMock.executablePath),
}));

import * as doctor from '../src/commands/doctor.js';

describe('doctor browser runtime boundary', () => {
  it('reports an existing executable through the browser adapter', async () => {
    expect(typeof doctor.checkChromium).toBe('function');
    await expect(doctor.checkChromium()).resolves.toEqual({
      ok: true,
      detail: { path: process.execPath },
    });
  });

  it('reports missing when Patchright returns a path that does not exist', async () => {
    browserMock.executablePath = 'C:\\definitely-missing\\patchright\\chromium.exe';
    await expect(doctor.checkChromium()).resolves.toEqual({
      ok: false,
      detail: { path: browserMock.executablePath },
    });
  });
});
