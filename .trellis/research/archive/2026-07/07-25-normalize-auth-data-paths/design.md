# 技术设计

## 1. Path Contract

新增并集中导出以下默认目录：

```text
data/merchant/stores/registry.json
data/merchant/stores/<store-slug>/auth-state.json
data/consumer/accounts/registry.json
data/consumer/accounts/<account-slug>/auth-state.json
```

现有 `ACCOUNTS_DIR` 与 `ACCOUNT_REGISTRY_PATH` 继续作为商家账号抽象，但默认值改到 `data/merchant/stores/`。`PDD_ACCOUNTS_DIR`、`PDD_ACCOUNT_REGISTRY_PATH`、`PDD_AUTH_STATE_PATH` 和 `PDD_CONSUMER_AUTH_STATE_PATH` 的显式覆盖优先级不变。

默认真实登录先写入同业务根目录下的 pending 临时文件，身份确认后再原子移动到最终目录。正常流程不使用旧根级登录文件。

## 2. Stable Identity And Readable Slug

商家身份使用 `{ mallId, displayName }`：

- `mallId` 是稳定主键。
- `displayName` 来自现有 mall context 的真实店铺名。
- 目录 slug 由 `displayName` 规范化，冲突哈希包含 `mallId`。

消费者身份使用 `{ uid, nickname }`：

- `uid` 是稳定主键。
- `nickname` 来自 `GET /proxy/api/api/apollo/v3/user/me`。
- 目录 slug 由 `nickname` 规范化，冲突哈希包含 `uid`。
- 用户已选择允许完整手机号昵称进入本机目录。

将通用 slug 规范化提取到独立 infra helper，商家注册表保留兼容导出，避免两套算法漂移。

## 3. Login Provisioning Flow

商家 QR、headed 和 account add 登录流程：

1. 解析显式自定义路径或创建 pending auth 路径。
2. 在已认证 page 关闭前调用现有 mall context reader。
3. 保存 storage state 到 pending 或已选账号路径。
4. 按 `mallId` 查找已有店铺；生成或更新安全 slug。
5. 必要时原子移动 auth 文件并更新商家 registry。
6. 普通 `login`、`init` 和 `account add` 共用同一 provisioning helper。
7. 成功后再触发现有 merchant daemon 启动确认。

消费者 QR 和 headed 登录流程：

1. 在导航登录页前注册 `user/me` response observer。
2. 登录成功后等待并校验 `{ uid, nickname }`。
3. 保存 storage state 到 pending 路径。
4. 按 `uid` 查找已有消费者账号；生成或更新安全 slug。
5. 原子移动 auth 文件并更新 consumer registry。
6. 本次成功登录账号设为 default。

Fixture 模式通过明确 mock identity seam 提供稳定的 mall/consumer identity，不访问真实浏览器或网络。

## 4. Consumer Account Resolution

新增独立 consumer registry 和 resolver，避免复用商家 `--account` 造成语义混淆。

解析优先级：

```text
PDD_CONSUMER_AUTH_STATE_PATH / explicit auth path
-> --consumer-account <slug or unique display name>
-> registry.defaultAccount
-> only enabled account
-> auth/account-required error
```

新增全局 `--consumer-account <ref>`，供商品发布、doctor 和消费者登录刷新指定账号。商品发布源抓取和软风控删除必须消费同一个已解析 `authPath`。

## 5. Registry Contracts

商家 registry 延续 version 1，并保留现有字段；默认文件位置改变。以 `mallId` 补充稳定查找和重命名处理。

消费者 registry 使用独立 version 1：

```js
{
  version: 1,
  defaultAccount: string | null,
  updatedAt: string,
  accounts: {
    [slug]: {
      slug,
      displayName,
      uid,
      createdAt,
      updatedAt,
      lastLoginAt,
      lastUsedAt,
      disabled
    }
  }
}
```

两个 registry 都使用现有同目录临时文件、原子 rename、权限和 auth lock 约束。重命名时先落新文件，再原子更新 registry；失败不得删除仍可用的旧目标。

## 6. Privacy And Output

包含消费者账号 slug 的 auth path 属于敏感值：

- login envelope 不返回原始 auth path。
- 错误消息不拼接原始 auth path。
- logger 不记录原始 path、nickname、mobile、uid、avatar、Cookie 或 Token。
- 对用户展示消费者账号时使用脱敏 display name 或稳定短 fingerprint。
- 内部 registry 可保存用户选择的完整手机号目录名，但文件仍受 `data/` gitignore 保护。

## 7. No Legacy Migration

删除运行时旧路径迁移调用和旧根级默认读取。新功能验证成功后，仅清理以下当前工作区路径：

```text
data/auth-state.json
data/consumer-auth-state.json
data/accounts.json
data/accounts/
```

清理前确认新消费者登录已经写入新路径；不删除 `daemon-state.json`、`scrape-cooldown.json` 或其他 `data/` 文件。

## 8. Failure And Rollback

- 身份接口缺失、字段无效或 mall context 无法解析时，登录返回认证/业务错误并保留 pending 文件用于本次清理，不写错误 registry。
- 目标 slug 冲突时使用稳定身份哈希，不覆盖其他身份的 auth state。
- registry 更新失败时保留已保存 auth 文件并返回明确错误，不删除旧有效文件。
- 回滚代码时只需恢复旧路径常量和调用方；用户明确不要求恢复已清理的旧失效登录态。
