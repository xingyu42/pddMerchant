// facade（design D-2）：保留 withCommand/executeSingle 既有导出，30 个命令
// 文件 import 面零改动。实现见 runner/{envelope-finalizer,fixture-runtime,
// single-lifecycle,batch-executor}.js；executeBatch 保持内部（不出 facade）。
export { executeSingle } from './runner/single-lifecycle.js';
export { withCommand } from './runner/batch-executor.js';
