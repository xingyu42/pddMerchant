# 收口商品详情图上传任务

## Goal

确认旧任务要求的详情图上传用户价值已经由后续商品草稿修复实现，修正文档后归档旧任务。

## Confirmed Facts

- `169c5f6` 已将 `source.detailImgs` 下载到临时目录并交给详情图区上传逻辑，完成后始终清理临时文件。
- 当前实现会为每张详情图等待独立完成响应；下载或上传部分失败产生稳定警告，全部失败抛出 `E_BUSINESS` 并停止保存草稿。
- 详情图顺序沿用 `source.detailImgs` 和下载结果顺序。
- `test/adapter/image-handler.unit.test.js` 覆盖逐文件完成、全部失败和详情图区定位漂移。
- 真实草稿核对已确认详情图存在；后续 18 SKU 草稿验收同时确认标题、轮播图、详情图、运费模板、价格和库存正确。
- 2026-07-18/19 当前工作树完整测试已通过：沙箱外 141 files / 1159 tests passed，另有 1 file / 1 test skipped。

## Superseded Historical Assumptions

- 旧 PRD 使用猜测性 CSS 选择器和固定等待；当前实现以实际文件输入位置、上传完成响应和失败关闭契约替代。
- 旧 PRD 要求新增独立 Mock provider；当前测试直接覆盖现有 image-handler seam，不额外增加只为测试存在的运行时抽象。
- 旧 PRD 的覆盖率百分比没有保留可比基线，不作为归档时的虚假指标。

## Requirements

1. 保留当前详情图下载、上传、部分警告、全部失败阻断和 `finally` 清理契约。
2. 同步项目文档，使其不再把详情图描述为未实现或仍待真实定位。
3. 不在本任务中修改运行时代码、图片限制策略或真实商品状态。
4. 不触碰当前工作区中 Knip、依赖、临时脚本和 CLI skill 的既有 WIP。

## Acceptance Criteria

- [x] 文档准确说明详情图上传当前能力、部分失败警告和全部失败阻断。
- [x] 相关定向测试通过：合并验收 5 files / 101 tests。
- [x] 本任务不产生运行时代码改动，也不混入既有 WIP。
- [x] 验收完成，可归档本任务，并保留 `07-10-discount-config-abstract` 与父任务。

## Out of Scope

- 新增图片格式、尺寸或压缩策略。
- 改变轮播图或 SKU 预览图流程。
- 满件折扣配置。

## Rollback

本任务只更新文档与 Trellis 记录；如内容与当前代码不一致，只回滚本任务对应文档段落。
