# 实施计划

## 1. Infra Paths And Registries

- [x] 更新 `src/infra/paths.js`，新增 merchant/consumer 业务根目录、registry、pending 和 account auth path helper。
- [x] 提取共享 slug 规范化 helper，保持现有商家导出兼容。
- [x] 扩展商家 registry 的 `mallId` 稳定查找与安全重命名能力。
- [x] 新增消费者 registry 与 resolver，支持 default、唯一账号和显式 `--consumer-account`。
- [x] 移除旧根级 auth/account 迁移调用，不保留旧默认读取。

## 2. Identity And Login Provisioning

- [x] 让商家 QR/headed 登录在 page 关闭前返回真实 mall identity。
- [x] 新增 consumer identity observer，严格解析 `/proxy/api/api/apollo/v3/user/me` 的 `uid` 与 `nickname`。
- [x] 为 fixture 模式增加稳定商家与消费者 identity seam。
- [x] 新增共享 provisioning helper，完成 pending 保存、稳定身份查找、slug 生成、原子移动和 registry 更新。
- [x] 接入 `login`、`init` 和 `account add`，移除 `account-<timestamp>` 假店铺名。
- [x] 保持商家登录成功后的 daemon 启动确认语义不变；消费者登录不启动 merchant daemon。

## 3. Consumer Callers And Privacy

- [x] 在命令注册与 option merge 中加入 `--consumer-account`。
- [x] 让 goods publish/source scraper、软风控删除和 doctor 使用同一个 consumer account resolver 结果。
- [x] 调整 login/account 输出，禁止输出原始 auth path 和完整手机号。
- [x] 清理 auth-state/logger/error 中可能拼接敏感 path 的位置，改为安全错误码、文件指纹或省略。

## 4. Tests And Documentation

- [x] 新增路径默认值、环境变量覆盖、slug 重名/改名/非法字符测试。
- [x] 新增 consumer identity observer 成功、字段缺失、超时、错误响应测试。
- [x] 新增 merchant provisioning 与 consumer registry/resolver 测试。
- [x] 更新 login、account add、doctor、goods publish、daemon、runner、JSON purity 和相关 PBT/e2e 测试。
- [x] 更新 README、`.env.example`、`docs/architecture-overview.md`、`docs/goods-publish-api-recon.md`、`skills/pdd-cli/SKILL.md` 和 `.trellis/spec/` 路径契约。

## 5. Validation And Cleanup

- [x] 先运行新增模块和登录/账号/商品发布的定向 Vitest。
- [x] 运行 daemon、runner、auth lock、JSON purity 相关测试。
- [x] 运行完整 `npm test`。
- [x] 使用有头消费者登录验证新 identity probe 和新目录写入。
- [x] 验证新 consumer 登录态可被 doctor 和只读商品抓取路径解析。
- [x] 检查 daemon 状态，确认不会继续引用旧商家 auth 路径。
- [x] 解析并核对待清理绝对路径后，仅删除旧登录文件与旧 `data/accounts/`。
- [x] 运行 `git diff --check` 和 `git diff`，确认没有触碰其他 `data/` 文件或无关 WIP。

## Rollback Points

- 路径/registry 测试未通过时，不接入登录命令。
- 登录 provisioning 未通过 fixture 测试时，不运行真实登录。
- 新消费者真实登录未成功写入新目录时，不清理旧 `consumer-auth-state.json`。
- daemon 或商品发布仍引用旧路径时，不执行旧文件清理。
