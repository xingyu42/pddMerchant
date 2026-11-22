# 评价管理筛选参数与文本状态：只读实测

> 2026-11-22 17:09–17:18（Asia/Shanghai），默认商家账号。方法：通过仓库 `executeSingle`（`prepareCommandRuntime` + 账号租约 + CAS 回写，各轮均以 `ok: true`、`warnings: []` 退出）加载已保存登录态并访问 `/goods/evaluation/index`，读取已加载前端 bundle（`webpackJsonp_mfns_goods`），并使用 `executePageApiRequest` 只读重放 `POST /saturn/reviews/list`（间隔 `>= 1.2s`，全程只读、未触发写操作）。
> 脱敏：店铺 ID、商品 ID、商品名、订单号、买家昵称/头像、图片/音视频 URL 及买家手填正文均未记录，仅保留系统预设占位模板、字段形态与统计分布；原始抓包位于会话外部临时目录（不进 Git）。

---

## 一、前端筛选参数与占位文案逻辑（`webpackJsonp_mfns_goods`）

从 `/goods/evaluation/index` 页面已加载的微前端模块（`X68m`、`B95x`、`cfYS`）直接提取到筛选控件与列表渲染逻辑：

### 1.1 请求参数序列化（`X68m` `ae`）

前端筛选状态在 `contentFilter`、`replyFilter`、`starFilter` 中以 `"key-value"` 字符串定义：

| 前端分组 | 选项定义（`val`） | 页面标签 | 序列化后请求体字段 |
| --- | --- | --- | --- |
| `contentFilter` | `pictureStatus-1` | 有图片 | `pictureStatus: "1"` |
| `contentFilter` | `videoStatus-1` | 有视频 | `videoStatus: "1"` |
| `contentFilter` | `mainReviewContentStatus-1` | 主评有文字 | `mainReviewContentStatus: "1"` |
| `contentFilter` | `appendStatus-1` | 有追加评价 | `appendStatus: "1"` |
| `contentFilter` | `reportStatus-1` | 已举报 | `reportStatus: "1"` |
| `replyFilter` | `replyStatus-1` / `replyStatus-2` | 已回复 / 未回复 | `replyStatus: "1"` / `"2"` |
| `starFilter` | `descScore-1` .. `descScore-5` | 1–5 星 | `descScore: ["1", ...]` |

序列化函数 `ae` 对 `descScore`、`logisticsScore`、`serviceScore`、`selectedKeywordListPos`、`selectedKeywordListNeg` 收集为字符串数组；其余 `contentFilter` 与 `replyFilter` 按 `o[n[0]] = n[1]` 直接赋值，故线上传输为**字符串标量 `"1"` / `"2"`**。模块 `cfYS` 中的 `requestEvaluationList` 直接将组装后的 `searchParams` 提交至 `POST /saturn/reviews/list`。

页面初始化同时发出两类请求：先附带空/页面上下文条件，随后若无输入筛选则发送 `{ startTime, endTime, pageNo: 1, pageSize: 10 }`；列表提示文案仍为「共查询到 X 条数据（未包含默认评价）」。

### 1.2 占位文案与历史评分展示（`B95x`、`X68m`）

- **前端空正文兜底（`B95x` `qe(e, t)`）**：当 `e.comment` 为假值时，按 `Math.floor(e.descScore)` 渲染固定文案：
  - `1`：`该用户觉得商品稍有不足`
  - `2`：`该用户觉得商品不符合预期`
  - `3`：`该用户觉得商品一般`
  - `4`：`该用户觉得商品较好`
  - `5`：`该用户觉得商品很好，给出去了5星好评`
- **主评隐藏判定（`B95x` `Ye`）**：存在 `!e.comment && 1 === e.mainType` 分支用于判定纯系统主评区是否折叠。
- **历史评分判定（`X68m` `groupRowsConfig`）**：`0 !== score ? [score] : [descScore]`，仅当 `score !== 0` 时标签为「历史评分」，其余均为「用户评价分」。

---

## 二、近 180 天基线样本与字段形态（54 条）

在滚动 180 天窗口内执行无筛选查询（`pageNo: 1..2, pageSize: 40`），全店共返回 `54` 条评价（无截断）。

### 2.1 `result` 顶层与 `data[]` 关键字段观察

- **`result` 标量计数**：`totalRows: 54`、`showNum: 54`、`totalNum: 54`、`allReviewNum: 918`、`reviewNumThreeMonth: 51`、`reviewNumToday: 0`、`negNoReplyReviewNum: 0`、`goodsOrMallDsr: 4.8235...`。
- **相比既有适配层未提取但存在于 `data[]` 的关键字段**：
  - `reviewId`（`string`）：评价唯一 ID
  - `status`（`number`）：本次仅观察到 `2` 与 `4`
  - `mainType`（`number`）、`append`（`number`）、`appendNum`（`number`）
  - `video`（`null | object`）：含媒体 URL、宽高、时长、`size`、`handler`、`status`（本仓库仅允许统计存在性或数量，禁止输出 URL）
  - `audio`（`null | object`）：含音频 URL、`text`（`string`）、`duration`
  - `replyStatus`（`number`）、`replyHandler`（`number`）、`replyTime`（`number`）；未回复条目中 `reply` 为空字符串 `""`

### 2.2 按 `status` 分层分布（54 条全样本）

| `status` | 条数 | `descScore` 分布 | `score` | 文本分类 | 观测到的系统模板及频次 | 有图 / 有视频 / 有标签 / 有追评 | 实质内容评价规则留/剔（含 1–3 星兜底） |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `2` | 40 | `4`: 2，`5`: 38 | 全为 `0` | 买家自填长文本 39、短文本（2–4 字）1 | 无 | 34 / 4 / 32 / 0 | 保留 40 / 剔除 0 |
| `4` | 14 | `3`: 2，`4`: 3，`5`: 9 | 全为 `0` | 全为系统预设占位文案（14/14） | `该用户未填写文字评价`（2，对应 3 星）<br>`该用户觉得商品较好`（3，对应 4 星）<br>`该用户觉得商品很好，给出了5星好评`（9，对应 5 星） | 0 / 0 / 0 / 0 | 保留 2（3 星无文字）/ 剔除 12 |

实测要点：

1. **后端已预填充 `comment`**：所有 `status === 4` 条目的 `comment` 均为非空系统模板字符串，其中 5 星为「`给出`了5星好评」（与前端 `qe()` 兜底文案「`给出去`了5星好评」存在 1 字差异），3 星静默中评由后端返回「`该用户未填写文字评价`」。两套模板均需纳入确定性兜底识别。
2. **近 365 天追评探测**：追加执行 `{ startTime: end - 365d, endTime: end, appendStatus: "1" }` 返回 `totalRows: 0`，本店近 1 年无追评样本，未能直接观察 `appendReview` 非空时的对象/字符串实测结构；现有 `B95x` 渲染逻辑使用 `appendReview.comment` / `time` / `materials` / `appendTimeText`，且主评之外若 `appendNum > 0` 会由前端另行请求 `/saturn/reviews/append/list`。

---

## 三、只读筛选重放对照（同窗口 180 天，`pageNo: 1, pageSize: 40`）

| 查询条件 | `totalRows` | `showNum` | `totalNum` | 首页返回条数 | 首页 `status` 分布 | 说明 |
| --- | --- | --- | --- | --- | --- | --- |
| 无筛选（基线） | 54 | 54 | 54 | 40 | `2`: 33，`4`: 7 | 含 `status: 4` 中评（3 星）1 条（两页合计 2 条） |
| `mainReviewContentStatus: "1"` | 40 | 40 | 54 | 40 | `2`: 40 | 完整对齐全部 40 条 `status: 2`，全量剔除 `status: 4` |
| `appendStatus: "1"` | 0 | 0 | 0 | 0 | — | 验证服务端接受参数 `"1"`，无匹配时三计数字段均归 `0` |
| `mainReviewContentStatus: "1"` + `appendStatus: "1"` | 40 | 40 | 54 | 40 | `2`: 40 | 结果为 `40`（并集）且计入全部 `status: 2` |
| `mainReviewContentStatus: "1"` + `descScore: ["1","2","3"]` | 0 | 0 | 0 | 0 | — | 证明 `descScore` 与内容条件为 **AND 交集**，静默 3 星中差评被剔除 |
| `videoStatus: "1"` | 4 | 4 | 54 | 4 | `2`: 4 | 仅视频条目共 4 条 |
| `mainReviewContentStatus: "1"` + `videoStatus: "1"` | 40 | 40 | 54 | 40 | `2`: 40 | 40 与 4 组合仍返回 `40`（`min=4`、`union=40`），数学上坐实 `contentFilter` 组内为 **OR 并集** |

实测已确认的三项服务端行为：

1. **`contentFilter` 组内是 OR，`starFilter` 与 `contentFilter` 之间是 AND**：`mainReviewContentStatus`（40）与 `videoStatus`（4）同时传入返回 `40`，证明 `contentFilter` 各项做并集；`mainReviewContentStatus`（40）与 `descScore: ["1","2","3"]`（2）同时传入返回 `0`，证明星级与内容条件做交集。
2. **携带 `mainReviewContentStatus: "1"` 会丢失无正文 1–3 星中差评**：即使配合 `appendStatus: "1"` 并集，1–3 星中 `status === 4` 的条目（本样本 2 条「该用户未填写文字评价」）仍会被服务端排除。
3. **过滤条件下 `totalNum` 语义随结果集变化**：命中条目 `> 0` 时，`totalRows` / `showNum` 为过滤后总数（`40`），`totalNum` 保留窗口全量（`54`）；但命中条目为 `0` 时，`totalNum` 同步降为 `0`（见 `appendStatus: "1"` 与 `mainReviewContentStatus + descScore[1..3]`）。因此开启任何 `contentFilter` 服务端筛选时，若命中为 0，单次请求无法还原过滤前的真实平台 `total`。

---

## 四、对 `goods reviews` 确定性过滤与后续设计的结论

1. **服务端下推与无损边界（对应 Q8-1A）**：
   - 在保留 1–3 星中差评的默认 **Substantive Review（实质内容评价）** 模式下，全店或包含 1–3 星查询场景若下推 `mainReviewContentStatus: "1"` 会漏掉无文字中差评，且服务端在命中 0 条时会将 `totalNum` 清零从而丢失平台未过滤 `total`；此外上游无法直接按有效字符数（`--min-length`）、纯数字、纯标点/Emoji 或单字重复做服务端裁剪。
   - 因此，保持默认从 `/saturn/reviews/list` 拉取完整评价页（并在 `REVIEWS_LIST` 规范化阶段提取 `status` 与保留无敏感信息判定所需结构），随后在本地执行确定性过滤，能够完整保证：
     - 不遗漏无正文 1–3 星中差评；
     - 不因 `totalNum` 归零而丢失平台真实 `total`；
     - 在过滤前准确统计 `fetched_count` 与 `filtered_out_count`；
     - 本地即可一致处理纯数字、纯标点/Emoji、单字重复与 `--min-length <n>`（主评或追评文本）。
   - 若未来高评价量单品仅在 `--stars 4,5`（或仅文本 `--min-length`）场景考虑缓解 2000 条截断，才需评估服务端 `{ mainReviewContentStatus: "1", appendStatus: "1" }` + 未过滤首页取真实 `total` 的分路方案；现阶段在默认全星级场景下以纯本地无损过滤为基础契约。
2. **`status` 提取与系统占位识别**：
   - 建议在 `src/adapter/endpoints/reviews.js` 的 `review()` 规范化输出中增补内部可用整数字段 `status`（源自 `item.status`，允许缺省为 `null` 以兼容历史/精简 test fixture），不改变对外 `REVIEW_FIELDS` 白名单（外发 `items[]` 结构保持向后兼容）。
   - 占位判定同时覆盖 `status === 4` 与精确匹配已观测平台模板（后端 `该用户未填写文字评价` / `该用户觉得商品较好` / `该用户觉得商品很好，给出了5星好评` 及前端 `B95x` 同族 `该用户觉得商品稍有不足` / `该用户觉得商品不符合预期` / `该用户觉得商品一般` / `该用户觉得商品很好，给出去了5星好评`），避免仅依赖单一字段时因测试夹具未填 `status` 而漏判。
