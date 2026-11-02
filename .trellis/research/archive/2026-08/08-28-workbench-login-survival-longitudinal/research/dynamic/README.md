# 脱敏长期观察器

`observe-workbench-survival-redacted.ps1` 只观察已经存在或由人工自然启动的 Workbench。它不会启动、关闭或配置 Workbench，也不会读取 Profile 内容。

## 使用方式

先手工启动观察器，再按实验计划自然启动 Workbench：

```powershell
powershell.exe -NoProfile -File .\observe-workbench-survival-redacted.ps1 `
  -ObservationId t0-start `
  -SampleLabel checked-a `
  -BaselineUtc 2026-08-28T00:00:00Z `
  -OutputPath D:\Experiment\observations\t0-start.json `
  -DurationSeconds 120 `
  -Artifact 'profile-root=D:\Experiment\checked-a'
```

`-Artifact` 是可选数组，例如 `-Artifact @('profile-root=D:\\Experiment\\checked-a', 'marker=D:\\Experiment\\marker.txt')`。它只接受 `role=绝对路径`，输出只保留角色、存在性、文件/目录类型、修改时间和文件大小，不保留路径。`ObservationId`、`SampleLabel` 和角色都必须使用不含账号信息的代号。

## 解释限制

- `workbench_reached_without_observed_login` 只表示采样时没有看到登录窗口，不等于已经证明自动登录协议。
- `login_only` 只表示本次没有观察到进入工作台，不等于授权永久失效。
- `ambiguous_multiple_processes` 表示采样期间同时出现多个 Workbench 进程，结果按污染处理，不用于期限判断。
- 只有结合 checked/unchecked 对照、可证明 T0 和跨时点记录，才能判断长期存活。
- 不要把 Cookie、token、header、请求值、响应正文、账号信息、密钥、Profile 文件内容或内容哈希加入 `-Artifact` 之外的任何输出。
