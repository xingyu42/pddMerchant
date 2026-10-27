# Adapter Spec Index

Adapter 层隔离真实平台交互：Playwright 浏览器、XHR/fetch 捕获、endpoint specs、auth state、mall context、rate limit 与 fixture mock。上层 service 只能消费 adapter 返回的已映射结果或错误，不能依赖浏览器对象和 raw XHR 细节。

## 文件

| 文件                                                     | 内容                                                      | 使用场景             |
| -------------------------------------------------------- | --------------------------------------------------------- | -------------------- |
| [endpoint-xhr-contracts.md](./endpoint-xhr-contracts.md) | endpoint spec、XHR 捕获、business error、rate limit       | 新增/修改平台接口    |
| [auth-mall-context.md](./auth-mall-context.md)           | auth state、账号、mall context 解析/切换；密码重登与熔断（第 9 节） | 登录、店铺、账号隔离、自动重登 |
| [fixture-mode.md](./fixture-mode.md)                     | `PDD_TEST_ADAPTER=fixture`、mock dispatcher、fixture 命名 | 测试 seam、离线 e2e  |
| [browser-runtime.md](./browser-runtime.md)               | Patchright 启动、Context、主世界 evaluate、清理            | 浏览器运行时与页面执行 |

## Pre-Development Checklist

- [ ] 明确改的是真实浏览器路径还是 fixture 路径；两者的 envelope 语义必须一致。
- [ ] endpoint spec 的 `name` 与 fixture 文件命名保持一致。
- [ ] raw 平台响应只在 adapter/service normalizer 边界处理，不泄露到 command。
- [ ] business error 同时兼容 camelCase 和 snake_case 字段。
- [ ] 涉及 auth/mall 时确认不输出 cookie、Anti-Content、authorization 或二维码内容。
- [ ] Patchright `page.evaluate()` 若依赖页面全局、React expando 或站点包装的 fetch，必须通过 `evaluateInMainWorld()`。

## Quality Check

- [ ] 真实平台失败映射到 `PddCliError` / `ExitCodes`，没有 ad-hoc error shape。
- [ ] Rate limit/cooldown 行为可测试，避免真实等待。
- [ ] Same-URL sequential endpoint 调用使用独立页面或能保证 XHR 再次触发。
- [ ] fixture 模式不启动浏览器，不读取真实 auth state，仍保留命令执行契约。
