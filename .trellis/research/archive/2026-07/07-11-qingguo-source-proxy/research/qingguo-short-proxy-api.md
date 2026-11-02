# 青果短效代理 API 调研

调研日期：2026-07-11。

## 官方资料

- 开发者指南：https://www.qg.net/doc/developer/11_284/1927.html
- API概览：https://www.qg.net/doc/2145.html
- 按量提取接口：https://www.qg.net/doc/1851.html
- Node代码示例：https://www.qg.net/doc/sdk/9_230/1701.html

## 按量提取契约

```text
GET https://share.proxy.qg.net/get
```

参数：

- `key`：必填，产品唯一标识。
- `area` / `area_ex`：可选地区筛选。
- `isp`：可选运营商筛选，0不限、1电信、2移动、3联通。
- `num`：提取个数，默认1。
- `distinct`：去重提取，默认false。

默认频率限制为60次/分钟。首版设计只发送 `key`、`num=1`、`distinct=true`。

成功响应包含：

- `code=SUCCESS`
- `data[].server`：用于连接代理的地址和端口。
- `data[].proxy_ip`：真实出口IP，不应代替 `server`。
- `data[].area`、`data[].isp`、`data[].deadline`
- `request_id`：供应商排障标识。

## 认证模型

- 按量提取接口的 `key` 参数在青果产品侧命名为 `AuthKey`。
- 代理节点账号/密码鉴权为可选能力，首版不配置；Playwright proxy 只传 `server`。
- AuthKey 不拼接进日志或普通输出。

## 错误分类

- 认证/权限：`INVALID_KEY`、`UNAVAILABLE_KEY`、`ACCESS_DENY`、`API_AUTH_DENY`、`KEY_BLOCK`。
- 限频：`REQUEST_LIMIT_EXCEEDED`。
- 余额/额度：`BALANCE_INSUFFICIENT`、`EXTRACT_LIMIT_EXCEEDED`。
- 临时资源/操作：`NO_RESOURCE_FOUND`、`FAILED_OPERATION`、`INTERNAL_ERROR`。
- 参数：`INVALID_PARAMETER`。

## Node示例评估

官方示例使用 CommonJS 及 `http`、`request`、`superagent`、`axios + https-proxy-agent`。其中部分示例存在未定义变量、过时依赖或与本项目纯 ESM 不兼容的问题，因此只参考代理认证形式，不直接复制。实现不新增依赖，使用 Node 18 原生 `fetch` 提取代理，并使用 Playwright context proxy 访问目标页。
