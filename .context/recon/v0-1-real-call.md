# V0.1 真实调用回归 (2026-04-23)

- 机器：win32 x64
- Node：v22.17.0
- Headed：no
- orders.detail sn：`260423-526615846451614`

| # | 命令 | ok | exit | error.code | latency_ms | warnings | message |
|---|------|----|------|------------|------------|----------|---------|
| 1 | `shops.current` | ✅ | 0 | — | 16523 | 0 |  |
| 2 | `shops.list` | ✅ | 0 | — | 16580 | 0 |  |
| 3 | `doctor` | ✅ | 0 | — | 16712 | 0 |  |
| 4 | `goods.list` | ✅ | 0 | — | 18421 | 0 |  |
| 5 | `goods.stock` | ✅ | 0 | — | 18423 | 0 |  |
| 6 | `orders.list` | ✅ | 0 | — | 18518 | 0 |  |
| 7 | `orders.stats` | ✅ | 0 | — | 20078 | 0 |  |
| 8 | `orders.detail` | ❌ | 4 | E_RATE_LIMIT | 17050 | 0 | 操作太过频繁，请稍后再试！ |
| 9 | `promo.search` | ✅ | 0 | — | 19804 | 0 |  |
| 10 | `promo.scene` | ✅ | 0 | — | 19520 | 0 |  |
| 11 | `diagnose.orders` | ✅ | 0 | — | 19495 | 0 |  |
| 12 | `diagnose.inventory` | ✅ | 0 | — | 20502 | 0 |  |
| 13 | `diagnose.promo` | ✅ | 0 | — | 19681 | 0 |  |
| 14 | `diagnose.funnel` | ✅ | 0 | — | 18116 | 0 |  |
| 15 | `diagnose.shop` | ✅ | 0 | — | 21988 | 0 |  |
| 16 | `init` | ✅ | 0 | — | 26442 | 0 |  |

## 非 ok 明细

### `orders.detail` (exit=4)

```json
{
  "code": "E_RATE_LIMIT",
  "message": "操作太过频繁，请稍后再试！",
  "hint": "操作太过频繁，请稍后再试！"
}
```

```
[E_RATE_LIMIT] 操作太过频繁，请稍后再试！
hint: 操作太过频繁，请稍后再试！
```
