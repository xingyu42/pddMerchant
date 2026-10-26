# 上货抓取商品数据缓存 - 技术设计

## 1. 边界与原则

- 缓存属于 goods-publish 服务层，放在实时源商品抓取与后续类目/标题/表单处理之间。
- 不修改 `src/adapter/goods-publish/source-scraper.js`；该 adapter 继续只负责实时页面抓取和现有风控校验。
- 缓存只服务于一次上货失败后的重试；上货成功即清理，不缓存商家侧运费模板、类目解析、草稿、提交结果或图片二进制。
- fixture 模式继续使用 fixture，不接触本机缓存。
- 当前工作区在 `src/services/goods-publish.js`、source scraper 和表单模块存在未提交修改；实现只在 service 编排处做小块增量，不覆盖或回退现有改动。

## 2. 文件与职责

| 文件 | 职责 |
| --- | --- |
| `src/infra/paths.js` | 暴露默认缓存目录 `tmp/goods-publish-source-cache`。 |
| `src/services/goods-publish-source-cache.js` | 缓存键校验、白名单归一化、版本校验、读取、原子写入和按商品删除。 |
| `src/services/goods-publish.js` | 决定命中/未命中，在实时抓取成功后写入，并在整次上货成功后清理。 |

## 3. 缓存格式

每个 `goods_id` 一个 JSON 文件：

```json
{
  "version": 1,
  "goods_id": "918867803697",
  "cached_at": "2026-07-13T00:00:00.000Z",
  "source": {
    "goodsID": "918867803697",
    "goodsName": "...",
    "catID": "...",
    "catID1": "...",
    "catID2": "...",
    "catID3": "...",
    "price": "19.9",
    "carousel": ["https://..."],
    "skuText": "...",
    "properties": "...",
    "detailImgs": ["https://..."]
  }
}
```

规则：

- 文件名只使用 `parseGoodsUrl()` 已解析出的纯数字 `goods_id`，缓存模块仍再次校验，防止路径逃逸。
- 只复制上述白名单字段；以下划线开头的诊断字段和未知字段不落盘。
- 读取时要求 `version === 1`、文件内 `goods_id` 与键一致，并复用当前源数据必填、价格和 SKU 有效性检查。
- 文件权限尽量使用 `0600`；目录已在 `tmp/` 的忽略范围内。
- 写入先落到同目录唯一临时文件，再 `rename` 覆盖目标；并发时允许最后一次成功抓取覆盖前一次。

## 4. 数据流

```text
parse goods_id
  -> fixture mode? -> existing fixture path (no cache)
  -> read valid cache
       -> hit: skip cooldown / proxy config / consumer Context / source page
       -> miss or invalid: existing cooldown + proxy validation
  -> existing merchant template lookup
  -> cache miss: live scrape -> successful scrape -> best-effort atomic cache write
  -> existing category/title/form/draft/submit flow
       -> failure: keep cache for retry
       -> success: best-effort delete this goods_id cache
```

缓存读取必须早于 `scrapeCooldown.check()` 和 `readSourceProxyConfig()`。因此，缓存命中时即便当前处于源抓取冷却，或青果抓取配置暂时不可用，也不会阻止复用缓存。缓存只绕过消费者源抓取；商家认证、店铺选择、运费模板和草稿写入仍然执行。

## 5. 失败语义

- 文件不存在：普通未命中，实时抓取。
- JSON 损坏、版本不支持、ID 不一致或字段校验失败：记录不含商品内容和路径的诊断，按未命中处理。
- 缓存读取出现其他文件系统错误：按未命中处理，不让缓存优化阻塞上货。
- 实时抓取失败：不写缓存。
- 缓存写入失败：记录文件系统错误码，本次继续使用刚抓到的数据。
- 后续类目、表单、保存草稿或提交失败：保留缓存，下一次相同商品重试继续使用。
- 草稿模式保存成功或 `--confirm` 提交成功：删除当前商品缓存。
- 成功后的删除失败：不能回滚已经发生的平台写入，也不能把命令改报失败；增加 `source_cache_cleanup_failed` warning 并返回真实成功结果。

## 6. 可测试性

- 缓存模块的读写函数允许传入测试专用临时目录，单元测试不接触仓库真实 `tmp/` 缓存。
- service 优先使用 `ctx.sourceGoodsCache` 注入对象，否则使用默认缓存实现；与现有 `ctx.scrapeCooldown` seam 保持一致。
- service 测试通过计数断言缓存命中不会执行 cooldown、代理租约、消费者 Context 或 source scraper。

## 7. 兼容与回滚

- 不改变 envelope 顶层结构，也不新增正常命中的 warning。
- 不自动迁移旧数据，因为当前没有旧缓存格式。
- 回滚时删除 service 编排和缓存模块即可；已生成的 `tmp/` 忽略文件不影响旧版本运行，可由用户按需删除。
