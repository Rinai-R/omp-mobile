# Changelog

CI publishes the section that matches a pushed `v<version>` tag as the description of its GitHub Release. Write the section before tagging.

## Unreleased

## v0.2.0

Model switching and a fuller transcript.

- Tap the model chip above the composer to pick any model in OMP's catalog, grouped by provider and searchable, and set the session's thinking level. The chips follow the session when either changes.
- The transcript shows images the user sent and images tools produce (screenshots, pictures the read tool opened). Inline images render directly; images OMP keeps in its blob store are served by the daemon at `GET /blobs/<sha256>`.
- Tool cards lead with OMP's intent line; `edit` calls open onto a line diff, and result images show without expanding.
- OMP's todo list appears above the composer, with the current task when collapsed; the composer also shows context usage and the number of queued messages.
- Compaction and automatic retries are reported in the transcript; Markdown tables render.
- The daemon answers `models`, `set_model`, `thinking_levels` and `set_thinking_level` on the session socket, and refreshes the state after model, thinking-level, todo and queue events instead of waiting for the turn to end.

### 中文

切换模型，以及更完整的对话记录。

- 点输入框上方的模型标签，可以从 OMP 的模型目录里选择模型（按 provider 分组、可搜索），并设置会话的思考等级。两者在会话里变化时，标签会跟着更新。
- 对话记录会显示用户发送的图片和工具产生的图片（截图、read 打开过的图片）。内联图片直接渲染；OMP 存在 blob 库里的图片由 daemon 的 `GET /blobs/<sha256>` 提供。
- 工具卡片优先显示 OMP 的意图说明；`edit` 调用展开后是逐行 diff；结果里的图片不用展开就能看到。
- 输入框上方会显示 OMP 的待办列表，收起时显示当前任务；输入框旁还会显示上下文用量和排队消息数。
- 上下文压缩和自动重试会在对话里说明；支持 Markdown 表格。
- daemon 在会话 socket 上支持 `models`、`set_model`、`thinking_levels`、`set_thinking_level`，并在模型、思考等级、待办和队列变化后刷新状态，不再等一轮结束。

## v0.1.1

- `omp-mobile` installs as an OMP plugin (`omp plugin install omp-mobile`). In OMP, `/mobile` starts the daemon in the background on the computer's Tailscale address and shows the pairing code above the composer until the phone connects. The daemon runs on the Bun inside OMP, so no Node.js is needed, and it keeps running after the terminal closes or OMP exits. `/mobile status` shows it, `/mobile stop` ends it.
- `omp-mobile --host tailscale` binds the computer's Tailscale IPv4 address without looking it up.

### 中文

- `omp-mobile` 可以作为 OMP 插件安装（`omp plugin install omp-mobile`）。在 OMP 里运行 `/mobile`，会在后台把 daemon 启动在电脑的 Tailscale 地址上，并在输入框上方显示配对二维码，直到手机连上。daemon 运行在 OMP 自带的 Bun 上，不需要 Node.js；终端关闭或 OMP 退出后它仍在运行。`/mobile status` 查看状态，`/mobile stop` 停止。
- `omp-mobile --host tailscale` 直接绑定电脑的 Tailscale IPv4 地址，不用自己去查。

## v0.1.0

The first release: the `omp-mobile` daemon on npm and the Android app.

- A native phone app for oh-my-pi: transcript with streaming text, thinking, Markdown and tool cards, a composer that prompts and stops, and OMP's own tool approvals and questions as a sheet that the turn waits for.
- `omp-mobile` runs on each computer, starts OMP sessions in RPC mode, and serves them on the computer's Tailscale address. Only your own Tailscale devices are admitted, and every request also needs the daemon's token.
- Pair a computer by scanning the QR code the daemon prints, opening its `omp-mobile://` link, or entering the address and token.
- Sessions started in a terminal on the computer are listed under **From the terminal** and continue on the phone; one still open in a terminal is marked and waits until that terminal exits.
- Android notifications for approvals, questions, and finished turns while the app is in the background, from a foreground service that watches every paired computer.
- Transcripts and session lists are kept on the phone, so a reopened chat shows at once, also offline.
- With more than one computer, tap the Sessions title to switch to another.

### 中文

首个版本：npm 上的 `omp-mobile` daemon 和安卓 App。

- oh-my-pi 的原生手机 App：对话记录支持流式文本、思考过程、Markdown 和工具卡片；输入框可以发送和停止；OMP 自己的工具审批和提问以面板形式出现，这一轮会等你回答。
- `omp-mobile` 运行在每台电脑上，以 RPC 模式启动 OMP 会话，并在电脑的 Tailscale 地址上提供服务。只放行你自己的 Tailscale 设备，每个请求还需要 daemon 的 token。
- 配对电脑：扫描 daemon 打印的二维码、打开它的 `omp-mobile://` 链接，或手动输入地址和 token。
- 电脑终端里开的会话列在 **From the terminal** 下，可以在手机上接着用；仍在终端里打开的会话会被标出，要等那个终端退出。
- App 在后台时，审批、提问和任务完成会发安卓通知，由一个监听所有已配对电脑的前台服务提供。
- 对话记录和会话列表保存在手机上，重新打开的对话立即显示，离线也能看。
- 有多台电脑时，点会话页标题切换到另一台。
