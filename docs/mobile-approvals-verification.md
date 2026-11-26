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

## 图片评审修复复验

- 在同一基线完成图片修复后，重跑 `npm test`：daemon **143** 项、app **208** 项，共 **351 项通过，0 失败**；类型检查、Android arm64 release 构建及 `git diff --check` 通过。
- 新增真实文件测试：拒绝工作目录外的绝对路径、file URL、父路径及越界符号链接，允许工作目录和显式 OMP blob 目录内的图片。
- 两项变异验证分别临时删除 select 选项成员检查和 remote URL skip：新增运行时测试均失败，恢复检查后通过。远程 URL 测试在工作目录中实际创建 URL 形状的本地文件，确保跳过分支被执行。
- 使用未修改的 OMP 19.1.1、Android 15 和独立测试包，打开包含远程 PNG/SVG、内联 SVG 外部引用、xlink/大小写/实体/控制空白变体、data SVG 及嵌套 data SVG 的表单。真实 HTTP logger 收到主机端控制请求，但手机打开、滚动和提交表单全过程没有图片请求。
- 本地 SVG 的 `viewBox`、渐变和文字仍正常显示；远程资源显示显式链接，点击后交给浏览器。浏览器首次启动页没有继续配置，因此不宣称完成浏览器实际下载。
- 远程占位没有禁用 Submit，提交后真实 OMP 收到 `{"data":{"answer":"Reviewed"}}`。Android crash buffer 为空。临时服务和测试包已移除，恢复正式应用，并关闭本轮启动的模拟器。

## 复审测试补充

维护者在 `a07f8d2` 合入主线 #102 文件下载后，补充两项非阻塞回归测试：非普通文件在读取字节之前被拒绝；真实文件恰好 8 MiB 可附加，超过一字节不附加。非文件测试观察真实目录的读取尝试，避免平台的目录读取异常掩盖 `isFile()` 检查缺失。分别临时删除 `isFile()` 和大小检查，新增测试均失败；恢复后通过。

合流后的 `npm test`：daemon **161** 项、app **217** 项，共 **378 项通过，0 失败**；`npm run typecheck` 和 `git diff --check` 通过。本轮仅增加测试与记录，不改运行逻辑，因此未重复设备验收或本地 Android 构建；上述 351 项及设备结果对应前一轮图片修复。


## 明确延后

选项备注（含备注图片）、输入续期及超时最新草稿，均不在本次客户端和 daemon 中启用，也没有相应的上传 API、活动消息或定制 OMP 启动器。它们独立走上游 PR，正式支持后再接入。表单原有的上下文图片继续支持。
