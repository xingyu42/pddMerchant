import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import * as browserAdapter from '../../src/adapter/browser.js';

describe('browser runtime adapter contract', () => {
  it('owns the browser executable path lookup for doctor', () => {
    assert.equal(typeof browserAdapter.getBrowserExecutablePath, 'function');
    const executablePath = browserAdapter.getBrowserExecutablePath();
    assert.equal(typeof executablePath, 'string');
    assert.ok(executablePath.length > 0);
  });

  it('preserves Playwright main-world evaluate semantics', async () => {
    const calls = [];
    const page = {
      evaluate: async (...args) => {
        calls.push(args);
        return 'ok';
      },
    };
    const pageFunction = ({ value }) => value;
    const arg = { value: 42 };

    assert.equal(typeof browserAdapter.evaluateInMainWorld, 'function');
    const result = await browserAdapter.evaluateInMainWorld(page, pageFunction, arg);

    assert.equal(result, 'ok');
    assert.deepEqual(calls, [[pageFunction, arg, false]]);
  });
});
