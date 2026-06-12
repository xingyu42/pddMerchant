#!/usr/bin/env node
import { generateFingerprintProfile } from '../src/infra/stealth-scripts.js';

const seed = process.argv[2] || 'test-seed';
const iterations = parseInt(process.argv[3] || '10', 10);

console.log(`Testing fingerprint consistency with seed: ${seed}`);
console.log(`Iterations: ${iterations}\n`);

const profiles = [];
for (let i = 0; i < iterations; i++) {
  profiles.push(generateFingerprintProfile(seed));
}

const first = JSON.stringify(profiles[0]);
const allSame = profiles.every(p => JSON.stringify(p) === first);

if (allSame) {
  console.log('✅ All fingerprints are identical');
  console.log('\nProfile:');
  console.log(JSON.stringify(profiles[0], null, 2));
} else {
  console.log('❌ Fingerprints vary across iterations');
  console.log('\nFirst:', JSON.stringify(profiles[0], null, 2));
  console.log('\nLast:', JSON.stringify(profiles[profiles.length - 1], null, 2));
  process.exit(1);
}
