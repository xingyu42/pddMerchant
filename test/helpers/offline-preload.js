import net from 'node:net';
import { createRequire, registerHooks } from 'node:module';

function blocked() {
  throw new Error('External IO is disabled in offline CLI tests');
}

// Runs before the CLI, including when a regression accidentally selects live mode.
net.Socket.prototype.connect = blocked;
globalThis.fetch = blocked;

// CLI 按需加载 patchright：等它第一次被解析时再封住启动入口，用不到浏览器的子进程不付这笔加载成本。
// ESM 的具名导出与 require 拿到的是同一个 chromium 对象。
const require = createRequire(import.meta.url);
let guarded = false;
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'patchright' && !guarded) {
      guarded = true;
      const { chromium } = require('patchright');
      chromium.launch = blocked;
      chromium.launchPersistentContext = blocked;
      chromium.connectOverCDP = blocked;
    }
    return nextResolve(specifier, context);
  },
});
