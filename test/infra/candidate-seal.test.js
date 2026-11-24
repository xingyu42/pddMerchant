import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { createCandidateSeal, deepFreeze } from '../../src/infra/candidate-seal.js';
import { PddCliError, ExitCodes } from '../../src/infra/errors.js';

describe('CandidateSeal', () => {
  it('deep-freezes sealed candidate materials and validates them within the issuing instance', () => {
    const seal = createCandidateSeal();
    const candidate = {
      state: { cookies: [{ name: 'PASS_ID', value: 'synthetic' }], origins: [] },
      identity: { mallId: '900001', displayName: 'Shop' },
      checked_at: '2026-11-25T00:00:00.000Z',
      scope: 'shop_read',
    };

    const sealed = seal.seal(candidate);
    assert.equal(sealed, candidate);
    assert.equal(Object.isFrozen(sealed), true);
    assert.equal(Object.isFrozen(sealed.state), true);
    assert.equal(Object.isFrozen(sealed.state.cookies), true);
    assert.equal(Object.isFrozen(sealed.state.cookies[0]), true);
    assert.equal(Object.isFrozen(sealed.identity), true);
    assert.equal(seal.has(sealed), true);
    assert.equal(seal.assert(sealed), sealed);
  });

  it('isolates candidates across independent CandidateSeal instances', () => {
    const sealA = createCandidateSeal();
    const sealB = createCandidateSeal();
    const candidateA = sealA.seal({ state: { cookies: [], origins: [] }, identity: { mallId: '900001' } });
    const candidateB = sealB.seal({ state: { cookies: [], origins: [] }, identity: { mallId: '900002' } });

    assert.equal(sealA.has(candidateA), true);
    assert.equal(sealA.has(candidateB), false);
    assert.equal(sealB.has(candidateB), true);
    assert.equal(sealB.has(candidateA), false);

    assert.throws(() => sealA.assert(candidateB), (error) => {
      assert.ok(error instanceof PddCliError);
      assert.equal(error.code, 'E_AUTH_CANDIDATE_INVALID');
      assert.equal(error.exitCode, ExitCodes.AUTH);
      return true;
    });
    assert.throws(() => sealB.assert(candidateA), { code: 'E_AUTH_CANDIDATE_INVALID' });
  });

  it('rejects unsealed clones, arbitrary objects and non-object inputs', () => {
    const seal = createCandidateSeal();
    const sealed = seal.seal({ state: { cookies: [], origins: [] }, identity: { mallId: '900001' } });
    const clone = { ...sealed };

    assert.equal(seal.has(clone), false);
    assert.throws(() => seal.assert(clone), { code: 'E_AUTH_CANDIDATE_INVALID' });
    for (const bad of [null, undefined, 'candidate', 42, () => {}]) {
      assert.equal(seal.has(bad), false);
      assert.throws(() => seal.seal(bad), { code: 'E_AUTH_CANDIDATE_INVALID' });
      assert.throws(() => seal.assert(bad), { code: 'E_AUTH_CANDIDATE_INVALID' });
    }
  });

  it('deepFreeze handles shared and circular object graphs safely', () => {
    const cyclic = { nested: { items: [1, 2] } };
    cyclic.self = cyclic;
    assert.equal(deepFreeze(cyclic), cyclic);
    assert.equal(Object.isFrozen(cyclic), true);
    assert.equal(Object.isFrozen(cyclic.nested.items), true);
  });
});
