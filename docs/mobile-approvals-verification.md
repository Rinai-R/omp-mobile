# 手机审批验收记录

日期：2026-11-25。交付工作区：`codex/complete-mobile-approvals`，基线已快进至 `fcc723c`（v0.8.7，包含 #100 后台下载修复）。本改动尚未发布。

## 环境与检查

- 未修改的正式 OMP 19.1.1；daemon 仅监听本机测试端口。
- Android 15 模拟器，独立测试包名 `com.rinai.ompaskprobe`，不覆盖正式应用。
- `npm test`：daemon 140 项、app 205 项，共 **345 项通过，0 失败**。
- `npm run typecheck` 通过；Android arm64 release 构建通过；`git diff --check` 通过。
- Android crash buffer 为空。测试结束后关闭临时 daemon/OMP，移除测试包并恢复正式应用。

## 实际操作与 OMP 回执

| 场景 | 观察结果 |
| --- | --- |
| 多字段 HTML 表单 | 单选、复选、数字默认值、禁用项及说明正常；OMP 收到 `route: direct, scope: [app], code: AB, replicas: 2`。 |
| Android 正则兼容 | 初始 `code: ab` 被 daemon 以 `Must match [A-Z]{2}` 拒绝，问题仍可编辑；改为 `AB` 后提交成功。 |
| 普通草稿恢复 | 修改验证码后强制结束测试 APK，重开仍显示 `AB`，且待处理表单和排队确认均保留。 |
| 排队确认 | 确认请求没有覆盖先发出的表单；表单提交后才展示确认，OMP 收到 `true`。 |
| 结构化 ask | 同一请求展示多选与单选问题；OMP 收到 `scope: [App, Daemon]`、`route: [Relay]`。 |
| Secret input | 输入显示掩码；强制退出后重开输入为空；显式取消后 OMP 收到取消结果。 |
| Editor | 显示预填 `Initial note`，提交后 OMP 收到该字符串。 |
| Select fallback | 已勾选 App 可见、动作 Done 可见；选择 Daemon 后 OMP 收到 `Daemon`。 |
| 普通 Input | 输入并提交后 OMP 收到 `Mobile input verified`。 |
| 图片与表格 | 本地 SVG、PNG 与内联 SVG 均实际渲染；表格显示 `scope / test only`；提交后 OMP 收到 `note: Reviewed`。本地 SVG/PNG 已在拆分后完整实测，内联 SVG 另在 v0.8.7 最终包实测。 |
| OMP 原有超时 | 1.5 秒确认问题自动关闭，OMP 收到 `false`，随后问题可继续处理。 |
| 缺图 | 不存在的图片出现失败提示，Submit 被禁用，取消仍可用；OMP 收到取消结果。 |

核心六类交互先在 `251ea28` 上完成实测；快进到 `fcc723c` 的变动仅涉及版本及后台更新下载，审批实现未变。之后重跑全部 345 项测试、类型检查与 release 构建，并用最终包再次验证图片、内联 SVG、超时和取消。

复验命令：`npm test`、`npm run typecheck`。Android 使用项目现有的 Expo/Gradle release 构建流程；实际操作按上表依次覆盖。


## 明确延后

选项备注（含备注图片）、输入续期及超时最新草稿，均不在本次客户端和 daemon 中启用，也没有相应的上传 API、活动消息或定制 OMP 启动器。它们独立走上游 PR，正式支持后再接入。表单原有的上下文图片继续支持。
