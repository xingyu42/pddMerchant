import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { buildEnvelope } from '../../src/infra/output.js';
import { errorToEnvelope, PddCliError, ExitCodes } from '../../src/infra/errors.js';

describe('Envelope PBT', () => {
  it('PROP-EN-1: buildEnvelope idempotent', () => {
    fc.assert(
      fc.property(
        fc.record({
          ok: fc.boolean(),
          command: fc.string(),
          data: fc.oneof(fc.constant(null), fc.string(), fc.integer()),
        }),
        (input) => {
          const e1 = buildEnvelope(input);
          const e2 = buildEnvelope(e1);
          assert.deepStrictEqual(e1, e2);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('PROP-EN-2: buildEnvelope always has required fields', () => {
    fc.assert(
      fc.property(
        fc.oneof(fc.constant(null), fc.constant(undefined), fc.record({ ok: fc.boolean() })),
        (input) => {
          const e = buildEnvelope(input);
          assert.strictEqual(typeof e.ok, 'boolean');
          assert.strictEqual(typeof e.command, 'string');
          assert.ok('data' in e);
          assert.ok('meta' in e);
          assert.strictEqual(e.meta.v, 1, 'meta.v must be 1');
          assert.ok(Array.isArray(e.meta.warnings));
        }
      ),
      { numRuns: 50 }
    );
  });

  it('PROP-ER-1: errorToEnvelope error.code always starts with E_', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 20 }),
        fc.string({ minLength: 1, maxLength: 50 }),
        (code, message) => {
          const err = new PddCliError({ code, message, exitCode: ExitCodes.GENERAL });
          const envelope = errorToEnvelope('test', err);
          assert.ok(
            envelope.error.code.startsWith('E_'),
            `error.code "${envelope.error.code}" should start with E_`
          );
        }
      ),
      { numRuns: 50 }
    );
  });

  it('PROP-ER-2: errorToEnvelope meta.exit_code ∈ {0..7}', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(
          ExitCodes.OK, ExitCodes.GENERAL, ExitCodes.USAGE,
          ExitCodes.AUTH, ExitCodes.RATE_LIMIT, ExitCodes.NETWORK,
          ExitCodes.BUSINESS, ExitCodes.PARTIAL
        ),
        (exitCode) => {
          const err = new PddCliError({ code: 'E_TEST', message: 'test', exitCode });
          const envelope = errorToEnvelope('test', err);
          assert.ok(
            envelope.meta.exit_code >= 0 && envelope.meta.exit_code <= 7,
            `exit_code ${envelope.meta.exit_code} out of range`
          );
        }
      ),
      { numRuns: 8 }
    );
  });
});
