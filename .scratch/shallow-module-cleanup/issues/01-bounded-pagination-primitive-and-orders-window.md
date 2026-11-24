# 01: 有界分页原语统一与 `collectOrdersWindow` 归位

**What to build:** 将原先寄居在诊断子目录、被四个领域共同导入的多页订单采集函数（原 `collectOrdersForStaleAnalysis`）提升归位至订单领域主模块并重命名为表达时间窗与范围的中性接口 `collectOrdersWindow`；同时识别诊断商品采集模块中镜像重复分页上限、休眠等待与限流截断逻辑的 `collectAllGoods`（硬编码非可中止 200ms 休眠并带过时镜像注释），抽取共享的支持 `AbortSignal` 的有界分页遍历原语供 `collectOrdersWindow` 与 `collectAllGoods` 共同复用，彻底消除双份循环维护与过时注释，严格维持分页大小、页数预算、中止检查、空页/不满页截止以及 `truncated` / `ratelimited` 标记契约不变。参见 `../spec.md`。

**Blocked by:** runtime-adapter-seams#06

**Status:** ready-for-agent

- [ ] `collectOrdersWindow` 归位至订单领域主模块，四个消费领域（商品利润、商品分层、售后诊断、库存分析）及现有测试导入全部切换
- [ ] 提取统一的可中止有界分页原语，`collectOrdersWindow` 与 `collectAllGoods` 共用同一份分页上限、可取消休眠与截断/限流标记逻辑并清除过时镜像注释
- [ ] 验证高并发中止与分页边界下原既有行为、精度与告警标识保持零回归
- [ ] `npm run check` 通过
