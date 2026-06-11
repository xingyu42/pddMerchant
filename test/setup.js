// 全局测试 setup：隔离会污染断言输出的环境变量。
// PDD_DEBUG_RAW 会向 stderr 写 raw_debug JSONL（design D-1），
// 任何继承自外层 shell 的取值都会破坏 stdout/stderr 对比类断言。
import { beforeEach } from 'vitest';

delete process.env.PDD_DEBUG_RAW;

beforeEach(() => {
  delete process.env.PDD_DEBUG_RAW;
});
