<p align="center">
  <img src="assets/omp-mobile-logo.svg" width="64" height="64" alt="OMP Mobile logo">
</p>

<h1 align="center">OMP Mobile</h1>

<p align="center">
  <a href="README.md">English</a> ·
  <a href="README.zh-CN.md">简体中文</a>
</p>

<p align="center">在手机上使用你的 oh-my-pi 会话。</p>

OMP Mobile 是 [oh-my-pi](https://github.com/can1357/oh-my-pi)（OMP）的原生手机 App，每台电脑上配一个小 daemon。在手机上新建、查看、引导 OMP 会话：对话记录、工具调用、审批，以及你在终端里开的会话。

- **原生 App：** 对话记录、工具卡片、思考过程、Markdown 和输入框都由 App 自己绘制。没有 WebView，也不是网页。
- **手机上审批：** OMP 自己的工具审批和提问以面板形式出现，这一轮会等你回答。
- **终端会话：** 你在电脑终端里开的会话也会列出来，可以在手机上接着用。仍在终端里打开的会话，要等那个终端退出后才能打开。
- **通知：** App 在后台时，审批、提问和任务完成会发安卓通知。
- **所有机器：** 扫码配对每台电脑，在会话列表里切换。重新打开的对话立即显示，离线也能看。
- **只走 Tailscale：** daemon 只监听电脑的 Tailscale 地址，只放行你自己的设备。没有自己的中继或云服务。

## 开始使用

### 前置条件

- 每台电脑：Node.js 22.19 或更新版本，`PATH` 里有 OMP 18.x
- 电脑和手机都登录同一个 [Tailscale](https://tailscale.com) 账号
- 一台安卓手机

### 电脑

在每台电脑上安装 daemon，并绑定到这台电脑的 Tailscale IPv4 地址（`tailscale ip -4`）运行：

```bash
npm install -g omp-mobile
omp-mobile --host 100.x.y.z --cwd ~/project
```

它会打印地址、token 和配对链接，并把同一个链接显示成二维码。新会话在 `--cwd` 目录下启动。

### 手机

从 [Releases 页面](https://github.com/Rinai-R/omp-mobile/releases)下载 APK 并安装。在 App 里点 **Scan to pair**，扫描 daemon 打印的二维码。**Enter address** 可以手动填地址和 token，或粘贴配对链接。

需要通知时，在 App 里打开 **Settings → Notifications**。

你 Tailscale 账号下持有 token 的设备，可以在那台电脑上执行 OMP 能做的任何事。

## 开发

- `daemon`：电脑端（Node.js），以 RPC 模式运行 OMP 并为 App 提供服务
- `app`：手机 App（Expo，React Native）
- `app/modules/omp-attention`：安卓通知服务（Kotlin）

```bash
npm install
npm run typecheck
npm test                         # daemon 和 app

npm start -w @omp-mobile/app     # Expo 开发服务器

# 安卓 APK（JDK 17，Android SDK）；app/android 由生成得到，不提交
cd app && npx expo prebuild --platform android --clean --no-install
cd android && ./gradlew assembleRelease
```

对接模拟器时，在仓库里用 `npm run daemon -- --host 127.0.0.1` 运行 daemon，再用 `adb reverse tcp:7390 tcp:7390` 转发端口。daemon 的工作方式、选项、HTTP API 和源码结构见 [ARCHITECTURE.md](ARCHITECTURE.md)。

发版就是在 `main` 上打一个 `v<version>` tag：版本号要和 `package.json`、`daemon/package.json`、`app/package.json`、`app/app.json` 一致，[CHANGELOG.md](CHANGELOG.md) 里要有对应的小节。CI 随后把 `omp-mobile` 发布到 npm，并发布带 APK 的 GitHub Release。

## 许可证

Apache-2.0。OMP Mobile 与 oh-my-pi、Tailscale 均无关联。
