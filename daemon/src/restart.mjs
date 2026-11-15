/**
 * `omp-mobile restart`: replace the running daemon with the code installed
 * now (after `omp plugin upgrade omp-mobile`), with the same arguments.
 *
 * The daemon runs every phone session's omp as its child, so whoever asks
 * for a restart from such a session (an agent, a phone) would be cut off by
 * the stop and could never start the new daemon. The work is therefore done
 * by a detached worker in its own session: it waits until no session is
 * running a turn (unless `--now`), stops the daemon, starts the new one and
 * logs beside the state file (`~/.omp-mobile/daemon.log`). Phones reconnect; sessions resume on open.
 */
import { spawn, execFileSync } from "node:child_process";
import { closeSync, mkdirSync, openSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { STATE_FILE, alive, readState, tokenOf } from "./state.mjs";

const SERVER = join(dirname(fileURLToPath(import.meta.url)), "server.mjs");
/** How long a restart waits for running turns to end before it goes ahead anyway. */
const IDLE_WAIT_MS = 10 * 60_000;
/** How long the old daemon gets to close its omp processes, and the new one to come up. */
const STOP_TIMEOUT_MS = 25_000;
const START_TIMEOUT_MS = 30_000;

const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));

function log(line) {
  console.log(`omp-mobile restart: ${line}`);
}

/**
 * The arguments and directory the daemon was started with: recorded in its
 * state since 0.7.2; for an older daemon, read from its process (an argument
 * with a space in it cannot be told apart there).
 * @returns {{argv: string[], cwd: string} | undefined}
 */
export function launchOf(state) {
  if (Array.isArray(state.argv) && typeof state.cwd === "string") return { argv: state.argv, cwd: state.cwd };
  try {
    const command = execFileSync("ps", ["-o", "command=", "-p", String(state.pid)], { encoding: "utf8" }).trim();
    const words = command.split(/\s+/);
    const at = words.findIndex((word) => word.endsWith("server.mjs"));
    if (at === -1) return undefined;
    const cwd = execFileSync("lsof", ["-a", "-p", String(state.pid), "-d", "cwd", "-Fn"], { encoding: "utf8" })
      .split("\n")
      .find((line) => line.startsWith("n"))
      ?.slice(1);
    return { argv: words.slice(at + 1), cwd: cwd ?? homedir() };
  } catch {
    return undefined;
  }
}

/** A daemon that cannot say whether a turn runs (before 0.7.2) gets this long, so the turn asking can end. */
const GRACE_MS = 60_000;

/** Sessions running a turn; undefined when the daemon does not report it. */
async function busySessions(state) {
  try {
    const response = await fetch(`${state.url}/status`, { headers: { authorization: `Bearer ${tokenOf(state.pair)}` }, signal: AbortSignal.timeout(5_000) });
    const status = await response.json();
    return typeof status.busySessions === "number" ? status.busySessions : undefined;
  } catch {
    return 0;
  }
}

/** The worker: wait, stop, start. Runs detached; its output goes to the daemon log. */
/** The log beside the state file: `~/.omp-mobile/daemon.log` for the default one, where /mobile logs too. */
function logFileOf(stateFile) {
  return join(dirname(stateFile), "daemon.log");
}

async function work(stateFile, now) {
  const state = readState(stateFile);
  if (state === undefined) {
    log("no daemon is running; nothing to restart");
    return 1;
  }
  const launch = launchOf(state);
  if (launch === undefined) {
    log(`cannot tell how daemon ${state.pid} was started; restart it by hand`);
    return 1;
  }
  if (!now) {
    const deadline = Date.now() + IDLE_WAIT_MS;
    let busy = await busySessions(state);
    if (busy === undefined) await sleep(GRACE_MS);
    while (busy !== undefined && busy > 0 && Date.now() < deadline) {
      await sleep(2_000);
      busy = await busySessions(state);
    }
  }
  log(`stopping daemon ${state.pid} (${state.version})`);
  process.kill(state.pid, "SIGTERM");
  const stopBy = Date.now() + STOP_TIMEOUT_MS;
  while (Date.now() < stopBy && alive(state.pid)) await sleep(100);
  if (alive(state.pid)) process.kill(state.pid, "SIGKILL");
  const out = openSync(logFileOf(stateFile), "a", 0o600);
  let child;
  try {
    child = spawn(process.execPath, [SERVER, ...launch.argv], { cwd: launch.cwd, detached: true, stdio: ["ignore", out, out], env: process.env });
  } finally {
    closeSync(out);
  }
  child.unref();
  const startBy = Date.now() + START_TIMEOUT_MS;
  while (Date.now() < startBy) {
    const next = readState(stateFile);
    if (next?.pid === child.pid) {
      log(`daemon ${next.pid} (${next.version}) is running`);
      return 0;
    }
    if (!alive(child.pid)) break;
    await sleep(250);
  }
  log("the new daemon did not start; see the lines above");
  return 1;
}

/**
 * `omp-mobile restart [--now] [--state-file <path>]`: hand the restart to a
 * detached worker and return at once, so this process may be one of the
 * daemon's own sessions.
 * @param {string[]} args
 */
export async function runRestartCli(args) {
  const at = args.indexOf("--state-file");
  const stateFile = at === -1 ? STATE_FILE : args[at + 1];
  const now = args.includes("--now");
  if (args.includes("--worker")) process.exit(await work(stateFile, now));
  const state = readState(stateFile);
  if (state === undefined) {
    console.error("omp-mobile: the daemon is not running. Start it with /mobile in OMP, or omp-mobile --relay.");
    process.exit(1);
  }
  if (launchOf(state) === undefined) {
    console.error(`omp-mobile: cannot tell how daemon ${state.pid} was started; stop it and start it again by hand.`);
    process.exit(1);
  }
  const logFile = logFileOf(stateFile);
  mkdirSync(dirname(logFile), { recursive: true, mode: 0o700 });
  const out = openSync(logFile, "a", 0o600);
  const worker = spawn(process.execPath, [SERVER, "restart", "--worker", "--state-file", stateFile, ...(now ? ["--now"] : [])], {
    detached: true,
    stdio: ["ignore", out, out],
  });
  closeSync(out);
  worker.unref();
  console.log(
    now
      ? `Restarting daemon ${state.pid} now (log: ${logFile}).`
      : `Daemon ${state.pid} restarts once no session is running a turn (log: ${logFile}). Phones reconnect by themselves.`,
  );
}
