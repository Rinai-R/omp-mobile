# Changelog

CI publishes the section that matches a pushed `v<version>` tag as the description of its GitHub Release. Write the section before tagging.

## Unreleased

## v0.8.5

- The launch screen follows the app's appearance setting. With the app set to dark on a phone in light mode (or the other way round), it used to open on the phone's scheme and then switch, a bright flash on every start; Android now keeps the app's choice and draws the launch screen in it (Android 12 and later).

### 中文

- 启动画面跟随应用里的外观设置。以前手机是浅色、应用设为深色（或反过来）时，启动先按手机配色显示再切换，每次打开都闪一下亮色；现在 Android 会记住应用的选择，启动画面直接用这套配色（Android 12 及以上）。

## v0.8.4

Updates open in their own sheet, with what changed in every version the phone skipped.

- A newer release is checked for on launch and each return to the app, and shown in a sheet: the new version, every release since the installed one newest first with its date and notes (in the app's language; GitHub's generated pull-request list is left out), and the download size on the button. The download runs as a progress bar in the button's place; a re-check while it runs or after it finished keeps it.
- After allowing installs in Android's settings, coming back continues the install by itself. An APK already downloaded and verified is not fetched again after the app restarts.
- A release whose APK is still being uploaded is not listed yet. Settings shows "Update to …" with a dot while an update waits, and opens the sheet.
- Launching the app shows the OMP mark on the app's own background, light or dark, instead of a placeholder grid flashing white.
- The agent is called oh-my-pi in the app ("What should oh-my-pi do?", "Message oh-my-pi"), the app OMP Mobile, the computer's process omp; the shouty "OMP" is gone.

### 中文

- 有新版本时会弹出更新面板：新版本号、从当前版本起每个跳过的版本（最新在前，带日期和说明，按应用语言显示，不含 GitHub 自动生成的 PR 列表），下载按钮上标出大小。下载时按钮原位变成进度条；下载中或下载完再检查一次也不会丢掉进度。
- 在 Android 设置里允许安装后返回，安装会自动继续。已下载并校验过的 APK 在应用重启后不会重复下载。
- APK 还在上传中的版本暂不列出。有更新等待时，设置页显示「更新到 …」和小圆点，点按打开面板。
- 启动时显示 OMP 标志，背景与应用一致（浅色或深色），不再闪过一张白底的占位网格图。
- 应用里对 agent 的称呼改为 oh-my-pi（「想让 oh-my-pi 做什么？」「给 oh-my-pi 发消息」），应用本身叫 OMP Mobile，电脑上的进程叫 omp，不再到处是大写的「OMP」。

## v0.8.3

A conversation held by a terminal on the computer can be read from the phone before taking it over.

- Opening a session another omp process holds used to show only "this session is running in a terminal" and take-over, with the conversation blank unless the phone had it cached. The daemon now builds the transcript from the session file itself (its last 400 messages, with the count of the ones before so indices still line up), and the phone fetches it when the live connection is refused. The history reads normally; take-over is still offered, and the live transcript replaces the copy once it opens.

OMP Mobile can now update itself from its GitHub releases (thanks @tingQian).

- Settings checks once a day, and on demand, for a newer release; a newer version offers its APK, downloaded in the app and checked against the SHA-256 GitHub publishes before Android's installer sees it. Release history is one tap away.
- Android asks once for permission to install updates from OMP Mobile; the system installer still confirms every install and checks the signature.

### 中文

OMP Mobile 现在可以从 GitHub 发布页更新自己（感谢 @tingQian）。

- 设置页每天自动检查一次，也可以手动检查；有新版本时提示下载 APK，在应用内下载，并用 GitHub 公布的 SHA-256 校验后才交给 Android 安装器。发布记录一键打开。
- Android 会询问一次"允许 OMP Mobile 安装应用"；每次安装仍由系统安装器确认并校验签名。

- 被电脑上终端占用的会话，现在能在手机上先读再决定是否接管。以前点开只显示"会话正在终端中运行"和接管按钮，手机没缓存过时对话是空的；现在 daemon 直接从会话文件生成记录（最后 400 条，并带上前面被略过的条数，保证序号仍对得上），手机在实时连接被拒时取这份记录。历史照常阅读，接管按钮仍在，接管成功后实时记录会覆盖这份副本。

## v0.8.2

- Swiping on a command's output no longer scrolls the chat the wrong way. The output was a small box that scrolled on its own; inside the chat it passed the swipe on reversed. It now shows the last 12 lines, with the whole output one tap away.
- Opening a chat, switching to another app and coming back no longer leaves the chat and the session list each half on screen. The animation library is updated past a bug where animated views showed a stale frame after the app was paused, and the screen stack settles itself whenever the app goes to the background or returns, also halfway through a swipe back. Sheets and the attention banner likewise always settle.
- Back with the photo menu open closes the menu instead of leaving the chat.
- A chat you scrolled up in reopens where you left it, also when OMP has written more since (the newer part waits below, behind the jump-to-newest button). A chat left at its newest message, a search hit, and the first open after starting the app still open at the newest message.

### 中文

- 在命令输出上滑动，聊天不再往反方向滚。之前命令输出是一个能单独滚动的小框，嵌在聊天里会把滑动方向反着传出去；现在直接显示最后 12 行，完整输出点一下查看。
- 打开聊天后切到别的应用再切回来，不会再出现聊天和会话列表各占半屏。动画库升级，修掉了应用暂停后动画视图停在旧画面的问题；页面栈在应用进入后台或回到前台时都会自动归位，右滑返回到一半时切走也一样。弹窗和顶部提醒同样总会归位。
- 照片菜单打开时按返回，先关闭菜单，不再直接退出聊天。
- 往上翻过历史的聊天，返回后再进入会停在原来的位置；期间有新内容也一样（新内容在下方，点"跳到最新"可到达）。停在最新处离开的聊天、从搜索结果打开、以及应用启动后第一次打开，仍从最新消息开始。

## v0.8.1

- Header, composer and tab bar are solid again, in the page's own colour. The blurred bars of v0.8.0 came out grey and white, with bright bands at the screen edges, on some phones.

### 中文

- 顶栏、输入区和标签栏恢复为不透明、与页面同色。v0.8.0 的毛玻璃在部分手机上显示成灰白色，屏幕两侧还有亮边。

## v0.8.0

The app moves and looks like a native one: screens slide and swipe back, sheets follow your finger, chrome is glass, and the moments that matter get a beat of their own.

- Chat, settings and the scanner slide in over the tabs and swipe back from the left; a short slow drag snaps back, a flick goes back.
- Sheets follow your finger, close on a downward flick and can be caught while closing; the keyboard no longer makes the layout jump.
- Header, composer and tab bar are blurred glass that content scrolls under; Sessions, Computers and Settings have large titles that collapse into the bar as you scroll.
- Tool calls in a turn are one grouped list instead of a stack of cards.
- A new session opens on a brand hero; a sent message flies from the composer into place; a finished turn ticks over to a check with a haptic; pairing a computer ends on a short celebration.
- The phone vibrates only when something happens: OMP asks for an approval, a turn you watched finishes, a computer pairs. Tapping tabs, filters and buttons, sending and swiping are silent.
- With reduced motion on, all of this fades instead of moving.

### 中文

应用的动效和外观更接近原生：页面滑入、右滑返回，弹窗跟手，顶栏和底栏是毛玻璃，关键时刻有专门的反馈。

- 聊天、设置、扫码页从右侧滑入，从左边缘右滑返回；慢拖一小段会弹回，快速一甩就返回。
- 弹窗跟手拖动，向下一甩即关闭，关闭途中可以再抓住；键盘弹出不再让布局跳动。
- 顶栏、输入区、标签栏是毛玻璃，内容从下面滚过；会话、电脑、设置页是大标题，滚动时收进顶栏。
- 同一轮的工具调用合成一个分组列表，不再是一叠卡片。
- 新会话显示品牌主视觉；发送的消息从输入框飞到对话里；一轮结束时状态图标变成对勾并伴随震动；配对电脑成功有一段简短的庆祝动画。
- 只在有事发生时震动：OMP 请求批准、你正在看的一轮结束、电脑配对成功。点标签、筛选和按钮，发送消息，滑动手势都不再震动。
- 开启"减少动态效果"后，以上都改为淡入淡出。

## v0.7.4

Long replies stream smoothly over the relay, and a chat opened mid-reply shows what was already written.

- Long replies no longer stutter or drop the relay connection ("Relay consumer is too slow", #73). OMP sends the whole message so far twice with every token, so a 600-word reply cost the phone about 4 MB; the daemon now forwards only what each token adds (about 80 KB for the same reply), and the chat applies the events that arrive within one frame in a single render (#74, thanks @tingQian).
- Opening a chat while OMP is writing shows the reply written so far, then continues it; before, it appeared only once finished.

### 中文

长回复经中继也能流畅输出，中途打开的聊天会显示已写出的部分。

- 长回复不再卡顿，也不再导致中继连接断开（"Relay consumer is too slow"，#73）。OMP 每输出一个 token 都会附带两份到目前为止的完整消息，一篇 600 词的回复要传约 4 MB 给手机；现在守护进程只转发每次新增的内容（同样的回复约 80 KB），聊天页把同一帧内到达的事件合并成一次渲染（#74，感谢 @tingQian）。
- OMP 正在输出时打开聊天，会立即显示已写出的部分并继续输出；之前要等整条说完才出现。

## v0.7.3

Replies without a bubble, and a live activity in OMP's own style that shows the current step and the plan's progress.

- OMP's replies no longer sit in a bubble: they read as page text, at the same width as before, in light and dark alike (in dark the bubble was nearly invisible anyway).
- The live activity has its own look: while a session runs it shows what OMP is doing now (the tool call's intent, e.g. "Running tests"), and when the session has a todo plan the bar is that plan's progress, one segment per phase along OMP's magenta → violet → cyan gradient with the OMP mark as its tracker and "3/7" in the status-bar chip; without a plan the chip counts up over an indeterminate gradient bar. Waiting for an approval it turns magenta. The daemon sends the step and plan progress on its `running` frames.

### 中文

回复不再有气泡，实时活动换成 OMP 自己的样式，显示当前步骤和计划进度。

- OMP 的回复不再放在气泡里：作为页面正文显示，宽度和以前一样，深浅色一致（深色模式下原来的气泡本来就几乎看不见）。
- 实时活动换成了自己的样式：会话运行时显示 OMP 正在做的事（工具调用的意图，例如"Running tests"）；会话有 todo 计划时，进度条就是计划的完成进度，每个阶段一段，沿 OMP 的品红 → 紫 → 青渐变着色，用 OMP 标志作进度指示，状态栏胶囊里显示"3/7"；没有计划时，胶囊计时，下面是不定进度的渐变条。等待审批时变为品红色。守护进程在 `running` 帧里附带当前步骤和计划进度。

## v0.7.2

`omp-mobile restart` to put the running daemon on a new version safely, and no more xd:// mount notices in the chat.

- `omp-mobile restart` restarts the running daemon on the installed code with the arguments it was started with, once no session is running a turn (`--now` skips the wait). A detached process does the work, so it can be run from one of the daemon's own sessions, for example by an agent after `omp plugin upgrade omp-mobile`, without cutting that session off before the new daemon is up. `GET /status` reports `busySessions`.
- The chat no longer shows OMP's "xd://: mounted mcp__…" notice each time a session opens: it tells the model which MCP tools it can use and is not meant for a reader.

### 中文

用 `omp-mobile restart` 安全地把运行中的守护进程换到新版本，聊天里不再出现 xd:// 挂载通知。

- 聊天里不再在每次打开会话时显示 OMP 的 "xd://: mounted mcp__…" 通知：那是告诉模型有哪些 MCP 工具可用的，不是给人看的。
- 新增 `omp-mobile restart`：用当前安装的代码、按原来的启动参数重启正在运行的守护进程，等没有会话在运行时再重启（`--now` 不等待）。重启由一个独立的后台进程完成，所以可以在守护进程托管的会话里执行，例如 agent 在 `omp plugin upgrade omp-mobile` 之后执行，不会在新守护进程起来之前把这个会话切断。`GET /status` 新增 `busySessions`。

## v0.7.1

Your message shows the moment you send it, queued messages show what they say, and a session's subagents can be opened from the chat.

- Your message shows in the chat the moment you send it ("Sending…"), instead of only when OMP echoes it back, which over the relay could take seconds and arrive together with the answer. OMP's copy takes its place when it comes.
- Queued messages show what they say: a message you send while OMP is busy reads "Queued" on its bubble until OMP takes it, and messages queued from elsewhere (the terminal, another phone) are listed above the field instead of an "n queued" count.
- See what subagents do: open a "Delegate to subagents" step in a chat and it lists the subagents that call started, each with its status (running, done, failed, stopped); tap one to read its whole transcript with the chat's own rows, kept up to date while it runs. A subagent's own delegations open the same way. The daemon reads OMP's subagent session files (`GET /sessions/:id/subagents`, `GET /sessions/:id/subagents/:agent`), so it works for sessions whose omp has exited too, and asks a live omp which ones still run; the session socket sends a `subagent` frame as one starts or ends. Needs this daemon version (`subagents` feature).

### 中文

发送的消息立即显示，排队的消息能看到内容，聊天里可以打开会话的子代理。

- 发送后你的消息立即出现在聊天里（显示"发送中…"），不再等 OMP 回传；之前经中继时可能要等几秒，和回复一起出现。OMP 的回传到达后替换它。
- 排队的消息能看到内容：OMP 忙时你发的消息气泡上显示"排队中"，直到 OMP 接收；从别处（终端、其他手机）排队的消息列在输入框上方，不再只显示"n 条排队中"。
- 可以看到子代理在做什么：在对话里打开“交给子代理”这一步，会列出这次调用启动的子代理及其状态（运行中、已完成、失败、已停止）；点开任一个即可用对话同样的样式查看它的完整记录，运行中会持续更新。子代理自己再委派的子代理也能这样打开。daemon 读取 OMP 的子代理会话文件（`GET /sessions/:id/subagents`、`GET /sessions/:id/subagents/:agent`），所以 omp 已退出的会话也能看，并会向运行中的 omp 询问哪些还在跑；子代理开始或结束时会话 socket 会发送 `subagent` 帧。需要本版本的守护进程（`subagents` 功能）。

## v0.7.0

Search sessions by what was said in them, fork a session or a message, a real live activity in the status bar, Sessions / Computers / Settings as tabs, messages that reach OMP mid-run, and a dark mode switch.

- The in-app "island" capsule is gone. In its place, a real **live activity**: while a session runs or waits for you, one ongoing notification shows it, with a running clock, or "Approve · bash · npm test" while it waits; tapping it opens the session, and it disappears when nothing runs. On Android 16 it becomes a Live Update in the status-bar chip and on the lock screen (HyperOS, ColorOS and MagicOS show it in their islands) once you allow Live Updates for OMP (Settings → Live activity). It needs background notifications on, and this daemon version (`/events?live=1`).
- Sessions, Computers and Settings are now three tabs under one tab bar, with the same large titles and grouped lists, instead of separate pages with a back button.
- The chat no longer shows Send while a run started elsewhere (the terminal, another phone) is still going: it follows OMP's run start and end, not each turn's, so a message sent then is passed to OMP mid-run. If the computer runs an omp-mobile older than 0.6, which cannot pass it, the chat says so and keeps your text.
- The Sessions tab opens on the computer instead of a large "Sessions" title: its name, whether it is online, and the switcher behind it; the settings gear at the top is gone (Settings is a tab). Computers and Settings use the same smaller title.
- Settings → Appearance: Same as phone, Dark or Light. The app followed only the phone's setting until now, so with the phone in light mode there was no way to get the dark look.
- Search finds sessions by what was said in them, not only by title: the search field on the Sessions tab asks the computer, which looks through every OMP session file on it (titles and messages; thinking and tool output are not searched), and each result shows the message that matched. Tapping it opens the session at that message. Needs this daemon version; with an older one the field searches titles, folders and models as before.
- Session rows lose their coloured letter tiles: title, folder and age, with a badge when a session waits for you.
- Fork a session: long-press it on the Sessions tab to fork the whole session, or long-press one of your messages in a chat (or tap the fork button under a reply) to fork from there. The fork is a new session that opens right away; the original file is only read, so a session a terminal omp holds can be forked without taking it over.

### 中文

按会话内容搜索，分叉会话或从某条消息分叉，状态栏里真正的实时活动，会话 / 电脑 / 设置改为标签页，运行中发的消息能送达 OMP，以及深色模式开关。

- 按会话里说过的内容搜索，而不只是标题：会话页的搜索框会让电脑在它上面所有的 OMP 会话文件里查找（标题和消息；不搜思考过程和工具输出），每条结果显示匹配到的那句消息，点开直接跳到那里。需要本版本的守护进程；旧版本下仍只按标题、目录和模型搜索。
- 会话列表去掉了彩色首字母图标：只显示标题、目录和时间，等你处理时显示角标。
- 分叉会话：在会话页长按会话可分叉整个会话；在聊天里长按你发的一条消息（或点回复下方的分叉按钮）可从那里分叉。分叉出的新会话会立即打开；原会话文件只读不写，所以终端里 omp 正占用的会话也能分叉，无需接管。
- 会话页顶部不再是大号"会话"标题，改为显示当前电脑：名称、是否在线，点它切换电脑；去掉了右上角的齿轮（设置已是标签页）。电脑和设置页使用同样较小的标题。
- 设置 → 外观：跟随系统、深色或浅色。之前 App 只跟随手机设置，手机是浅色模式时就没法用深色外观。
- 去掉了 App 里的"灵动岛"胶囊，换成真正的**实时活动**：有会话在运行或等你处理时，一条常驻通知显示它，运行时带计时，等待时显示"待批准 · bash · npm test"；点一下打开该会话，没有会话在跑时自动消失。在 Android 16 上，允许 OMP 的"实时更新"后（设置 → 实时活动），它会显示在状态栏胶囊和锁屏上（HyperOS、ColorOS、MagicOS 会显示在各自的灵动岛里）。需要开启后台通知，并使用本版本的守护进程（`/events?live=1`）。
- 会话、电脑、设置改为同一个底部标签栏下的三个标签页，使用相同的大标题和分组列表，不再是带返回按钮的独立页面。
- 在终端或其他手机上发起的运行还没结束时，聊天页不再显示"发送"：它跟随 OMP 整次运行的开始和结束，而不是每一轮，所以此时发的消息会在运行中传给 OMP。如果电脑上的 omp-mobile 低于 0.6、不支持运行中插话，聊天页会提示并保留你输入的文字。

## v0.6.0

A new iOS-flavoured look, approvals answered straight from the home, and OMP's own English shown in the phone's language.

- A message sent while OMP is working is no longer refused ("Agent is already processing") and handed back to the composer: it is queued as a steer, as Enter does in the terminal, shows as a queue chip, and OMP takes it at its next step.
- A new look, iOS-flavoured on OMP's aurora colours. The home has a large "Sessions" title, a search field, All / Active / Terminal segments, sessions as a grouped list with a coloured tile per project, a tab bar and a round white New button; while a session runs, a capsule at the top shows it and opens it. The chat has a centred navigation bar, gradient bubbles for your messages and soft bubbles for replies, each tool call as a card (the running one framed in the brand gradient with its terminal output open), a turning orb while OMP thinks, and an iMessage-style composer. Approvals open as an action sheet with the command in a code block and Deny in red. Sending, answering and switching tap the phone's motor.
- Approve from the home: a session waiting for a tool approval shows as a card at the top of the home, and **Allow** approves that one call without opening the session (`POST /sessions/:id/answer`; the session list carries the waiting request). Needs this daemon version; with an older one, approve in the chat as before.
- OMP's own English is shown in the phone's language: approval prompts ("Allow bash?"), their labels (Command, Path, Content…), its answers (Allow once, Allow bash for this session, Deny…) and thinking levels. Commands, paths and code stay as sent; approval notifications leave out the English labels.
- A session now lists as running as soon as its turn starts, not only after the state is next read.

### 中文

全新 iOS 风格外观，在首页直接批准，OMP 自带的英文按手机语言显示。

- 全新外观：iOS 风格，配 OMP 的极光配色。首页有"会话"大标题、搜索框、全部 / 进行中 / 终端分段，会话以分组列表显示、每个项目一个彩色方块，底部标签栏和白色圆形新建按钮；有会话在运行时，顶部胶囊显示它，点一下打开。聊天页是居中的导航栏，你的消息是渐变气泡、回复是柔和气泡，每次工具调用一张卡片（运行中的带品牌渐变描边并展开终端输出），思考时显示转动的光球，输入框为 iMessage 样式。审批以操作面板弹出，命令显示在代码块里，"拒绝"为红色。发送、回答和切换时手机会轻震。
- 在首页直接批准：等待工具审批的会话在首页顶部显示为卡片，点**允许**即可放行这一次调用，不用打开会话（`POST /sessions/:id/answer`；会话列表会带上等待中的请求）。需要本版本的守护进程；旧版本下照旧在聊天里批准。
- OMP 自带的英文按手机语言显示：审批提示（"允许运行 bash？"）、其中的标签（命令、路径、内容…）、回答选项（允许一次、本会话都允许 bash、拒绝…）和思考强度。命令、路径和代码保持原样；审批通知不再带英文标签。
- 会话一开始运行就在列表中显示为运行中，而不是等下一次读取状态后。
- OMP 正在运行时发送的消息不再被拒绝（"Agent is already processing"）并退回输入框：它会像终端里按回车一样作为插话（steer）排队，显示为排队标签，OMP 在下一步时接收。

## v0.5.1

Reach your computer without Tailscale: the omp-mobile daemon pairs with your phone through the open-source ds-harness-remote relay, end-to-end encrypted.

- Reach your computer without Tailscale, through the public relay of [ds-harness-remote](https://github.com/liguobao/ds-harness-remote) (`https://dsh.r2049.cn`) (#59). The omp-mobile daemon registers with the relay as a device of its own (no account, no DSH): `/mobile relay` in OMP, or `omp-mobile --relay` then `omp-mobile relay pair`, shows a pairing code; the phone scans it (or takes the pasted link in **Enter address**), shows the computer's key fingerprint and an 8-digit code, and the computer asks for that code. The phone then reaches the daemon end to end encrypted (Noise IK, each side pinned to the other's key); the relay only forwards ciphertext. Over it runs the same daemon API as on the tailnet, so everything works the same: sessions, transcripts, streaming, tool cards, approvals, model and thinking changes, photos, background notifications and taking over a terminal session. These computers are labelled **Relay** in the computers list. Removing one on the phone ends the pairing on the relay; `omp-mobile relay status` lists paired phones and `omp-mobile relay revoke <id>` removes one. Tailscale works as before.

### 中文

不用 Tailscale 也能连上电脑：omp-mobile 守护进程通过开源的 ds-harness-remote 中继与手机配对，端到端加密。

- 不用 Tailscale 也能连上电脑：通过 [ds-harness-remote](https://github.com/liguobao/ds-harness-remote) 的公共中继 `https://dsh.r2049.cn`（#59）。omp-mobile 守护进程以自己的设备身份注册到中继（不需要账号，也不经过 DSH）：在 OMP 里用 `/mobile relay`，或运行 `omp-mobile --relay` 后执行 `omp-mobile relay pair`，会显示配对码；手机扫码（或在 **Enter address** 粘贴链接），显示电脑的密钥指纹和 8 位验证码，再在电脑上输入该验证码。之后手机与守护进程之间端到端加密（Noise IK，双方互相固定密钥），中继只转发密文。上面跑的是和 Tailscale 上完全相同的守护进程接口，所以功能都一样：会话、聊天记录、流式回复、工具卡片、审批、切换模型和思考等级、图片、后台通知、接管终端会话。这类电脑在电脑列表里标为 **中继**。在手机上移除即在中继上解除配对；`omp-mobile relay status` 列出已配对手机，`omp-mobile relay revoke <id>` 移除其中一部。Tailscale 照常可用。

## v0.5.0

Not published: its tag exists, but no npm package or GitHub Release was made. What it contained (pairing with DSH as the computer) was replaced in v0.5.1 by the relay below.

## v0.4.4

A session the phone takes over hands the terminal the command that resumes it, and opening a chat no longer reorders Home.

- A session the phone takes over now leaves the terminal with the command that brings it back, as leaving omp by hand does: the session file is printed with `omp --resume <path>` (quoted when it needs to be), and the same hint is in the notice omp shows just before it closes (#52).
- Opening a chat no longer moves it to the top of Home. A session's recency follows the conversation: sending a prompt and receiving a message count, while opening the session (which resumes its omp and makes it emit lifecycle events), changing its model or its thinking level do not (#53).

### 中文

- 手机接管会话后，终端会像手动退出 omp 一样给出恢复命令：打印会话文件路径和 `omp --resume <路径>`（必要时加引号），omp 关闭前的提示里也有同一条命令（#52）。
- 打开对话不再把它顶到首页最前面。会话的新旧只看对话本身：发送提示和收到消息算一次使用；打开会话（会恢复 omp 并产生生命周期事件）、切换模型或思考等级都不算（#53）。

## v0.4.3

Chats open instantly from a 24-hour cache kept in sync, download only what is new, and read as one calm conversation.

- Opening a chat downloads only what is new (#42). The app tells the daemon how much of the transcript it already holds (`since`, and a fingerprint of the last message), and the snapshot carries only the messages after it; when the copies do not line up, it carries everything, as before. A new `GET /sessions/:id/transcript` answers the same without ever starting an omp: a live session from memory, a closed one from the transcript the daemon saves when its omp exits (idle, the daemon stopping, omp leaving), as long as the session file has not changed since. Saved transcripts are kept while their session was active in the last 24 hours. Daemons list this as the `transcript-sync` feature.
- Every session active in the last 24 hours stays cached on the phone and up to date, so chats open at once (#43). The cache holds the daemon's own messages, state and summary instead of rendered items, kept by time (no 40-session or 400-item limit, no clipped tool output). With a daemon that has `transcript-sync`, the app refreshes stale copies in the background, one at a time and only with what is new: after the session list loads, every minute in the foreground, when it comes back to the foreground and when a chat is left. A chat paints the end of its copy first (transcript, model, todos), in the same time whatever the session's length, then merges the daemon's delta and puts the rest of the copy under it; a delta that does not fit is fetched again whole, never spliced. The old item caches are deleted.
- The chat is one calm conversation column (#44, #47). OMP's turn has no bubble, avatar or name: it opens with a one-line divider that says how it ended and how long it took ("Done in 3m 12s", "Failed", "Stopped"; while it runs, what OMP is doing now in a brand-gradient shimmer and the time so far), and tapping the divider folds the turn's work away, leaving the answer. The work is quiet grey one-line rows: each stretch of tool calls is named by the kinds of work it did, not by counts ("Ran commands", "Read files, edited files, ran commands"); it opens in place onto one row per call (kind, a short summary, a diff stat), and a call opens in place onto its command output in a capped terminal block, its diff with coloured edge bars, or the first lines of what it read, with the full call one tap away. Thinking is a "Thought" row that opens in place onto compact grey text. The reply is prose straight on the page, closed by a copy button and the time; the user's message is a right-aligned rounded bubble on a tinted surface. Replies are set at 15/24 with bold headings and generous space above them, close list items, tables with horizontal hairlines only and roomy cells (flush with the prose; a table that nearly fits is pulled in, a wide one scrolls), code blocks as a soft rounded panel labelled with the language or "Code", soft-wrapped by default, with a wrap toggle and a copy button, inline code as a light tint, links in cyan. Text follows the system font size within per-kind caps (prose further than code), rows grow instead of clipping, and table columns and list numbers are measured at the current size. A row opened by a tap keeps its header in place, and the jump to the newest message is a small circle (a pill when it counts new messages). Radii follow one scale (8 / 12 / 16 / 20 / 28).
- Release review fixes (#48):
  - A streaming reply no longer shows its first words twice. omp 18 writes each event's message out late, so `message_start` already carries words whose deltas follow; updates now settle the deltas against the event's own content, for text and thinking alike.
  - Attaching the older part of a cached chat under its tail, or a snapshot arriving mid-turn, no longer wipes the reply that is streaming, the prompt just sent or a running tool card.
  - Sessions are dated by their last real use. Closing omp (a daemon restart, the idle reaper, a resume) rewrites the session file, which made every session it had open look used "now", reordered Home and kept their copies longer; opening a session or a state echo no longer counts either. The daemon remembers the file as its own omp left it and counts a newer file time only when someone else wrote it.
  - The phone's copy is appended to, not rewritten: messages are kept one per line, written off the JS thread, and a delta no longer parses and rewrites the whole multi-MB copy (about 200 ms of work per delta on a 4.9 MB copy, now about 1 ms). Older copies are converted at their next save.
  - The background pass skips the chat on screen (it saves its own copy), sweeps expired copies after every pass, and a list asked for by Home and the computer's probe at once is fetched once.
  - Past the daemon's 5,000-message cap a live session keeps the transcript's own indices, so deltas still line up instead of resending everything on every open.
  - A chat whose computer cannot be reached says so after 5 s, says it shows the saved copy, and turns sending off until the link is back.
  - The model sheet's search field and the composer's model chip grow with large system font sizes; changing the font size no longer drops you out of the chat.
  - Computers with the same name are told apart by address on Home and in the remove confirmation, and a non-tailnet address is labelled LAN instead of Tailscale.

### 中文

对话从保持同步的 24 小时缓存中即开即显，只下载新增内容，并以一条安静的对话流呈现。

- 打开对话只下载新增的部分（#42）。App 告诉 daemon 自己已有多少条消息（`since`，以及最后一条消息的指纹），快照就只带其后的消息；两边对不上时照旧发送全部。新增 `GET /sessions/:id/transcript`，返回同样的内容，且从不为此启动 omp：活动会话从内存返回，已关闭的会话从 omp 退出时（空闲回收、daemon 停止、omp 自行退出）保存的记录返回，前提是会话文件此后没有变化。保存的记录在会话最近 24 小时内有活动时保留。daemon 以 `transcript-sync` 功能声明这一点。
- 最近 24 小时内有活动的会话都缓存在手机上并保持最新，对话即开即显（#43）。缓存保存的是 daemon 的消息、状态和会话摘要，而不是渲染后的条目，按时间保留（不再限 40 个会话、400 条，也不再截断工具输出）。对支持 `transcript-sync` 的 daemon，App 在后台逐个刷新过期的副本，只取新增部分：会话列表加载后、前台时每分钟、回到前台时、离开对话时。打开对话先显示缓存的末尾（记录、模型、待办），无论会话多长都一样快，再合并 daemon 的增量并补上缓存中更早的部分；对不上的增量会重新整份获取，绝不拼接出错的记录。旧的条目缓存会被删除。
- 对话改为一条安静的对话流（#44、#47）。OMP 的回合不再有气泡、头像或名字：开头是一行分隔线，说明这一轮如何结束、用了多久（“已完成，用时 3分12秒”“处理失败”“已停止”；运行中显示 OMP 正在做什么，带品牌渐变的流光，以及已用时间），点它可以收起这一轮的过程，只留下回答。过程是一行一行的灰色小字：每段连续的工具调用按做了哪类事命名，不写次数（“执行了命令”“读取了文件、修改了文件、执行了命令”），点开在原处列出每次调用（类别、简短摘要、改动行数）；每次调用又可在原处展开为限高的终端输出、带彩色边条的 diff，或读取内容的开头几行，完整内容一点即达。思考是一行“思考”，点开在原处显示紧凑的灰色文字。回复是直接排在页面上的正文，末尾是复制按钮和时间；用户消息是右侧带浅色底的圆角气泡。回复正文 15/24，标题加粗且上方留白充足，列表项紧凑，表格只有水平细线、单元格宽松（与正文对齐；差一点放得下的表格会收进栏内，宽表格横向滚动），代码块是一块柔和的圆角面板，标注语言或“代码”，默认自动换行，带换行切换和复制按钮，行内代码是浅色底，链接为青色。文字跟随系统字号，各类文字有各自上限（正文放大得比代码多），行高随之增长而不被裁切，表格列宽和列表序号按当前字号计算。点开某一行时它的标题保持原位；跳到最新消息的按钮是一个小圆钮（有新消息时变为显示条数的胶囊）。圆角统一为 8 / 12 / 16 / 20 / 28。
- 发布评审修复（#48）：
  - 流式回复不再把开头几个词显示两遍。omp 18 写出事件里的消息较晚，`message_start` 已经带有随后才发增量的文字；现在每次更新都把增量与事件自带的内容对齐，正文和思考都一样。
  - 把缓存对话较早的部分接到末尾之下，或在一轮进行中收到快照时，不再清掉正在流式输出的回复、刚发出的消息或正在运行的工具卡片。
  - 会话按最后一次真正使用的时间排序。omp 关闭时（daemon 重启、空闲回收、恢复会话）会重写会话文件，过去这会让它打开过的每个会话都显示为“刚刚”使用、打乱首页顺序并延长其缓存；打开会话或状态回显也不再算作使用。daemon 会记下自己的 omp 退出时文件的样子，只有别人写过文件时才把更新的文件时间算作活动。
  - 手机上的副本改为追加而不是重写：每行一条消息，在 JS 线程之外写入，增量不再解析并重写整份几 MB 的副本（4.9 MB 的副本每次增量约 200 ms 的工作降到约 1 ms）。旧格式的副本会在下次保存时转换。
  - 后台同步跳过正在显示的对话（它自己保存副本），每轮之后清理过期副本；首页和电脑探测同时请求会话列表时只请求一次。
  - 超过 daemon 的 5,000 条消息上限后，活动会话仍使用整份记录的序号，增量依然对得上，不会每次打开都重发全部。
  - 连不上电脑时，对话会在 5 秒后说明无法连接、当前显示的是保存的副本，并在恢复连接前停用发送。
  - 系统字号较大时，模型面板的搜索框和输入框下的模型标签会随之变大；修改字号不再把你带离对话。
  - 同名的电脑在首页和移除确认中按地址区分；不在 tailnet 上的地址显示为“局域网”而不是 Tailscale。

## v0.4.2

Chats open several times faster, and no longer say "connecting" on a phone that is already connected.

- A chat's snapshot is a fraction of its size. Screenshots and other images in it are kept on the computer and sent as references the app loads when they scroll into view, a tool result's details carry only what the app shows (an edit's diff, a read's line count, a command's run time), and the session socket is compressed. A long session went from 5.8 MB to 0.8 MB on the wire, and its saved copy on the phone shrinks with it.
- The chat header follows the session, not the computer. While the link is up and the daemon is starting the session (an omp resumes, a long transcript arrives), it says "opening…"; the first second of a chat shows no status word at all, so a session that opens in milliseconds does not flash a message. "connecting…" now means the socket really has not opened.

### 中文

对话打开快了数倍，已经连上的手机也不再显示“连接中”。

- 对话快照只剩原来的一小部分。其中的截图等图片留在电脑上，以引用发送，滚到时 App 再加载；工具结果的 details 只保留 App 会显示的内容（编辑的 diff、读取的行数、命令的耗时）；会话连接启用压缩。一个长会话在网络上从 5.8 MB 降到 0.8 MB，手机上保存的副本也随之变小。
- 对话页标题下的状态改为跟随会话而不是电脑。连接已经建立、daemon 正在打开会话（恢复 omp、传输较长的记录）时显示“打开中…”；刚进入对话的一秒内不显示状态词，毫秒级打开不会闪一下提示。“连接中…”只在连接确实还没建立时出现。

## v0.4.1

A session that cannot start says so at once, a busy link stops reconnecting in circles, and a quiet one is noticed.

- A session that cannot open fails fast. When omp could not start — its working directory was deleted, the binary was gone — the daemon waited out its 45 s start timeout and answered with a bare 500, and the phone retried while the WebSocket handshake hung. The reason now comes back immediately, and the app shows it.
- A session whose directory was removed (a session in `/tmp`) has that directory recreated, instead of never opening.
- The session socket opens before the daemon has started its omp. A phone's WebSocket client gave up after about 10 s and retried, starting another omp each time; the transcript now arrives on the open socket when it is ready, and a session that cannot open still says why and stops retrying.
- Session sockets are beaten every 20 s. A client that misses a beat is dropped, and the app treats a link with no frame for 60 s as gone and reconnects: an idle session no longer dies silently behind a phone network's NAT.
- Listing sessions reuses one scan of OMP's session directory and one owner lookup for a few seconds, so the app's 15 s probe no longer re-reads hundreds of session files every round.
- Taking a session over waits less: the extension answers within a second or two, OMP leaves on `SIGINT` promptly, and the signal fallbacks are 5 s each instead of 10 s.
- A session no phone has looked at for 30 minutes is closed and its omp process freed; opening it again resumes it.

### 中文

打不开的会话现在会立刻说明原因，忙时不再反复重连，闲时也能发现断链。

- 打不开的会话会立即失败。omp 起不来时（工作目录被删、二进制不存在），daemon 以前会等满 45 秒启动超时再返回一个裸的 500，期间 WebSocket 握手一直挂着，手机就不断重连。现在原因立刻返回，并在 App 里显示。
- 工作目录已被删除的会话（比如 `/tmp` 下的会话）会自动重建目录，而不是永远打不开。
- 会话的 WebSocket 在 daemon 拉起 omp 之前就完成握手。手机的 WebSocket 客户端大约 10 秒就放弃并重试，每次重试又起一个 omp；现在记录准备好后通过已建立的连接推过来，打不开的会话也仍会说明原因并停止重试。
- 会话连接每 20 秒有一拍心跳，漏拍的连接会被断开；App 侧超过 60 秒没有任何帧就当作断链并重连：空闲会话不再被手机网络的 NAT 悄悄掐断。
- 列会话时会复用同一次目录扫描和同一次占用查询几秒钟，App 每 15 秒的探测不再每轮重读几百个会话文件。
- 接管会话等待更短：扩展一两秒内就会响应，OMP 收到 `SIGINT` 会很快退出，信号兜底也从每个 10 秒缩短为 5 秒。
- 30 分钟没有手机查看的会话会被关闭并释放 omp 进程，再次打开时自动恢复。

## v0.4.0

Chinese and English, replies that read well, thinking that stays, taking over a terminal's session, and less text on every screen.

- The app speaks Chinese and English. It follows the phone's language (any Chinese → Simplified Chinese, anything else → English); Settings → Language overrides it (System / 中文 / English), and the switch applies at once. Screens, sheets, empty states, the app's own errors, accessibility labels, relative times and the notifications the app posts are translated; what OMP and the computer send (model names, tool output, their errors) is shown as it is (#26).
- Take over a session that omp in a terminal on the computer has open. OMP lets one process write a session, and a second one would save to a new file, so the two cannot share it; instead the chat offers **Take over**, says when the terminal is mid-turn, and after you confirm the daemon asks that omp to close (through the omp-mobile plugin if it is loaded there, else with `SIGINT`, then `SIGTERM`, never `SIGKILL`), tells the terminal where the session went, and opens it here with nothing lost or forked. New route `POST /sessions/:id/takeover`; held sessions name their `owner` (#28).
- Replies read better on a phone: 16/26 body text that keeps mixed Chinese and English comfortable, a clearer heading scale, and spacing tuned between paragraphs, lists, code and tables (#27).
- Fuller Markdown in replies: nested bullet and numbered lists (numbered lists keep their start), task lists, nested block quotes, ~~strikethrough~~, bare and `<…>` links, images as links, escapes, and tables whose columns size to their text and scroll sideways (#27).
- Code blocks show their language and a copy button, scroll sideways, and render while the closing fence is still streaming. Code is set in JetBrains Mono NL, so `=>` and `!=` show as typed, not as ligatures (#27).
- Thinking no longer disappears when a message ends or a chat is reopened. A reply's thinking folds into a "Thought for 12s" row that opens inline; thoughts between tool calls stay in their activity card (#27).
- An activity card watched while it ran stays open after the turn ends, and "Show all" lists every step inline; tap a step for its details as before (#27).
- Larger user bubbles and softer notices in the transcript (#27).
- The daemon closes its OMP processes the way Ctrl+C does (SIGINT, then SIGTERM, waiting for each) and no longer kills them, so a turn being saved is not cut off; on exit it waits for them to save their sessions (#33).
- Live session titles no longer start with an empty box where OMP put a Nerd Font icon (#33).
- Less text on every screen; the layout says it instead. Gone: captions under the Notifications switch, the About tagline, the hints in the New session, Add computer and scanner screens, the footnote and online count on Computers, the chat's empty-state paragraph, and labels that repeated a title or an icon. Computers get a ⋯ button for their details instead of a long-press hint; the current computer is checked instead of marked "here" (#32).
- Closing a session, removing a computer and taking a session over are confirmed in the app's own sheet instead of a system dialog (#32).

### 中文

中英双语；更好读的回复；思考内容不再消失；可以接管终端里的会话；每个界面的文字更少。

- App 支持中文和英文。默认跟随手机语言（任何中文 → 简体中文，其他 → 英文）；可在“设置 → 语言”中改为 跟随系统 / 中文 / English，切换后立即生效。界面、面板、空状态、App 自己的错误提示、无障碍标签、相对时间以及 App 发出的通知都已翻译；OMP 和电脑发来的内容（模型名、工具输出、它们的错误信息）保持原样（#26）。
- 可以接管电脑终端里 omp 正打开着的会话。OMP 只允许一个进程写一个会话，第二个进程会另存为新文件，所以两边无法同时打开；对话页改为提供 **接管**，并提示终端是否正在执行一轮对话。确认后 daemon 请那个 omp 关闭（若它加载了 omp-mobile 插件则由插件关闭，否则依次发送 `SIGINT`、`SIGTERM`，从不 `SIGKILL`），在终端里说明会话去了哪里，再在手机上打开，记录不丢失也不分叉。新增 `POST /sessions/:id/takeover`；被占用的会话会给出 `owner`（#28）。
- 回复在手机上更好读：正文 16/26，中英文混排更舒服；标题层级更清楚；段落、列表、代码和表格之间的间距重新调过（#27）。
- 回复支持更完整的 Markdown：多级无序/有序列表（有序列表保留起始编号）、任务列表、多级引用、~~删除线~~、裸链接和 `<…>` 链接、图片显示为链接、转义字符；表格列宽随内容调整，可横向滚动（#27）。
- 代码块显示语言和复制按钮，可横向滚动；结尾的 ``` 还没输出时也能正常显示。代码改用 JetBrains Mono NL，`=>`、`!=` 按原样显示，不再合成连字（#27）。
- 消息结束或重新打开对话后，思考内容不再消失。回复的思考折叠为一行“思考了 12 秒”，点开即在原处展开；工具调用之间的思考留在所属的活动卡片里（#27）。
- 运行时看着的活动卡片在这一轮结束后保持展开，“显示全部”会在卡片内列出所有步骤；点某一步仍可查看详情（#27）。
- 对话中用户气泡字号更大，提示条更柔和（#27）。
- daemon 关闭自己的 OMP 进程时改用 Ctrl+C 的方式（先 SIGINT，再 SIGTERM，每次都等待），不再强杀，正在保存的回合不会被截断；退出时会等它们保存好会话（#33）。
- 运行中会话的标题不再以空白方块开头（那是 OMP 放的 Nerd Font 图标）（#33）。
- 每个界面的文字都更少，由布局来说明。去掉了：通知开关下的说明、“关于”里的标语、新建会话 / 添加电脑 / 扫码页的提示、电脑列表的脚注和在线计数、对话空状态的说明段落，以及重复标题或图标含义的标签。电脑列表每行改为 ⋯ 按钮查看详情，不再提示长按；当前电脑用勾号标出，不再写“当前”（#32）。
- 关闭会话、移除电脑和接管会话改用 App 自己的底部面板确认，不再弹系统对话框（#32）。

## v0.3.0

A redesigned app in OMP's own look, photos for the agent, a session switcher across computers, and long sessions that open again.

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

App 按 OMP 自己的视觉重新设计；可以给 agent 发图片；可以跨电脑切换会话；长会话又能打开了。

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
