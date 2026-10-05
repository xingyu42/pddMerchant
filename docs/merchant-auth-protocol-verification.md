# 商家认证协议核验记录

日期：2026-10-04（Asia/Shanghai）。材料由用户扫码取得，使用程序专用 Chromium 的隔离上下文；未读取日常浏览器、未保存凭据。旧后台已在切换前正常停止。

## 已观察的协议

- `GET https://mms.pinduoduo.com/janus/api/checkLogin`：独立 HTTPS 显式发送冻结候选 Cookie，HTTP 200 且布尔 `success=true`、`result.login=true`。移除 PASS_ID 的独立对照请求返回布尔 `result.login=false`。三次临时会话均符合该判定。
- `GET https://mms.pinduoduo.com/earth/api/mallInfo/querySimpleCredential`：HTTP 200、布尔 success=true、固定 `result.merchantMainSimpleVO.mallId` 与 `mallName`。后台自然调用的结构与同次冻结候选的独立请求一致。
- `GET https://mms.pinduoduo.com/earth/api/mallInfo/queryMallAuditInfo`：HTTP 200、布尔 success=true、`result.auditInfoVOList` 数组。同次冻结会话独立读取通过；只证明店铺信息读取，不证明其他业务权限。

GET 正反对照及店铺读取的最后观察时间为 UTC 2026-10-03T22:21:35Z。此记录不含真实店铺标识、Cookie、二维码或响应正文。非 200、异常 JSON、TLS、超限、网络错误、取消和超时通过模拟传输测试，不声称已人为制造真实站点故障。

## 切换契约

以上 GET 是本期认证适配层的固定目标，不允许用户传入任意目标或重定向。POST 页面观察不再作为凭据提交依据，不允许兜底成页面跳转成功。可信身份只解析固定响应路径，不从 URL、Cookie、显示名或通用字段搜索推断。

同次快照为三种目标分别选择 Cookie，PASS_ID 必须相同；完整快照包含浏览器运行所需 origins。首次自动登记；已有账号自动核对绑定，不要求用户手填 ID。Plain JSON 与首次自动登记是本期批准的兼容性例外。

## 新版流程真实验收

2026-10-05（Asia/Shanghai）：用户扫码完成授权后，运行一次性验收脚本 scripts/accept-merchant-auth-migration.js（验收完成后已与协议探测脚本一并移除），真实网络验收退出码 0、ok=true、无 warnings。登录、独立 GET 检查、固定店铺身份和只读访问、临时文件绑定保存、普通命令执行前检查及执行后冻结材料重新验证/回写均通过。保存后 merchant_auth 的 verified 状态与店铺绑定一致。

验收只使用自身隔离浏览器与临时凭据，existing_accounts_changed=false，temporary_materials_deleted=true；不登记或替换现有账号，不输出真实店铺标识或凭据。认证后台已按用户要求移除，未启动后台进程。此结果仅覆盖 shop_read 及认证保存流程，不证明订单、商品或营销权限全部可用。
