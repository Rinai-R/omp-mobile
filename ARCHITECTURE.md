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

`/mobile status` reports the running daemon, `/mobile stop` sends it `SIGTERM` (then `SIGKILL` after 25 s: the daemon first closes its omp processes, each with `SIGINT`, then `SIGTERM`, so they save their sessions). Outside the interactive TUI, `/mobile` reports the pairing link as a notice instead of drawing the code.

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
| `GET /hello` | `{name, os, version, protocol, sessionCount, cwd, user, features}`; `protocol` is `1`, `sessionCount` the live sessions, `user` the node's Tailscale login name or `null`, `features` what the daemon supports beyond protocol 1 (`prompt-images`: `prompt` frames carry images; `takeover`: `POST /sessions/:id/takeover`; `heartbeat`: a `ping` frame every 20 s; `transcript-sync`: delta snapshots and `GET /sessions/:id/transcript`; `session-search`: `GET /sessions/search`; `fork`: `POST /sessions/:id/fork`; `subagents`: `GET /sessions/:id/subagents` and the `subagent` frame; `files`: `GET /sessions/:id/files` and `GET /sessions/:id/file`). The app offers a feature only to a daemon that lists it. |
| `GET /sessions` | `{sessions: [...]}`: live sessions, then dormant ones this daemon created, then terminal sessions. Each has `id`, `title`, `cwd`, `status` (`idle` or `streaming`), `model`, `createdAt`, `updatedAt`, `sessionFile`, `origin` (`daemon` or `omp`), `openElsewhere` when another omp process holds it with `owner` `{pid, busy, terminal}` (`busy`: mid-turn by the session file's last message; `terminal`: it has a controlling terminal), and for live sessions `waiting`: OMP questions and approvals still open, and `request` `{id, method, title, message?, options?}`: the oldest of them, which the home shows as an approval card. A session counts as `streaming` from OMP's `agent_start` until the state read after `agent_end`. |
| `POST /sessions` | Body `{cwd?, prompt?}`. Starts a session in `cwd` (default `--cwd`), sends `prompt` if given; `201 {session}`, `400` when `cwd` is not a directory. |
| `GET /sessions/search?q=&limit=` | `session-search`. `{results: [{session, match}]}`, at most 50: sessions whose id, title, directory or user/assistant message text holds every whitespace-separated word of `q`, case-insensitive (thinking, tool calls and tool results are not searched). Exact titles first, then titles holding every word, then the rest newest first, as OMP's `/resume` picker ranks. `match` is `{kind: "title"}` or `{kind: "message", role, timestamp, snippet}` (the message holding the most words, newest of equals). Covers every `*.jsonl` under `<omp home>/agent/sessions/*/` and this daemon's own session files, not only the newest the list shows; each file is read whole once and what it holds (message text only; tool-result lines are skipped before parsing) is kept while its size and modification time stay the same, so a repeat search reads only files written since. |
| `POST /sessions/:id/fork` | `fork`. Body `{at?: {role: "user" \| "assistant", timestamp}}`. Starts a new session from this one, beside its file, with the daemon's omp: without `at`, `omp --fork <file>` of the whole session; with `at`, the path from the root to that message (through the tool results of its tool-call batch, labels dropped) is first written to a private temporary copy that keeps the original header, then forked, and the source's artifact directory is copied to the fork's. The source file is only read, so a session a terminal omp holds forks without a takeover and stays byte-for-byte unchanged. `201 {session}`, `404` unknown session or no such message, `410` session file gone, `400` malformed `at`. |
| `GET /sessions/:id` | The session's snapshot `{session, state, messages}`, resuming it first if it is not live. `404` unknown, `410` session file gone, `409` held by another omp process (with `owner`). |
| `POST /sessions/:id/takeover` | Body `{device?}`. Takes the session from the omp process that holds it (see Sessions), then opens it: the snapshot plus `takeover: {pid, via, waitedMs, busy, forks}`, `via` being `extension`, `SIGINT`, `SIGTERM`, `exited`, `free` (nobody held it) or `live` (already the daemon's). `504` when the holder did not exit (it keeps the session), `409` when the holder is not omp, `503` without `lsof`. Concurrent takeovers of one session share one attempt. |
| `GET /sessions/:id/transcript?since=&last=` | `transcript-sync`. The session's transcript `{session, state, from, total, messages}` (see delta snapshots below), **without starting an omp**: a live session answers from memory, a closed one from the transcript saved when its omp exited, while its session file still has the modification time and size it had then. Otherwise `404 {"error": "not cached"}`. |
| `GET /sessions/:id/subagents` | `subagents`. `{subagents: [...]}`, **without starting an omp**: every subagent transcript OMP stored beside the session file (a session `<dir>/<name>.jsonl` keeps its subagents at `<dir>/<name>/<AgentId>.jsonl`, theirs one level deeper under `<dir>/<name>/<AgentId>/`; `__advisor*` transcripts are not subagents), parents before their children. Each has `id` (the slash-joined path, `Scout/Helper`), `agentId`, `parent`, `agent` and `task` (the agent type and the start of the assignment, from its `session_init`), `status`, `messageCount`, `updatedAt`, and while it runs `description` and `parentToolCallId`. `status` is `running` while the live omp's RPC `get_subagents` lists it, else `aborted` (a `.tombstone` beside it, or a last reply that was aborted or never finished), `failed` (a last reply that errored) or `completed`; an omp that cannot answer `get_subagents` leaves an unfinished one `running`. `404` for a session the daemon does not know. |
| `GET /sessions/:id/subagents/:agent?since=&last=` | `subagents`. `{subagent, from, total, messages}` for the URL-encoded `id` from the list: its message entries in file order, slimmed as a snapshot's, and only those after `since` when `last` fingerprints message `since-1` (as delta snapshots). `404` for an id that names no transcript or leaves the session's directory. |
| `GET /sessions/:id/files` | `files`. `{cwd, files: [{path, name, source, exists, size?, mtime?}]}`, newest first, at most 200, **without starting an omp** (the messages come from where `/transcript` finds them, else the session file): the files the session may hand over (see Session files). `source` is `written` (a write/edit call of the session that succeeded; `exists: false` once the file is gone) or `mentioned` (named in a reply, under the session's directory; listed only while it is a file that would be served). |
| `GET /sessions/:id/file?path=<absolute path>` | `files`. One of those files, streamed as `application/octet-stream` with `content-length` and `content-disposition: attachment`. Refusals are `{error, code}`: `400 bad_path` (not absolute, or `.`/`..` segments), `403 not_session_file`, `403 sensitive`, `403 outside_cwd` (a symbolic link, or a named file whose real path leaves the session's directory), `400 not_file`, `404 gone`, `413 too_large` with `{limit, size, relay}`: 100 MB direct, 20 MB through the relay, which holds a body in memory. |
| `POST /sessions/:id/answer` | Body `{id, value?, confirmed?, cancelled?}`. Answers the live session's open request `id` as the `approval` frame does, without a session socket (the home's Allow). `404` when the session is not live, `409` when that request is no longer open. |
| `DELETE /sessions/:id` | Stops its OMP process and forgets it, and its saved transcript; the OMP session file stays. |
| `GET /events?live=` | The attention stream (Server-Sent Events), see below. With `live=1` it also carries `running` frames (key `run:<n>`, the key the turn's `done`/`failed` frame will carry), replays the turns still running, and a `resolved` frame for a running turn whose session closed; the phone's live activity is built from them. Streams without it never see those frames. |
| `GET /blobs/<sha256>` | One image from OMP's content-addressed store (`<omp home>/agent/blobs`), typed from its bytes. |
| `GET /status` | `{pid, version, startedAt, url, liveSessions, busySessions, eventStreams, lastPhone}`; `busySessions`: live sessions running a turn, which `omp-mobile restart` waits for; `lastPhone` is `{address, at}` of the last authenticated request without `x-omp-mobile-probe`, or `null`. |
| `GET /sessions/:id/ws` | WebSocket upgrade, see below. |

### Session socket

**Delta snapshots** (`transcript-sync`). A phone that holds the first `n` messages of a transcript connects with `?since=n&last=<fingerprint of message n-1>`, where a message's fingerprint is `${role}:${timestamp}:${toolCallId ?? responseId ?? ""}`. When the daemon's message `n-1` has that fingerprint, the snapshot carries only the messages after it: `from` is the index of its first message (`0`: the whole transcript) and `total` how many the daemon holds. Anything else (no parameters, a different message there, more than the daemon holds) gets everything with `from: 0`.

**Saved transcripts.** When a session's omp exits (the idle reaper, the daemon stopping, omp leaving on its own), its slim messages, state and summary are written to `transcripts/<id>.json` next to the registry (`~/.omp-mobile/transcripts/`), with the session file's modification time and size. `/transcript` serves one only while the file still has them; anything that writes the session since (a terminal omp) makes it stale. Records whose session was quiet for 24 hours, or that went stale, are deleted when the daemon starts; nothing is evicted by count.

On connect the daemon sends `{type: "snapshot", session, state, from, total, messages, streaming?}` (`streaming`: the assistant message being written, as its deltas so far add up; the next `message_update` deltas continue it), then every OMP question still open as `{type: "approval", request}`. A session that cannot be opened (unknown, its file gone, held by another omp process, or OMP failing to start or load it) still completes the upgrade: the daemon sends `{type: "open_failed", status, error, owner?}` with the HTTP status the same request would get, and closes with code `4000`. After a successful open:

| From the daemon | Meaning |
| --- | --- |
| `event` | One OMP session event, unchanged, except `message_update`: it carries only `message.role` and `assistantMessageEvent` without `partial` (the delta), not OMP's two copies of the whole message so far. |
| `state` | OMP's session state after a turn, and after model, thinking-level, todo or queue changes. |
| `approval` | An OMP UI request (`select`, `confirm`, `input`, `editor`) waiting for an answer. |
| `approval_resolved` | `{id, reason}`: that request was answered by any client, cancelled by OMP, or closed with the process. |
| `notice` | `{level, message}` from OMP. |
| `closed` | `{reason, stderr}`: the OMP process exited. |
| `subagent` | `subagents`. `{subagent: {id, agentId, agent, description, status, parentToolCallId}}`: a subagent started (`running`) or ended (`completed`, `failed`, `aborted`), from OMP's `subagent_lifecycle` frames (the daemon asks each omp for them with `set_subagent_subscription` `progress`, and drops the progress ticks). |
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

The app folds the same OMP events into the transcript both live and from a saved one: a message per `message_start` / `message_end`, a tool item per `tool_execution_*` call keyed by `toolCallId`, and notices for compaction, retries and OMP's own `notice` frames. `app/src/rows.ts` then lays the items out as one conversation column: per turn the user's bubble, a divider (how the turn ended and how long it took, from the message and tool times; while it runs, what OMP is doing now), the work rows, the prose, and a tail (copy, the time). Work rows are each stretch of consecutive tool calls (with the thinking that only led into them) as one activity row named by the kinds of work it did ("Read files, ran commands"), and a reply's thinking as one thinking row; they belong to their turn, and folding the divider hides them. Every row carries the space above it, so the column keeps one rhythm. An activity opens in place onto one line per call (its kind, the command, path or pattern, `+6 −2` from OMP's result diff), and a call opens in place onto its output, diff or first lines; a long press, or "Details", opens the full input, diff and output in a sheet. The list is inverted, so it rests on the newest row while that row streams; scrolled up, it holds the rows in view and offers a jump back with the count of new rows; a row opened by a tap moves the list by what it gained, so its header stays under the finger.

Images arrive as `{type: "image", data, mimeType}`. Inline base64 becomes a data URI; `blob:sha256:<hash>` becomes the daemon's `/blobs/<hash>` route, which serves the store under `<omp home>/agent/blobs` to an authenticated client. The todo panel reads `state.todoPhases`, the context chip reads `state.contextUsage`, and queued messages come from `state.queuedMessages`.

A `task` step's details sheet lists the subagents that call started (`subagents`; `app/src/components/Subagents.tsx`): those at the sheet's level whose `parentToolCallId` is the call, or, once finished, whose `agentId` is a `tasks[].name` of it (OMP adds `-2`, `-3` on a repeat). Tapping one opens its transcript full screen, built from its messages with the same rows, read-only; the list polls every 3 s and an open transcript every 2 s (a delta, `since`/`last`) while something runs. A step inside it opens the same sheet, so a subagent's own subagents open the same way.

## Session files

`daemon/src/session-files.mjs` decides what a phone may download from a session (`files`); nothing else on the computer is reachable through it:

- **Written:** the target of each of the session's `write`, `edit`, `multi_edit` and `apply_patch` calls whose result is not an error: `path` / `file_path`, the `[path#tag]` headers and `MV` destinations of a hashline `input`, an `apply_patch` input's `*** Add File` / `Update File` / `Move to`. A relative path is under the session's directory, `~/` the home directory. Such a file may lie anywhere.
- **Mentioned:** a path in a reply's text (not thinking, not tool output) that lies under the session's directory: a run of letters, digits and `_@+%=.~/-` with a `/` or a file extension, not starting with `//` (a URL) or ending with `/`; a run that starts with non-ASCII prose also offers what follows its last non-ASCII character (`已写入report.md`).
- **Checks**, in order, on the requested path: absolute and normalized; one of the above for this session (another session's file is refused); not sensitive by name; not a symbolic link itself; resolved, not sensitive either, and for a mentioned file still under the session's resolved directory; a regular file; within the size cap. It is opened without following links and served only if the descriptor is the file that was checked, streamed with exactly the announced length.
- **Sensitive** (`SENSITIVE_NAMES`, `SENSITIVE_DIRS`, extend there): `.env*`, `*.pem`, `*.key`, `*.p12`, `*.pfx`, `*.jks`, `*.keystore`, `*.kdbx`, `id_rsa*` and the other SSH key names, `.netrc`, `.npmrc`, `.pypirc`, `.git-credentials`, `.pgpass`, names with the word token, secret, credential or password, and anything under `.ssh`, `.aws`, `.gnupg`, `.kube`, `.docker`, `.azure`, `.config/gh`, `.config/gcloud`, `.omp-mobile` or `.git`.
- **Relay:** a request the tunnel marks (`x-omp-mobile-relay`) gets the 20 MB cap; the tunnel passes the answer's `content-length` on with its status, so the phone shows progress there too.

With a daemon that lists `files`, the app (`app/src/files.ts`, `app/src/fileDownload.ts`, `app/src/components/FileCards.tsx`) shows a card per file: under a finished turn, for the files its calls wrote and those its reply names that the daemon's list holds (so a stray word never becomes a card); in a write step's details sheet; and in the chat header's **Session files** sheet, the whole list. The list is fetched when the chat opens and again after each turn. A tap downloads the file into its own directory under the app's cache (over the tailnet streamed with the token, through the relay whole as base64) and opens the system share sheet on it (`app/modules/omp-share`: Android through expo-file-system's FileProvider, iOS through React Native's `Share`); a later tap shares that copy again. Every card for one file shows the same download, keyed by machine, session and path; a refusal shows the daemon's reason (secrets, too large for the relay, gone, not this session's).

## Sessions

- **Created by the daemon:** registered in the registry file and resumed with `omp --resume <file>` the first time one is opened after a daemon restart.
- **Terminal sessions:** the 50 most recently written OMP sessions under `<omp home>/agent/sessions`, titled by OMP's title slot, else the first prompt, else the directory. Opening one resumes it and it becomes one of the daemon's sessions.
- **Held elsewhere:** every writing omp process holds `<omp home>/run/session-owners/<id>.lock` open. The daemon reads these with `lsof`, marks such sessions `openElsewhere`, and answers a resume `409`, because a second omp on the same file saves to a new file instead of sharing it. Without `lsof` ownership is unknown and the resume goes ahead.
- **Taking over** (`daemon/src/takeover.mjs`): OMP has no way to attach a second process to a running session, so the phone continues one by asking its owner to leave. The daemon writes `.<session file name>.omp-mobile-takeover` beside the session file; the omp-mobile plugin in that omp removes it, shows where the session went, aborts the turn and closes omp through OMP's shutdown. If nothing takes the request within 2.5 s, or omp is still running 10 s after it did, the owner gets `SIGINT`, then after 10 s `SIGTERM`; OMP runs both through its Ctrl+C teardown (the session is flushed, a `session_exit` entry closes it, the lock is released). There is no `SIGKILL`. Only the lock's holder is signalled: an omp that has a session open without having written it holds no lock and would fork the session when it saves on exit. The terminal gets one line saying the session continues on the phone, and a session file forked from the session during the takeover (a header whose `parentSession` is its id) is logged and reported in `forks`.
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
- A copy of every session active in the last 24 hours (its `updatedAt`, or when it was last viewed on the phone; no count limit): the daemon's slim messages, state and session summary (`c-*.json`), its last ~160 messages from a turn start with the state and summary (`h-*.json`, written with it), an index of how current each copy is (`index.json`), and each machine's session list (`s-*.json`), under `<documents>/transcripts/`. A chat paints the tail at once (transcript, model, todos), also offline, whatever the session's size; it connects with `since`/`last` against the tail and merges the snapshot at its `from`, while the whole copy is read in the background and put under the tail where the two agree (a tail that does not match the index, or a copy that does not fit the tail, makes the chat ask for the whole transcript); a snapshot that does not fit the copy is asked for again whole. With a daemon that offers `transcript-sync`, the home keeps the copies current without opening them: after each session-list load, every 60 s in the foreground (the list is refreshed quietly first), on return to the foreground and when a chat is left, each copy older than its session is extended with `GET /sessions/:id/transcript?since&last`, one request at a time; a `404` is skipped for 5 minutes. Copies of sessions quiet for 24 hours, and the item caches of 0.4 (`t-*`), are deleted. Writes are best effort and a damaged file reads as no copy. Deleting a session drops its copy; removing a machine drops everything kept for it.

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
| `daemon/src/takeover.mjs` | Taking a session from the omp that holds it: request file, signals, mid-turn and fork checks |
| `daemon/src/qr.mjs` | Terminal QR code |
| `daemon/src/session-files.mjs` | What a session may hand over: written and mentioned paths, the checks, streaming a file |
| `daemon/src/omp-extension.mjs` | The OMP plugin: `/mobile`, starting and stopping the background daemon, the pairing widget, answering a takeover |
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
| `app/src/files.ts`, `app/src/fileDownload.ts` | Which files a reply offers, downloading one and sharing it |
| `app/modules/omp-share/` | Expo local module (Kotlin): the Android share sheet for a downloaded file; `src/index.ts` is its JS API |
