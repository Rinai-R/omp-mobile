/**
 * The OMP extension of omp-mobile: `/mobile` in the interactive OMP.
 *
 * `/mobile` starts the daemon in the background if it is not running, then
 * shows its pairing QR code above the composer until a phone connects. The
 * daemon is its own process (detached, in its own session, logging to
 * `~/.omp-mobile/daemon.log`), so it keeps serving the phone after this
 * terminal and this OMP exit; `/mobile stop` ends it.
 *
 * It runs on the Bun that ships inside omp (`BUN_BE_BUN=1`), so no separate
 * Node.js is needed, and binds this computer's Tailscale IPv4 (`--host tailscale`).
 *
 * In every omp it is loaded into, it also watches for the daemon's takeover
 * request for the session that omp has open (a file beside the session file,
 * see `takeover.mjs`): it then says where the session went, stops the turn and
 * closes omp through OMP's own shutdown, so the phone can continue it.
 */
import { spawn } from "node:child_process";
import { accessSync, closeSync, constants, mkdirSync, openSync, readFileSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderQr } from "./qr.mjs";
import { requestPath } from "./takeover.mjs";

const HOME = join(homedir(), ".omp-mobile");
const STATE_FILE = join(HOME, "daemon.json");
const LOG_FILE = join(HOME, "daemon.log");
const SERVER = fileURLToPath(new URL("./server.mjs", import.meta.url));
const WIDGET = "omp-mobile";
const START_TIMEOUT_MS = 20_000;
const POLL_MS = 1_500;
/** How long the code stays up without a phone connecting. */
const SHOW_MS = 5 * 60_000;
/** How often the session's takeover request is looked for, and how stale one may be. */
const TAKEOVER_POLL_MS = 500;
const TAKEOVER_MAX_AGE_MS = 60_000;
/** How long a running turn gets to stop before omp closes anyway. */
const TAKEOVER_IDLE_WAIT_MS = 5_000;
const SUBCOMMANDS = [
  { value: "status", label: "status", description: "Is the daemon running, and where" },
  { value: "stop", label: "stop", description: "Stop the background daemon" },
  { value: "hide", label: "hide", description: "Hide the pairing code" },
];

/**
 * The running daemon's record, if its process is alive.
 * @returns {{pid: number, version: string, url: string, pair: string, startedAt: number} | undefined}
 */
export function readState(path = STATE_FILE) {
  let state;
  try {
    state = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return undefined;
  }
  if (typeof state?.pid !== "number" || typeof state.url !== "string" || typeof state.pair !== "string") return undefined;
  return alive(state.pid) ? state : undefined;
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: it exists but belongs to someone else.
    return error?.code === "EPERM";
  }
}

/** The token inside a pairing link. */
export function tokenOf(pair) {
  return new URL(pair.replace(/^omp-mobile:\/\//, "http://x/")).searchParams.get("token") ?? "";
}

/** The daemon's `/status`, or undefined when it does not answer. */
async function status(state) {
  try {
    const response = await fetch(`${state.url}/status`, {
      headers: { authorization: `Bearer ${tokenOf(state.pair)}`, "x-omp-mobile-probe": "1" },
      signal: AbortSignal.timeout(3_000),
    });
    return response.ok ? await response.json() : undefined;
  } catch {
    return undefined;
  }
}

function logTail(lines = 6) {
  try {
    return readFileSync(LOG_FILE, "utf8").trimEnd().split("\n").slice(-lines).join("\n");
  } catch {
    return "";
  }
}

/**
 * The omp the daemon starts sessions with: `omp` on PATH when there is one, since
 * a package manager's link survives an upgrade that removes the versioned binary
 * this process runs from (Homebrew's Cellar path, for one); else this binary.
 */
function ompBinary() {
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    if (dir === "") continue;
    const candidate = join(dir, "omp");
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Not in this directory.
    }
  }
  return process.execPath;
}

/**
 * Start the daemon detached from this terminal and wait until it serves.
 * @param {string} cwd Default directory for sessions the phone starts.
 */
async function startDaemon(cwd) {
  mkdirSync(HOME, { recursive: true, mode: 0o700 });
  const log = openSync(LOG_FILE, "a", 0o600);
  let child;
  try {
    child = spawn(process.execPath, [SERVER, "--host", "tailscale", "--cwd", cwd, "--omp", ompBinary(), "--no-qr"], {
      cwd,
      detached: true,
      stdio: ["ignore", log, log],
      env: { ...process.env, BUN_BE_BUN: "1" },
    });
  } finally {
    closeSync(log);
  }
  let exited = false;
  child.on("exit", () => {
    exited = true;
  });
  child.on("error", () => {
    exited = true;
  });
  child.unref();
  const deadline = Date.now() + START_TIMEOUT_MS;
  while (Date.now() < deadline && !exited) {
    const state = readState();
    if (state?.pid === child.pid && (await status(state)) !== undefined) return state;
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  }
  const reason = exited ? "it exited" : "it did not answer in time";
  throw new Error(`The omp-mobile daemon did not start (${reason}).\n${logTail()}`);
}

/** Time the daemon gets to close its omp processes (each up to SIGINT + SIGTERM waits) before it is killed. */
const STOP_TIMEOUT_MS = 25_000;

async function stopDaemon(state) {
  process.kill(state.pid, "SIGTERM");
  const deadline = Date.now() + STOP_TIMEOUT_MS;
  while (Date.now() < deadline && alive(state.pid)) await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  if (alive(state.pid)) process.kill(state.pid, "SIGKILL");
}

/** What the pairing widget shows: a title, the code, and where it points. */
export function pairingContent(state) {
  const host = new URL(state.url).host;
  return {
    title: "OMP Mobile · in the app: Machines → Scan to pair",
    code: renderQr(state.pair).split("\n"),
    notes: [
      `${host} · pid ${state.pid} · keeps running after you exit`,
      "/mobile hide closes this · /mobile stop stops the daemon",
    ],
  };
}

/** `text` cut to `width` columns (the widget's lines are plain, one column per character). */
function fit(text, width) {
  return text.length <= width ? text : `${text.slice(0, Math.max(0, width - 1))}…`;
}

/**
 * The pairing widget as a TUI component: a plain line widget is cut at ten
 * lines, which a QR code needs more than. A code cut at the terminal's edge
 * would not scan, so a terminal narrower than the code is asked to widen;
 * the text lines are shortened to fit instead.
 */
export function pairingWidget({ title, code, notes }) {
  const codeWidth = Math.max(...code.map((line) => line.length)) + 1;
  return () => ({
    render(width) {
      const text = (line) => fit(` ${line}`, width);
      if (width < codeWidth) return [text(`OMP Mobile: widen the terminal to ${codeWidth} columns to show the code.`)];
      return [text(title), "", ...code.map((line) => ` ${line}`), "", ...notes.map(text)];
    },
  });
}

/**
 * The daemon's takeover request for this process and session, if there is a
 * fresh one. A request for another process or an old one is left alone.
 * @returns {{device: string} | undefined}
 */
export function takeoverRequest(sessionFile, sessionId, pid = process.pid, now = Date.now()) {
  if (typeof sessionFile !== "string" || sessionFile === "") return undefined;
  let request;
  try {
    request = JSON.parse(readFileSync(requestPath(sessionFile), "utf8"));
  } catch {
    return undefined;
  }
  if (request?.pid !== pid || request.sessionId !== sessionId) return undefined;
  if (typeof request.at !== "number" || now - request.at > TAKEOVER_MAX_AGE_MS) return undefined;
  return { device: typeof request.device === "string" && request.device !== "" ? request.device : "OMP Mobile" };
}

export default function ompMobile(pi) {
  /** The takeover watch for the session this omp has open. */
  let watching;
  let leaving = false;

  pi.on("session_start", (_event, ctx) => {
    if (watching !== undefined) ctx.clearTimer(watching);
    watching = ctx.setInterval(async () => {
      if (leaving) return;
      const file = ctx.sessionManager.getSessionFile();
      const request = takeoverRequest(file, ctx.sessionManager.getSessionId());
      if (request === undefined) return;
      leaving = true;
      // Taking the request is the answer the daemon waits for before it would signal.
      rmSync(requestPath(file), { force: true });
      // OMP closes once the session is idle; the daemon signals it if that does not come soon,
      // and tells the terminal where the session went once omp is gone.
      ctx.ui.notify(`OMP Mobile: this session continues on ${request.device}. Closing omp here…`, "warning");
      if (!ctx.isIdle()) {
        ctx.abort();
        const deadline = Date.now() + TAKEOVER_IDLE_WAIT_MS;
        while (!ctx.isIdle() && Date.now() < deadline) await new Promise((resolveWait) => setTimeout(resolveWait, 100));
      }
      ctx.shutdown();
    }, TAKEOVER_POLL_MS);
  });

  /** The pairing code on screen: its watcher and when it appeared. */
  let showing;

  const hide = (ctx) => {
    if (showing === undefined) return;
    ctx.clearTimer(showing.timer);
    showing = undefined;
    ctx.ui.setWidget(WIDGET, undefined);
  };

  const show = (ctx, state) => {
    hide(ctx);
    if (ctx.mode !== "tui") {
      ctx.ui.notify(`OMP Mobile: open this link on the phone: ${state.pair}`, "info");
      return;
    }
    const shownAt = Date.now();
    ctx.ui.setWidget(WIDGET, pairingWidget(pairingContent(state)), { placement: "aboveEditor" });
    const timer = ctx.setInterval(async () => {
      if (showing?.timer !== timer) return;
      if (Date.now() - shownAt > SHOW_MS) {
        hide(ctx);
        return;
      }
      const now = await status(state);
      if (showing?.timer !== timer) return;
      if (now === undefined) {
        hide(ctx);
        ctx.ui.notify("OMP Mobile: the daemon stopped answering.", "warning");
        return;
      }
      if (now.lastPhone !== null && now.lastPhone.at >= shownAt) {
        hide(ctx);
        ctx.ui.notify(`OMP Mobile: phone connected from ${now.lastPhone.address}.`, "info");
      }
    }, POLL_MS);
    showing = { timer };
  };

  pi.registerCommand("mobile", {
    description: "Pair your phone with this computer (OMP Mobile)",
    getArgumentCompletions: (prefix) => SUBCOMMANDS.filter((item) => item.value.startsWith(prefix.trim())),
    handler: async (args, ctx) => {
      const sub = args.trim();
      const state = readState();
      if (sub === "hide") {
        hide(ctx);
        return;
      }
      if (sub === "stop") {
        hide(ctx);
        if (state === undefined) {
          ctx.ui.notify("OMP Mobile: the daemon is not running.", "info");
          return;
        }
        await stopDaemon(state);
        ctx.ui.notify(`OMP Mobile: stopped the daemon (pid ${state.pid}).`, "info");
        return;
      }
      if (sub === "status") {
        const now = state === undefined ? undefined : await status(state);
        if (state === undefined || now === undefined) {
          ctx.ui.notify("OMP Mobile: the daemon is not running. /mobile starts it.", "info");
          return;
        }
        const phone = now.lastPhone === null ? "no phone yet" : `last phone ${now.lastPhone.address}`;
        ctx.ui.notify(`OMP Mobile: ${now.url} · pid ${now.pid} · ${now.liveSessions} live sessions · ${phone}`, "info");
        return;
      }
      if (sub !== "") {
        ctx.ui.notify(`OMP Mobile: unknown "${sub}". Use /mobile, /mobile status, /mobile stop or /mobile hide.`, "warning");
        return;
      }
      let running = state !== undefined && (await status(state)) !== undefined ? state : undefined;
      if (running === undefined) {
        ctx.ui.notify("OMP Mobile: starting the daemon…", "info");
        try {
          running = await startDaemon(ctx.cwd);
        } catch (error) {
          ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
          return;
        }
      }
      show(ctx, running);
    },
  });
}
