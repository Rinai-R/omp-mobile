# Architecture

The phone never talks to OMP directly. Each computer runs the omp-mobile daemon, which starts OMP sessions as `omp --mode rpc-ui` child processes, keeps their state, and serves one HTTP and WebSocket API on the computer's Tailscale address. The app renders everything natively from that API.

```text
phone app ── Tailscale HTTP / WebSocket / SSE ──> daemon ── JSON lines on stdio ──> omp --mode rpc-ui
```

OMP is a terminal agent without a web server. Its RPC mode speaks JSON lines on stdin and stdout and emits the full session event stream; the daemon owns those processes so the phone does not need OMP's RPC details, and so a session keeps running while the phone is away.

The daemon negotiates OMP's RPC protocol v2 when `ready` offers it. Protocol v1 caps every frame at 1 MiB, so a long uncompacted session's message list or a large tool result would arrive as a transport-limit error; under v2 OMP splits such frames into `rpc_chunk` lines that the daemon reassembles (`daemon/src/rpc-frame.mjs`, up to 64 MiB), and messages are read with `get_messages_page`, as OMP's own RPC client does.

## `/mobile`

The npm package is also an OMP plugin (`package.json` `omp.extensions` → `daemon/src/omp-extension.mjs`). Its `/mobile` command, in the interactive OMP:

1. Reads `~/.omp-mobile/daemon.json`, which a running daemon writes (pid, URL, pairing link; mode 0600) and removes on a clean stop, and asks that daemon's `/status`.
2. If none answers, starts one: `omp daemon/src/server.mjs --host tailscale --cwd <OMP's cwd> --omp <omp on PATH> --no-qr` with `BUN_BE_BUN=1`, so it runs on the Bun inside OMP and needs no Node.js. It is detached into its own session with stdin closed and output appended to `~/.omp-mobile/daemon.log`, and it ignores `SIGHUP`, so closing the terminal or exiting OMP leaves it running. OMP sessions it starts do not inherit `BUN_BE_BUN`.
3. Shows the pairing QR code above the composer, and polls `/status` every 1.5 s. The code closes when a phone makes an authenticated request after it appeared ("phone connected from …"), after five minutes, or on `/mobile hide`. The extension's own polls send `x-omp-mobile-probe` so they do not count as a phone.

`/mobile status` reports the running daemon, `/mobile stop` sends it `SIGTERM` (then `SIGKILL` after 5 s). Outside the interactive TUI, `/mobile` reports the pairing link as a notice instead of drawing the code.

## Daemon options

`omp-mobile [options]` (from a checkout: `node daemon/src/server.mjs [options]`)

| Option | Default | Usage |
| --- | --- | --- |
| `--host <address>` | `127.0.0.1` | Bind address. Use the computer's Tailscale IP for a phone; `tailscale` picks this computer's Tailscale IPv4 address; a loopback address turns admission off. |
| `--port <port>` | `7390` | Listen port. |
| `--cwd <dir>` | the current directory | Working directory for a new session that names none. |
| `--omp <path>` | `omp` | OMP executable. |
| `--session-dir <dir>` | OMP's own | OMP session directory for the sessions this daemon creates. |
| `--omp-home <dir>` | `~/.omp` | OMP home whose sessions are listed as terminal sessions. |
| `--token <token>` | | Fixed bearer token. Otherwise `OMP_MOBILE_TOKEN`, else the token file, else a new 48-hex-digit token written there. |
| `--token-file <path>` | `~/.omp-mobile/token` | Where the token is kept (mode 0600). |
| `--registry-file <path>` | `~/.omp-mobile/sessions.json` | The sessions this daemon created, for resuming them after a restart. |
| `--state-file <path>` | `~/.omp-mobile/daemon.json` | Where the running daemon records its pid, URL and pairing link for `/mobile`. |
| `--auto-approve` | off | Passes `--auto-approve` to OMP; no tool approval reaches the phone. |
| `--approval-mode <mode>` | OMP's setting | Passes `--approval-mode` to OMP: `always-ask`, `always-ask-cached`, `write`, or `yolo`. |
| `--tailscale <path>` | `tailscale` | Tailscale CLI used for admission. On macOS the app bundle binary `/Applications/Tailscale.app/Contents/MacOS/Tailscale` is tried when `tailscale` is not on `PATH`. |
| `--no-whois` | off | Skips the user check of admission; the Host check and the token still apply, and a warning is printed. |
| `--no-qr` | off | Does not print the pairing QR code. |

At startup the daemon prints its address, the admission in effect, the token, and the pairing link `omp-mobile://pair?url=<address>&token=<token>`, followed by the same link as a QR code. The app's scanner accepts only a pairing code whose address is on the tailnet (100.64.0.0/10 or a `*.ts.net` name).

## Admission

On a non-loopback `--host` every HTTP request (including the public `/hello`) and every WebSocket upgrade is checked before the token, in this order:

1. **Host:** the `Host` header must name this node: the bind address, one of its Tailscale IPs, or its MagicDNS name, with or without a port. Anything else is answered `421` (DNS rebinding guard).
2. **User:** the source address (IPv4-mapped IPv6 normalized) must be a tailnet device whose `tailscale whois` user is this node's user from `tailscale status`. Another user's device, a tagged device (tagged devices have no user), or an address outside the tailnet is answered `403`. The node's own Tailscale IPs count as the same user. Whois answers are cached per address for 60 s, failures for 5 s.

Refusals are JSON `{"error": "<reason>"}` with the status; a refused WebSocket upgrade gets the HTTP status line and the socket is closed. If the `tailscale` CLI cannot be read on a non-loopback host, the daemon refuses to start unless `--no-whois` is given.

## HTTP API

Every route except `/hello` needs the token, as `Authorization: Bearer <token>` or `?token=<token>`. Errors are `{"error": "<reason>"}`.

| Route | Answer |
| --- | --- |
| `GET /hello` | `{name, os, version, protocol, sessionCount, cwd, user, features}`; `protocol` is `1`, `sessionCount` the live sessions, `user` the node's Tailscale login name or `null`, `features` what the daemon supports beyond protocol 1 (`prompt-images`: `prompt` frames carry images). The app offers a feature only to a daemon that lists it. |
| `GET /sessions` | `{sessions: [...]}`: live sessions, then dormant ones this daemon created, then terminal sessions. Each has `id`, `title`, `cwd`, `status` (`idle` or `streaming`), `model`, `createdAt`, `updatedAt`, `sessionFile`, `origin` (`daemon` or `omp`), `openElsewhere` when another omp process holds it, and for live sessions `waiting`: OMP questions and approvals still open. |
| `POST /sessions` | Body `{cwd?, prompt?}`. Starts a session in `cwd` (default `--cwd`), sends `prompt` if given; `201 {session}`, `400` when `cwd` is not a directory. |
| `GET /sessions/:id` | The session's snapshot `{session, state, messages}`, resuming it first if it is not live. `404` unknown, `410` session file gone, `409` held by another omp process. |
| `DELETE /sessions/:id` | Stops its OMP process and forgets it; the OMP session file stays. |
| `GET /events` | The attention stream (Server-Sent Events), see below. |
| `GET /blobs/<sha256>` | One image from OMP's content-addressed store (`<omp home>/agent/blobs`), typed from its bytes. |
| `GET /status` | `{pid, version, startedAt, url, liveSessions, eventStreams, lastPhone}`; `lastPhone` is `{address, at}` of the last authenticated request without `x-omp-mobile-probe`, or `null`. |
| `GET /sessions/:id/ws` | WebSocket upgrade, see below. |

### Session socket

On connect the daemon sends `{type: "snapshot", session, state, messages}`, then every OMP question still open as `{type: "approval", request}`. A session that cannot be opened (unknown, its file gone, held by another omp process, or OMP failing to start or load it) still completes the upgrade: the daemon sends `{type: "open_failed", status, error}` with the HTTP status the same request would get, and closes with code `4000`. After a successful open:

| From the daemon | Meaning |
| --- | --- |
| `event` | One OMP session event, unchanged. |
| `state` | OMP's session state after a turn, and after model, thinking-level, todo or queue changes. |
| `approval` | An OMP UI request (`select`, `confirm`, `input`, `editor`) waiting for an answer. |
| `approval_resolved` | `{id, reason}`: that request was answered by any client, cancelled by OMP, or closed with the process. |
| `notice` | `{level, message}` from OMP. |
| `closed` | `{reason, stderr}`: the OMP process exited. |
| `accepted`, `error`, `protocol-error` | The answer to a command, or a frame OMP sent that could not be read. |

| From the app | Effect |
| --- | --- |
| `{type: "prompt", text, images?}` | Sends OMP's RPC `prompt`; while a turn runs, OMP decides how it is queued. `images` are `{data, mimeType}` with base64 `data` and a JPEG, PNG, WebP or GIF type, at most 8 of at most 10 MB each; `text` may be empty when images are sent. A malformed image refuses the whole prompt. |
| `{type: "abort"}` | Stops the running turn. |
| `{type: "approval", id, value?, confirmed?, cancelled?}` | Answers an open request. |
| `{type: "refresh"}` | Asks for a fresh `state`. |
| `{type: "models"}` | Answers `{type: "models", models}`: the catalog as `provider`, `id`, `name`, `reasoning`, `input`, `contextWindow`, `cost`, `efforts`. OMP waits out model discovery, so the first answer can take a few seconds. |
| `{type: "set_model", provider, modelId}` | Switches the session's model, then broadcasts the new `state`; `set_model` also updates the registry's summary. |
| `{type: "thinking_levels"}` | Answers `{type: "thinking_levels", levels, current}` for the active model. |
| `{type: "set_thinking_level", level}` | Sets the session's thinking level and broadcasts the new `state`. |

## Rendering

The app folds the same OMP events into the transcript both live and from a saved one: a message per `message_start` / `message_end`, a tool item per `tool_execution_*` call keyed by `toolCallId`, and notices for compaction, retries and OMP's own `notice` frames. `app/src/rows.ts` then lays the items out as rows: per turn the user's bubble, one `omp` header, the prose, and each stretch of consecutive tool calls (with the thinking that only led into them) as one activity card. A running card is open and shows its live step; a finished one is closed and sums itself up by kind ("Edited 2 files, ran 3, read 4"). A step's line is OMP's `intent`, its target (command, path, pattern) and a short result (`+6 −2` from OMP's result diff, a line count, a run time); tapping it opens the full input, diff and output. The list is inverted, so it rests on the newest row while that row streams; scrolled up, it holds the rows in view and offers a jump back with the count of new rows.

Images arrive as `{type: "image", data, mimeType}`. Inline base64 becomes a data URI; `blob:sha256:<hash>` becomes the daemon's `/blobs/<hash>` route, which serves the store under `<omp home>/agent/blobs` to an authenticated client. The todo panel reads `state.todoPhases`, the context chip reads `state.contextUsage`, and queued messages come from `state.queuedMessages`.

## Sessions

- **Created by the daemon:** registered in the registry file and resumed with `omp --resume <file>` the first time one is opened after a daemon restart.
- **Terminal sessions:** the 50 most recently written OMP sessions under `<omp home>/agent/sessions`, titled by OMP's title slot, else the first prompt, else the directory. Opening one resumes it and it becomes one of the daemon's sessions.
- **Held elsewhere:** every writing omp process holds `<omp home>/run/session-owners/<id>.lock` open. The daemon reads these with `lsof`, marks such sessions `openElsewhere`, and answers a resume `409`, because a second omp on the same file saves to a new file instead of sharing it. Without `lsof` ownership is unknown and the resume goes ahead.
- Concurrent opens of one session share one OMP start. If the start or the first load fails, the daemon closes the OMP process it started, so no child of its own is left holding the session's lock.
- A live session whose OMP process exited is started again on the next open instead of being served dead.

## Approvals

Sessions run in `--mode rpc-ui`, so OMP's own tool approval (a `select` titled `Allow tool: ...`, as your OMP approval policy asks it) and any other OMP question reach the phone as a native sheet, and the turn waits for the answer. `--auto-approve` hands OMP's auto-approve through instead, and nothing is asked.

## Notifications

`GET /events` streams attention frames, one per line of `data:`:

```text
data: {"kind":"approval","key":"<request id>","sessionId":"…","sessionTitle":"…","machine":"<hostname>","text":"bash · Command: echo hi","time":…}
```

`kind` is `approval` (OMP's tool approval), `question` (any other open request), `resolved` (same `key`, answered by any client or cancelled), or `done` / `failed` when an agent run ends (`failed` on an `error` or `aborted` stop, or an error notice). A new stream first gets the requests still open, then `event: live`, then a `: ping` comment every 25 s.

On Android, **Settings → Notifications** asks for the notification permission (Android 13 and later) and starts a foreground service ("Watching N machines") that holds one stream per paired computer and reconnects with backoff and on network changes. Approvals and questions are posted heads-up on the "Approvals & questions" channel, finished turns on "Finished turns"; `resolved` withdraws the notification, nothing is posted for the session on screen, and a tap opens that chat. The service starts again after a reboot when notifications were on. While the app is open, a frame for another session shows as a banner. iOS has no background service; the module does nothing there.

## Language

The app's text lives in two catalogs, `app/src/i18n/en.ts` and `app/src/i18n/zh-CN.ts`, with the same keys and `{name}` placeholders (a test checks both); a counted message has `one` / `other` forms in English and one form in Chinese. The language follows the phone's locale (any `zh*` → Simplified Chinese, else English) unless **Settings → Language** picks one; the choice is stored with the settings, and a change re-renders the whole tree at once. The notification service composes its text natively, so the app hands it the strings in its language (`setStrings`), which it keeps for after a reboot and uses to rename its channels. Text from OMP and the daemon is shown as it arrives.

## Phone storage

- Paired machines and settings: AsyncStorage.
- Each session's transcript (the last 400 items, tool arguments and output cut to 4 000 characters, the 40 most recently saved sessions) and each machine's session list, under `<documents>/transcripts/`. A reopen shows them at once, also offline, until the daemon's snapshot arrives. Deleting a session drops its transcript; removing a machine drops everything kept for it.

## Not covered

- Tailscale peer discovery: computers are paired by QR code, link, or address and token.
- A relay for a phone that cannot reach the computer over Tailscale: the daemon is reachable only on its tailnet address.

## Source map

| Path | Holds |
| --- | --- |
| `daemon/src/server.mjs` | Options, HTTP and WebSocket API, session manager, token |
| `daemon/src/rpc-session.mjs` | One `omp --mode rpc-ui` process: JSON lines, requests, UI request answers |
| `daemon/src/admission.mjs` | `tailscale status` / `whois` wrapper, Host and same-user admission |
| `daemon/src/attention.mjs` | Attention frames from session broadcasts, `GET /events` |
| `daemon/src/omp-sessions.mjs` | OMP's sessions on disk and their owner locks |
| `daemon/src/qr.mjs` | Terminal QR code |
| `daemon/src/omp-extension.mjs` | The OMP plugin: `/mobile`, starting and stopping the background daemon, the pairing widget |
| `app/App.tsx` | Routes, machines, probing, notification wiring |
| `app/src/api.ts` | Daemon REST and the session socket |
| `app/src/messages.ts` | OMP events and stored messages to native transcript items |
| `app/src/probe.ts` | Machine reachability and its one-line summary |
| `app/src/pairing.ts` | Pairing link parsing and the tailnet check |
| `app/src/cache.ts`, `app/src/transcripts.ts` | What the phone keeps of transcripts and session lists, and where |
| `app/src/i18n/` | Catalogs, `t()`, the language preference and the phone's locale |
| `app/src/screens/` | Machines, Sessions, Chat, Settings, pairing scanner |
| `app/src/components/` | Transcript items, sheets, machine switcher, brand, shared UI |
| `app/modules/omp-attention/` | Expo local module (Kotlin): foreground service, notifications, boot receiver; `src/index.ts` is its JS API |
