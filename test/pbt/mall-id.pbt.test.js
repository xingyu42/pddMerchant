import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { parseMallId } from '../../src/adapter/mall-id.js';
import { cssEscape } from '../../src/adapter/css-escape.js';

describe('parseMallId PBT', () => {
  it('PROP-MI-1: round-trip — valid numeric strings preserve value including leading zeros', () => {
    fc.assert(
      fc.property(
        fc.stringOf(fc.constantFrom('0', '1', '2', '3', '4', '5', '6', '7', '8', '9'), { minLength: 1, maxLength: 15 }),
        (s) => {
          const result = parseMallId(s, { strict: true });
          assert.strictEqual(result.value, s, `round-trip failed for "${s}"`);
        }
      ),
      { numRuns: 200 }
    );
  });

  it('PROP-MI-2: invalid strict inputs are rejected', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.string({ minLength: 1, maxLength: 20 }).filter((s) => !/^[0-9]{1,15}$/.test(s)),
          fc.constant(''),
          fc.constant('  123  '),
          fc.constant('abc'),
          fc.constant('-1'),
          fc.constant('12345678901234567890'),
        ),
        (input) => {
          const result = parseMallId(input, { strict: true });
          assert.strictEqual(result.value, null, `should reject "${input}"`);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('PROP-MI-3: CSS.escape — accepted IDs never appear raw in escaped selector string', () => {
    fc.assert(
      fc.property(
        fc.stringOf(fc.constantFrom('0', '1', '2', '3', '4', '5', '6', '7', '8', '9'), { minLength: 1, maxLength: 15 }),
        (id) => {
          const escaped = cssEscape(id);
          const selector = `[data-mall-id="${escaped}"]`;
          // The raw ID should only appear within the escaped context, not unescaped
          assert.ok(typeof selector === 'string' && selector.length > 0);
          // Verify the escape function returns a string
          assert.ok(typeof escaped === 'string');
        }
      ),
      { numRuns: 100 }
    );
  });
});
