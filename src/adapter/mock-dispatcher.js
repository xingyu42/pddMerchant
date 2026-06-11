// Fixture-based mock dispatcher for E2E testing — facade（design D-4）。
// 激活方式：设置 PDD_TEST_ADAPTER=fixture 环境变量。
// 作用范围：adapter 各模块（browser/auth-state/mall/run-endpoint/auth-refresher/
// account-registry/credential-vault/password-login/goods-publish 等）在入口处
// 通过 isMockEnabled() guard 短路到 fixtures/ providers。
// 生产环境不受影响（默认返回 false）。
// 调用点与 vi.mock('.../mock-dispatcher.js') 路径零改动；providers 间互调一律经
// fixtures/core.js（唯一 cache Map 所在），禁止回引本 facade（防 spy 失效与环依赖）。
export { isMockEnabled, loadFixture, clearFixtureCache } from './fixtures/core.js';
export { mockLaunchBrowser, mockCloseBrowser } from './fixtures/browser.js';
export { mockIsAuthValid, mockIsConsumerAuthValid, mockRefreshAuth, mockPasswordLogin } from './fixtures/auth.js';
export { mockListMalls, mockCurrentMall, mockSwitchTo } from './fixtures/mall.js';
export { mockRunEndpoint, FixtureEndpointClient } from './fixtures/endpoint.js';
export { mockAccountRegistry, mockDecryptCredential } from './fixtures/account.js';
export { mockPublishGoods, mockScrapeSourceGoods, mockResolvePddCategory } from './fixtures/goods-publish.js';
