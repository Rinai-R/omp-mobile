<p align="center">
  <img src="assets/omp-mobile-logo.svg" width="64" height="64" alt="OMP Mobile logo">
</p>

<h1 align="center">OMP Mobile</h1>

<p align="center">
  <a href="README.md">English</a> ·
  <a href="README.zh-CN.md">简体中文</a>
</p>

<p align="center">Your oh-my-pi sessions, on your phone.</p>

OMP Mobile is a native phone app for [oh-my-pi](https://github.com/can1357/oh-my-pi) (OMP), with a small daemon on each computer. Start, follow and steer OMP sessions from the phone: transcript, tool calls, approvals, and the sessions you started in a terminal.

- **Native app:** The app draws the transcript, tool cards, thinking, Markdown and composer itself. No WebView, no web page.
- **The whole transcript:** images the user sent and images tools produce (screenshots, opened files), edit diffs with their intent, tool results, Markdown tables, OMP's todo list, context usage and queued messages.
- **Model switching:** tap the model in the composer to pick from OMP's catalog — grouped by provider and searchable — and set its thinking level. The model chip follows the session when it changes.
- **Approvals on the phone:** OMP's own tool approvals and questions arrive as a sheet, and the turn waits for your answer.
- **Terminal sessions:** Sessions you started in a terminal on the computer are listed too and continue on the phone. One still open in a terminal waits until that terminal exits.
- **Notifications:** Android notifications for approvals, questions, and finished turns while the app is in the background.
- **All your machines:** Pair each computer by QR code, switch between them from the session list. A reopened chat shows at once, also offline.
- **Tailscale only:** The daemon listens on the computer's Tailscale address and admits only your own devices. No relay or cloud service of its own.
- **An OMP plugin:** `/mobile` in OMP starts the daemon in the background and shows the pairing code. The daemon keeps running after the terminal closes.

## Getting started

### Prerequisites

- On every computer: OMP 18.x
- [Tailscale](https://tailscale.com) signed in to the same account on the computer and the phone
- An Android phone

### Computer

Install the plugin into OMP on every computer:

```bash
omp plugin install omp-mobile
```

Then in OMP, run `/mobile`. It starts the daemon in the background, bound to the computer's Tailscale address, and shows a pairing code above the composer until the phone connects. The daemon runs on the Bun inside OMP and outlives the terminal and OMP; `/mobile status` shows it and `/mobile stop` ends it. Phone sessions start in the directory where you ran `/mobile` the first time.

Without the plugin, the same daemon runs from npm (Node.js 22.19 or newer) in the foreground: `npm install -g omp-mobile`, then `omp-mobile --host tailscale --cwd ~/project`. It prints the same code.

### Phone

Install the APK from the [releases page](https://github.com/Rinai-R/omp-mobile/releases). In the app, tap **Scan to pair** and scan the code. **Enter address** takes the address and token by hand, or a pasted pairing link.

For notifications, open **Settings → Notifications** in the app.

A device on your Tailscale account that has the token can run anything OMP can on that computer.

## Development

- `daemon`: the computer side (Node.js), which runs OMP in RPC mode and serves the app
- `app`: the phone app (Expo, React Native)
- `app/modules/omp-attention`: the Android notification service (Kotlin)

```bash
npm install
npm run typecheck
npm test                         # daemon and app

npm start -w @omp-mobile/app     # Expo dev server

# Android APK (JDK 17, Android SDK); app/android is generated, not committed
cd app && npx expo prebuild --platform android --clean --no-install
cd android && ./gradlew assembleRelease
```

Against an emulator, run the daemon from the checkout with `npm run daemon -- --host 127.0.0.1` and forward the port with `adb reverse tcp:7390 tcp:7390`. How the daemon works, its options and HTTP API, and the source map are in [ARCHITECTURE.md](ARCHITECTURE.md).

A release is a `v<version>` tag on `main` whose version matches `package.json`, `daemon/package.json`, `app/package.json` and `app/app.json`, with a matching section in [CHANGELOG.md](CHANGELOG.md). CI then publishes `omp-mobile` to npm and a GitHub Release with the APK.

## License

Apache-2.0. OMP Mobile is not affiliated with oh-my-pi or Tailscale.
