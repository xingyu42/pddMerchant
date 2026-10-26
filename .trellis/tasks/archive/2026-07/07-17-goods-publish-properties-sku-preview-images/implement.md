# 实施计划：补齐商品属性与 SKU 预览图

## 当前进度（2026-07-18）

- Gate 0、Step 1-10 与真实草稿验收均已完成；未暂存、未提交，也未整理无关 WIP。
- “成分含量”缺失根因已确认：真实 locator 指针点击 `面料俗称=棉` 后，同页自动出现 `材质=棉` 与必填 `成分含量`；脚本式 `element.click()` 只改变显示，不触发依赖链。
- 初始模板响应不含动态模型，选择后也没有第二次模板响应。实现改为有界读取新可见行的当前 React 表单模型、严格合并并只补写新增 PID；不阶段保存、不重载，最终只保存一次。
- 本轮商品发布相关矩阵 9 files / 134 tests 通过；最终核心矩阵 4 files / 95 tests 通过。全量主跑 139 files / 1146 tests 通过、1 file skipped；`auth-lock` 因 Windows 沙箱 `tasklist Access denied` 失败，`shops --help` 子进程在并发压力下超时，两文件在正常 Windows 权限下串行复跑 11/11 通过。
- 三张唯一 SKU 色图均返回 HTTP 200 `image/jpeg`，未过期；真实草稿只读回查确认灰、蓝、黄三个颜色预览均存在。
- 本轮真实非 `--confirm` E2E 已成功创建草稿 `goods_id=979029791982`、`goods_commit_id=196340650242`；日志断言只保存一次，属性映射 19、可选跳过 2，独立页面读回包含 `成分含量` 且 3 个 SKU 预览均存在。
- E2E 使用 v4 临时缓存且断言未访问源商品页、未调用 submit；成功后缓存已删除。模板详情回查不可用时保留 `draft_verification_unavailable`，独立浏览器回查已补足证据。
- 新发现并修复尺码表阻塞：动态属性稳定后、最终保存前自动执行官方“停用尺码表 -> 确认停用”，控制项缺失或停用读回不一致时不保存；不硬编码 `size_spec_id`。
- 修复后的真实非 `--confirm` E2E 创建草稿 `goods_id=979039995639`、`goods_commit_id=196342384595`，重新打开后停用入口与尺码表计数均为 0，属性映射 19、三色 SKU 预览仍通过，并继续证明未抓取源页、未 submit、只保存一次。
- 尺码表定向回归与 service 回归 2 files / 73 tests 通过；全量主跑 140 files / 1153 tests 通过、1 file skipped，仅 `auth-lock` 因沙箱 `tasklist Access denied` 失败，正常 Windows 权限下单文件复跑 6/6 通过。

## Gate 0：开发前

- [ ] 用户审阅并批准 `prd.md`、`design.md`、`implement.md`。
- [ ] 批准后运行 `python ./.trellis/scripts/task.py start 07-17-goods-publish-properties-sku-preview-images`；批准前不得启动。
- [ ] 运行 `trellis-before-dev`，读取 services/adapter/testing 规范。
- [ ] 保存当前 `git status --short`，并对两个重叠 WIP 文件执行只读 `git diff -- src/services/goods-publish.js src/adapter/goods-publish/source-scraper.js`。
- [ ] 不暂存、不提交、不整理与本任务无关的工作区改动。

## Step 1：先建立失败测试（源契约）

- [ ] 在 SKU normalizer 测试中加入 `thumbUrl` 保留、缺失、同色冲突和异色独立图片用例。
- [ ] 在 source scraper 投影测试中加入 `goodsProperty` 与 SKU `thumbUrl`，证明只投影 exact goods_id 的有限字段。
- [ ] 在 source cache 测试中把 fixture 升为 v4，断言 `goodsProperties`/`thumbUrl` round-trip，v3 拒绝且敏感字段不落盘。
- [ ] 运行相关测试，记录红灯来自缺失的新契约而非现有 WIP。

## Step 2：实现源投影与缓存 v4

- [ ] 扩展 `projectSku()` 保留 `thumbUrl`，扩展 exact goods 投影保留结构化 `goodsProperty`。
- [ ] 扩展 `normalizeSourceSkuSnapshot()` 保留并校验缩略图字符串，不改变现有价格/库存/组合契约。
- [ ] 增加有界 `goodsProperties` 规范化；禁止详情文本补值。
- [ ] 升级源缓存到 v4，只保存发布需要字段；更新缓存测试。
- [ ] 运行源抓取/normalizer/cache 定向测试。

## Step 3：先建立失败测试（属性映射）

- [ ] 新建 `property-mapper` 单测：refPid 唯一匹配、精确名称回退、显式面料别名、`棉/棉 -> 棉`、多值、候选非唯一、模板结构漂移。
- [ ] 覆盖三类策略：required 失败、important 失败、optional 跳过并聚合 warning。
- [ ] 覆盖无模糊匹配、无首项回退、可选属性不做部分填写。

## Step 4：实现模板规范化与属性计划

- [ ] 新增 `property-mapper.js` 纯函数模块。
- [ ] 收紧 `GOODS_PUBLISH_TEMPLATE` 的规范化/成功判断，返回可验证模板数据但不向 command 暴露 raw。
- [ ] 在 `publishGoodsFromLink()` 创建草稿后、填写前调用现有模板 endpoint，生成 `propertyPlan`。
- [ ] 模板/required/important 失败时在任何属性和图片表单写入前停止；optional 仅产生 `property_mapping_partial`。
- [ ] 更新 service/endpoint 单测。

## Step 5：实现属性 UI 填写与读回

- [ ] 在 `form-filler.js` 增加按完整 label 唯一定位的属性行帮助函数。
- [ ] 品牌走搜索输入；普通属性走当前行的 `请选择` 输入和可见 `role=listbox/option`。
- [ ] 按计划逐项选择，React 重绘后重新定位；禁止全页输入索引。
- [ ] 写入后读回全部计划值；required/important 读回失败立即 `E_BUSINESS`。
- [ ] 删除活动路径中的 `property_mapping_unavailable` 旧诊断；旧 `parseProperties` 若已无调用，仅在测试同步删除，不做兼容猜测。
- [ ] 用 locator mock 覆盖单值、多值、重复标签、重复候选、读回失败。

## Step 6：先建立失败测试（SKU 预览图）

- [ ] 为 `buildSkuPreviewPlan()` 覆盖同色 6 尺码复用、三色独立、缺图、同色多图冲突、找不到颜色维度。
- [ ] 为 image handler 覆盖按颜色容器而非全页索引、忽略空白行、容器重复/缺失、每图独立 2xx 响应、下载/上传/页面读回失败。
- [ ] 确认测试错误 detail 不含源图片 URL。

## Step 7：实现 SKU 预览图上传

- [ ] 从规范化 SKU 构造颜色预览计划；目标临时 E2E 保留已验证的标准色投影。
- [ ] 一次下载三张计划图，必须全量成功后才开始上传，并始终清理临时目录。
- [ ] 按 `.new-spec-single-color` 行内主色值唯一匹配容器；空白新增行忽略。
- [ ] 每种颜色逐一上传、认领独立完成响应、记录内存中的返回 URL并读回容器预览状态。
- [ ] 把上传结果传入保存 payload 校验，不写日志。

## Step 8：扩展保存请求与草稿核验

- [ ] 扩展 `validateDraftEditPayload()`，逐计划校验 `goods_properties` 的平台 ID/vid/value。
- [ ] 继续按规格组合匹配 SKU，再校验每行 `thumb_url` 对应颜色上传结果。
- [ ] payload issue 时断言 route `abort` 且从未 `continue`；route handler 始终清理。
- [ ] 草稿详情可用时验证属性/SKU 图；不可用时只保留既有 warning，不制造字段缺失假象。
- [ ] 更新现有 strict payload/detail regression。

## Step 9：更新临时真实 E2E

- [ ] `projectSource()` 从 `runtime-goods.json` 投影 20 个 `goodsProperties`，并在 18 个 SKU 上保留 `thumbUrl`。
- [ ] 保持 `PDD_SOURCE_PROXY_PROVIDER=live-e2e-cache-only`、空 AuthKey 和日志断言，证明缓存命中且未访问 `mobile.yangkeduo.com`。
- [ ] CLI 参数仍不带 `--confirm`，断言 `status=draft` 且无 submit。
- [ ] 创建成功后用返回的 goods ID/commit ID 打开草稿做只读核对：5 个重要属性及全部 propertyPlan 值存在；灰/蓝/黄三个颜色容器各有预览；18 个 SKU、价格、库存仍正确。
- [ ] 不删除既有草稿；只报告新草稿 ID。

## Step 10：验证矩阵

按从小到大执行：

```powershell
npx vitest run test/adapter/property-mapper.unit.test.js test/adapter/form-filler.unit.test.js test/adapter/image-handler.unit.test.js
npx vitest run test/goods-publish-source-cache.unit.test.js test/form-filler.unit.test.js test/goods-publish.unit.test.js
npx vitest run test/pbt/goods-publish.pbt.test.js
npm test
npm run check
```

真实 E2E 只在自动测试全部通过后执行：

```powershell
$env:PDD_RUN_LIVE_GOODS_PUBLISH_E2E='1'
node --test data/investigation/2026-07-15T19-27-48-690Z_goods-447841256386-raw/goods-publish-draft.live.e2e.test.mjs
Remove-Item Env:PDD_RUN_LIVE_GOODS_PUBLISH_E2E
```

- [ ] 检查 stdout 仍为一个 JSON envelope，stderr 不含 Cookie、代理、图片 URL或模板 raw。
- [ ] 若 Windows sandbox 下出现与本任务无关的 `tasklist Access denied`，用相同 seed/命令在正常权限下复核后再归因。
- [ ] 运行 `git diff --check`。
- [ ] 运行 `git diff --` 仅检查计划文件与实际触及 hunk；确认没有覆盖其他 WIP。

## Step 11：停用上架阻塞的尺码表

- [x] 现场确认官方停用控件、二次确认文本和停用后的 DOM 读回；对保存请求仅做 route abort 探测，不向平台发送探测 payload。
- [x] 先补 helper/service 红灯测试，再实现 `disableSizeChart()` 和保存前编排；活动状态无法确认停用时失败关闭且 `saveCalls=0`。
- [x] 临时真实 E2E 增加草稿重开断言，确认停用入口与尺码表都不存在，同时保持只保存草稿、不抓取源页、不 submit。

## 完成条件

- [x] PRD 每条 acceptance criterion 都有测试或真实 E2E 证据。
- [x] 新草稿的属性与三色预览图只读核对通过，且证明未抓取源页、未提交发布。
- [x] 所有定向测试、PBT、全量测试和 check 结果如实记录。
- [x] 不自动提交；向用户报告变更文件、验证结果、新草稿 ID、剩余风险和是否存在图片链接失效。
