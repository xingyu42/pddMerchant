import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { buildEnvelope } from '../../src/infra/output.js';

const ANSI_REGEX = /[]\[[0-9;]*[a-zA-Z]/g;

describe('--no-color PBT', () => {
  it('PROP-NC-1: noColor=true → zero ANSI escapes in rendered output', () => {
    fc.assert(
      fc.property(
        fc.record({
          ok: fc.boolean(),
          command: fc.string({ minLength: 1, maxLength: 20 }),
          data: fc.oneof(fc.constant(null), fc.string(), fc.integer()),
        }),
        (input) => {
          const envelope = buildEnvelope(input);
          const json = JSON.stringify(envelope);
          const matches = json.match(ANSI_REGEX);
          assert.strictEqual(
            matches,
            null,
            `ANSI escapes found in JSON envelope: ${matches?.join(', ')}`
          );
        }
      ),
      { numRuns: 50 }
    );
  });
});
