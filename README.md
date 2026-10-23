# OMP Mobile

A native phone client for [oh-my-pi](https://github.com/can1357/oh-my-pi) (OMP).
No WebView and no dsh page: the app renders the transcript, tool calls, approvals
and composer itself, and talks to a small daemon on the computer.

```text
phone ── Tailscale HTTP/WS ──> omp-mobile daemon ── RPC ──> OMP sessions
```

## Why a daemon

OMP is a terminal agent; it has no web server. `omp --mode rpc` speaks JSON
lines on stdin/stdout and emits the full session event stream. The daemon owns
those processes, serves one normal HTTP + WebSocket API, and keeps the phone
free of OMP's RPC details.

## Run

Requirements: Node 22.19+, OMP 18.x on `PATH`, and the phone and computer on
the same Tailscale network for a phone connection.

```sh
npm install

# On the computer. Use the Tailscale IP so the phone can reach it.
node daemon/src/server.mjs --host 100.64.0.10 --port 7390 --cwd ~/project

# It prints:
#   listening  http://100.64.0.10:7390
#   token      <token>
#   pair       omp-mobile://pair?url=...&token=...
# and the same pairing URI as a terminal QR code (`--no-qr` to skip it).
```

Then start the app (`npm start -w @omp-mobile/app`) and tap **Scan to pair**
on the Machines screen. The scanner accepts only a pairing code whose address
is on the tailnet (100.64.0.0/10 or a `*.ts.net` name). Opening an
`omp-mobile://pair?...` link on the phone fills in the Add machine sheet; tap
Connect to add it. **Enter address** takes the address + token by hand, or a
pasted pairing URI.

For local development use `--host 127.0.0.1` and `adb reverse tcp:7390 tcp:7390`.

## Admission (Tailscale identity)

On a non-loopback `--host` the daemon admits a request only when it reaches
this node on purpose and comes from one of your own devices, the same rules as
Kivotos. Every HTTP request (including the public `/hello`) and every
WebSocket upgrade is checked **before** the bearer token, in this order:

1. **Host** — the `Host` header must name this node: the bind address, one of
   its Tailscale IPs, or its MagicDNS name (a port is allowed). Anything else
   is answered `421` (DNS-rebinding guard).
2. **User** — the source address (IPv4-mapped IPv6 normalized) must be a
   tailnet device whose `tailscale whois` user is this node's user (from
   `tailscale status`). Another user's device, a tagged device (tagged devices
   have no user) or an address outside the tailnet is answered `403`. The
   node's own Tailscale IPs are admitted as the same user. Whois answers are
   cached per address for 60 s, failures for 5 s.

Refusals are JSON `{"error": "<reason>"}` with the status; refused WebSocket
upgrades get the HTTP status line and the socket is closed. The token is still
required after admission. `/hello` reports the node's login name as `user`.

| Flag | Effect |
| --- | --- |
| `--host 127.0.0.1` / `::1` | Admission is off (development, `adb reverse`); the startup log says so. |
| `--tailscale <path>` | `tailscale` CLI to use (default `tailscale`; on macOS the app bundle binary `/Applications/Tailscale.app/Contents/MacOS/Tailscale` is tried when `tailscale` is not on `PATH`). |
| `--no-whois` | Skip the user check (the Host check and token still apply); a warning is printed. |

If the `tailscale` CLI cannot be read on a non-loopback host, the daemon
refuses to start unless `--no-whois` is given.

## What v0.1 does

- Machines: add/remove, name/OS/OMP version, per-machine session list.
- Sessions: create a new OMP session in a working directory, list, delete.
- Native transcript: user/assistant messages, streaming text, thinking,
  tool calls with expandable arguments/results, notices.
- Composer: prompt, steer while streaming, stop.
- Approvals: OMP extension UI requests (`select`, `confirm`, `input`, `editor`)
  are rendered natively and answered over the socket.
- Reconnect: the transcript is replayed from the daemon snapshot after a
  disconnect.
- Sessions this daemon created are registered in
  `~/.omp-mobile/sessions.json` and resumed with `omp --resume` the first time
  the app opens one again after a daemon restart.
- Terminal sessions: the 50 most recently written OMP sessions under
  `~/.omp/agent/sessions` (`--omp-home` for another OMP home) are listed under
  **From the terminal** and continue on the phone when opened. A session
  another omp process still holds (its owner lock in
  `~/.omp/run/session-owners`, read with `lsof`) is marked "in a terminal" and
  refused with `409` until that process exits; a second omp on the same file
  would fork it instead.
- Offline reopen: the phone keeps each session's transcript (last 400 items,
  tool text cut to 4 000 characters, 40 sessions) and each machine's session
  list under the app's documents directory. A reopen shows them at once, also
  when the computer is unreachable, and the daemon's snapshot replaces them
  when it arrives. Removing a machine erases what was kept for it.
- Machine switcher: with more than one machine, tap the Sessions title to
  jump to another machine's sessions; the sheet probes every machine when it
  opens.

OMP runs in `--mode rpc-ui`, so its own tool approvals (the Approve / Deny
prompt your OMP approval policy asks for) reach the phone as a native sheet;
the turn waits until you answer. `--auto-approve` passes OMP's auto-approve
through instead, and nothing is asked.

## Background notifications (Android)

Settings → **Notifications** asks for the notification permission (Android 13+)
and starts a foreground service ("Watching N machines", a low-importance
notification) that holds one Server-Sent Events stream per paired computer:

```text
GET /events?token=<token>      (or Authorization: Bearer; admission applies)
data: {"kind":"approval","key":"<request id>","sessionId":"…","sessionTitle":"…","machine":"<hostname>","text":"bash · Command: echo hi","time":…}
```

`approval` is OMP's tool approval (a `select` titled `Allow tool:`),
`question` any other `select`/`confirm`/`input`/`editor`, `resolved` (same
`key`) when it is answered by any client or cancelled, `done`/`failed` when
an agent run ends (`agent_end`; failed on an `error`/`aborted` stop or an error
notice). A new connection first gets the open approvals and questions, then
`event: live`; a `: ping` comment follows every 25 s. Approvals and questions
pop up heads-up on the "Approvals & questions" channel, finished turns on
"Finished turns"; `resolved` withdraws the notification; nothing is posted
for the session on screen; a tap opens that chat. The service restarts after a
reboot when notifications were on. While the app is open, a frame for another
session shows as a banner instead. iOS has no background service: the module
is a no-op there.

## Not yet aligned with Kivotos

- Tailscale peer discovery (pairing is by QR code, link, or address + token).
- A relay for phones that cannot reach the computer over Tailscale (the
  daemon is reached only on its tailnet address).

These are intentionally separate from the core; the app never needs a WebView
for any of them.

## Layout

- `daemon/src/rpc-session.mjs` — one `omp --mode rpc` process, JSONL, requests,
  extension UI responses.
- `daemon/src/server.mjs` — HTTP/WS API, session manager, auth.
- `daemon/src/admission.mjs` — `tailscale status`/`whois` wrapper and the
  Host + same-user listener admission.
- `daemon/src/attention.mjs` — folds session broadcasts into attention frames
  and serves `GET /events`.
- `daemon/src/omp-sessions.mjs` — OMP's on-disk sessions and their owner locks.
- `app/src/api.ts` — daemon REST + session socket.
- `app/src/messages.ts` — OMP event → native transcript reducer.
- `app/src/screens/` — Machines, Sessions, Chat, Settings.
- `app/modules/omp-attention/` — Expo local module (Kotlin): the foreground
  service, notifications, boot receiver; `src/index.ts` is its JS API.
