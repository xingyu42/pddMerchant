export function boxMullerZ(random = Math.random) {
  const u1 = random() || 1e-10;
  const u2 = random();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

export function lognormalSample(mu, sigma, random = Math.random) {
  return Math.exp(mu + sigma * boxMullerZ(random));
}
