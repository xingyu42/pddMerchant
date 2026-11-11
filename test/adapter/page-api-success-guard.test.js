import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { describe, it } from 'vitest';
import { isSuccessfulResponse } from '../../src/adapter/response-interpreter.js';

// page-api 只拿到页面客户端拆壳后的 result，page-api-client 再合成 { success: true, errorCode: 0, result }。
// fixture 用的是抓包外壳（errorCode 1000 / 1000000），覆盖不到这个合成形态，因此在这里统一守卫。
const PAGE_API_SUCCESS = Object.freeze({ success: true, errorCode: 0, result: {} });
const endpointDir = new URL('../../src/adapter/endpoints/', import.meta.url);

async function pageApiSpecs() {
  const files = readdirSync(endpointDir).filter((file) => file.endsWith('.js') && !file.startsWith('_'));
  const specs = [];
  for (const file of files) {
    const mod = await import(new URL(file, endpointDir));
    for (const value of Object.values(mod)) {
      if (value && typeof value === 'object' && value.strategy === 'page-api') specs.push(value);
    }
  }
  return specs;
}

describe('page-api success envelope guard', () => {
  it('every page-api endpoint accepts the synthesized errorCode 0 success envelope', async () => {
    const specs = await pageApiSpecs();
    assert.ok(specs.length > 10, `expected to discover page-api specs, found ${specs.length}`);
    const rejected = specs.filter((spec) => !isSuccessfulResponse(PAGE_API_SUCCESS, spec.successRule))
      .map((spec) => spec.name);
    assert.deepEqual(rejected, []);
  });
});
