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

The daemon starts OMP with `--auto-approve` by default, so **built-in tool
approval is not asked**; extension UI dialogs are. Use
`--no-auto-approve` to leave the default policy in place and accept that a
session may block on a terminal prompt.

## Not yet aligned with Kivotos

- Background notifications and an Android foreground service.
- Tailscale peer discovery (pairing is by QR code, link, or address + token).
- Sessions created outside this daemon; only sessions it created are listed.
- Background notifications and an Android foreground service.
- Federation across machines with a switcher and relay fallback.
- Tailscale `whois` admission (the daemon uses a bearer token).
- Caching of transcripts/assets for instant reopen.

These are intentionally separate from the core; the app never needs a WebView
for any of them.

## Layout

- `daemon/src/rpc-session.mjs` — one `omp --mode rpc` process, JSONL, requests,
  extension UI responses.
- `daemon/src/server.mjs` — HTTP/WS API, session manager, auth.
- `app/src/api.ts` — daemon REST + session socket.
- `app/src/messages.ts` — OMP event → native transcript reducer.
- `app/src/screens/` — Machines, Sessions, Chat, Settings.
