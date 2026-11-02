# 规范化登录态数据目录

## Goal

将登录相关数据按商家店铺和消费者账号归档到明确的业务目录中，使本机文件能直接看出所属店铺或账号，并让登录、daemon、doctor 和商品发布使用同一套路径解析规则。

## Confirmed Facts

- 当前商家单账号登录态默认位于 `data/auth-state.json`。
- 当前消费者登录态默认位于 `data/consumer-auth-state.json`。
- 当前商家账号注册表默认位于 `data/accounts.json`，多账号登录态位于 `data/accounts/<slug>/auth-state.json`。
- `PDD_AUTH_STATE_PATH`、`PDD_CONSUMER_AUTH_STATE_PATH`、`PDD_ACCOUNTS_DIR`、`PDD_ACCOUNT_REGISTRY_PATH` 可覆盖对应路径。
- `data/daemon-state.json`、`data/scrape-cooldown.json`、缓存和日志不是登录数据。
- 商家登录后可通过现有 mall context 读取店铺名和稳定 `mallId`，但当前登录流程尚未把它们用于目录命名。
- 2026-07-25 只读侦察确认消费者首页请求 `GET /proxy/api/api/apollo/v3/user/me`，响应顶层包含数值 `uid`、字符串 `nickname` 和 `avatar`。
- 现有 `slugifyAccountName()` 已处理非法字符、Windows 保留名、长度和重名，可作为业务名称目录规范化的基础。
- 用户确认旧登录态已经失效，不需要兼容迁移；新结构验证成功后可清理旧登录文件。

## Requirements

- 实际目录使用英文业务名，不使用中文目录名。
- 商家注册表位于 `data/merchant/stores/registry.json`。
- 商家登录态位于 `data/merchant/stores/<store-slug>/auth-state.json`。
- `store-slug` 以真实店铺名为可读基础名，以稳定 `mallId` 处理重名和改名。
- 消费者注册表位于 `data/consumer/accounts/registry.json`。
- 消费者登录态位于 `data/consumer/accounts/<account-slug>/auth-state.json`。
- `account-slug` 以 `/proxy/api/api/apollo/v3/user/me` 返回的 `nickname` 为可读基础名，以稳定 `uid` 处理重名和改名。
- 当 `nickname` 是完整手机号时，允许完整手机号作为本机目录名。
- 商家和消费者登录成功后必须在浏览器关闭前完成身份识别；身份识别失败时不得把登录态静默归入错误目录。
- 消费者最新成功登录的账号设为默认账号；消费者操作默认使用该账号，并允许显式选择其他已注册消费者账号。
- 现有四个路径环境变量继续保持更高优先级；显式自定义 auth 文件路径不强制改写到业务目录。
- daemon、doctor、商品发布源抓取和风控删除必须使用已解析的对应账号登录态，不能继续读取散落的固定旧路径。
- 磁盘目录可以包含完整手机号，但 envelope、日志和错误不得原样输出完整手机号、Cookie、Token、头像 URL 或包含手机号的完整 auth 路径。
- 旧 `data/auth-state.json`、`data/consumer-auth-state.json`、`data/accounts.json` 和 `data/accounts/` 不做运行时迁移；新结构验证成功后从当前工作区清理。
- `data/daemon-state.json`、`data/scrape-cooldown.json`、缓存、日志和其他非登录数据保持原位。
- 更新直接描述默认路径或账号选择行为的测试、README、环境变量示例、项目技能、架构文档和 Trellis 路径规范。

## Acceptance Criteria

- [x] 新商家登录自动读取真实店铺名和 `mallId`，并保存到 `data/merchant/stores/<store-slug>/auth-state.json`。
- [x] 新消费者登录自动读取 `uid` 和 `nickname`，并保存到 `data/consumer/accounts/<account-slug>/auth-state.json`。
- [x] 商家和消费者注册表分别记录稳定身份、展示名、slug、默认账号和时间字段。
- [x] 重名、改名、非法字符、Windows 保留名和过长名称不会造成目录逃逸或错误覆盖。
- [x] 消费者默认账号和显式选择行为可测试；商品发布风控删除只删除本次解析出的消费者登录态。
- [x] daemon 和普通商家命令使用新商家注册表及店铺路径，daemon 状态文件仍位于原路径。
- [x] doctor 使用新路径并保持 merchant 与 consumer 状态分离。
- [x] 四个现有路径环境变量仍可覆盖默认路径，且优先级不回退。
- [x] 登录 envelope、日志和错误不暴露完整手机号或包含手机号的 auth 路径。
- [x] 旧登录文件清理后，新登录、doctor、商品发布 fixture 流程和 daemon 相关测试仍通过。
- [x] 定向 Vitest 与完整 `npm test` 通过，文档不再把旧路径描述为当前默认路径。

## Out Of Scope

- 不迁移或恢复旧登录态，不为旧目录提供长期兼容读取。
- 不改变二维码、扫码、有头登录、Cookie 或 storage state 格式。
- 不使用头像参与身份识别或目录命名。
- 不移动 daemon 状态、抓取冷却、商品缓存、日志和临时分析文件。
