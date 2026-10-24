# Changelog

CI publishes the section that matches a pushed `v<version>` tag as the description of its GitHub Release. Write the section before tagging.

## Unreleased

- Long sessions open again. The daemon speaks OMP's RPC protocol v2 and reads messages in pages, so a session whose message list or a tool result is larger than 1 MiB no longer fails with "RPC response exceeded the transport limit" (#21).
- A session that fails to open no longer leaves an OMP process behind. That process kept the session's lock, so every later open was refused as "open in another omp process" naming the daemon's own child, and each retry added another one (#21).
- A session whose OMP process exited is started again when it is opened, instead of showing a session that cannot answer.
- When a session cannot open, the session socket now says why (`open_failed`) before it closes, and the daemon logs unexpected failures to `daemon.log`.
- The daemon accepts images with a prompt (`images` on the session socket's `prompt` frame) and hands them to OMP; `/hello` lists `features` (`prompt-images`), and live sessions report `waiting` questions (#23).
- A redesigned app in OMP's own look: Geist and JetBrains Mono, the π mark, a new icon (the π with a cyan "connected" dot, also as an Android 13 themed icon) (#23).
- The transcript folds each stretch of tool calls into one activity card that shows the step running now and sums itself up when done; tap a step for its command, diff and output. Long stretches list their newest steps and open the rest in a sheet. Thinking that only led into tool calls belongs to the card (#23).
- The chat stays on the newest message while it streams and stays put while you read back, with a jump to the newest; rows no longer animate in again when scrolled back into view (#23).
- Attach photos from the library or the camera; they are downscaled on the phone (longest side 1600 px) and sent with the message. A prompt the computer refuses is put back into the box (#23).
- Tap a chat's title to switch sessions: every computer's sessions, searchable, grouped as Needs you, Running, Today, Earlier and From the terminal (#23).
- The app opens on the computer used last; its home lists that computer's sessions in the same groups, with a computer card to switch or manage computers, and a New session sheet that offers recent folders. Back goes chat → home → out of the app (#23).
- Give a computer its own name on this phone; computers with the same host name are told apart by their address (#23).
- A session that cannot open says why (from `open_failed`, or over HTTP for older daemons) and stops reconnecting until you try again (#23).
- Images OMP left as `<N bytes>` placeholders no longer render as empty boxes (#23).
- `error` frames on the session socket name the `command` that failed. The app puts a message back into the box only when the computer refused that message, not after an unrelated error, and not after the link dropped (#24).

### 中文

- 长会话又能打开了。daemon 改用 OMP 的 RPC v2 协议并分页读取消息，消息列表或工具结果超过 1 MiB 的会话不再报 “RPC response exceeded the transport limit”（#21）。
- 打开失败的会话不再留下 OMP 进程。这个进程会一直占着会话锁，之后每次打开都被拒绝为 “open in another omp process”，而这个进程其实是 daemon 自己的子进程；每重试一次还会再多一个（#21）。
- OMP 进程已退出的会话，再次打开时会重新启动，不再显示一个无法回应的会话。
- 会话打不开时，会话 socket 会先说明原因（`open_failed`）再关闭；意外错误会写进 `daemon.log`。
- daemon 支持随消息发送图片（会话 socket 的 `prompt` 帧带 `images`），并转交给 OMP；`/hello` 返回 `features`（`prompt-images`），活跃会话会报告待回答的 `waiting` 数（#23）。
- App 按 OMP 自己的视觉重新设计：Geist 和 JetBrains Mono 字体、π 标志、新图标（带青色“已连接”圆点的 π，也提供 Android 13 主题图标）（#23）。
- 对话流把每一段连续的工具调用折叠成一张活动卡片：运行中显示当前步骤，完成后自动汇总；点某一步可查看命令、diff 和输出。很长的一段只列出最新的步骤，其余在面板中查看。只是为调用工具而做的思考归入卡片（#23）。
- 流式输出时对话停在最新消息，往上翻看时位置保持不动，并提供跳回最新的按钮；滚回来的行不再重复播放入场动画（#23）。
- 可以从相册或相机附加图片，在手机上压缩（最长边 1600 px）后随消息发送。电脑拒收的消息会放回输入框（#23）。
- 点对话标题切换会话：所有电脑上的会话，可搜索，按“需要你 / 运行中 / 今天 / 更早 / 来自终端”分组（#23）。
- App 打开时进入上次使用的电脑；首页按同样的分组列出它的会话，顶部的电脑卡片用于切换或管理电脑，新建会话面板提供最近用过的目录。返回键依次为 对话 → 首页 → 退出 App（#23）。
- 可以在手机上给电脑起名；主机名相同的电脑用地址区分（#23）。
- 打不开的会话会说明原因（来自 `open_failed`，旧版 daemon 则通过 HTTP 获取），并停止重连，直到你点“重试”（#23）。
- OMP 留下的 `<N bytes>` 图片占位符不再显示成空白方块（#23）。
- 会话 socket 的 `error` 帧会注明出错的 `command`。只有电脑拒收了这条消息时，App 才把它放回输入框；无关的错误或连接中断后不再放回（#24）。

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
