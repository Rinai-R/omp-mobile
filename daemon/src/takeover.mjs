/**
 * Taking a session over from the other omp process that holds it.
 *
 * OMP lets one process write a session: the first write takes the session's
 * owner lock (`<omp home>/run/session-owners/<id>.lock`, an OS lock the
 * kernel drops when the process exits), and a second process that writes the
 * same session moves to a new file (a fork with `parentSession` set) instead
 * of mixing entries into the owner's journal. OMP has no way to attach a
 * second process to a running one (Collab needs the owner to host a room on
 * a relay), so the phone continues a session by asking its owner to leave:
 *
 * 1. A request file beside the session file (`.<name>.omp-mobile-takeover`)
 *    that the omp-mobile extension in the owner watches: it says where the
 *    session went, stops the turn, and exits through OMP's own shutdown.
 * 2. Without an answer from the extension, the owner gets `SIGINT`, then
 *    `SIGTERM`: OMP routes both through the teardown its Ctrl+C runs (the
 *    turn is aborted, the session flushed and closed with a `session_exit`
 *    entry, the lock released). Never `SIGKILL`.
 *
 * Only the owner is ever signalled: a process that holds the session without
 * owning it would fork it into a new file as it saves on exit.
 */
import { execFile } from "node:child_process";
import { closeSync, constants, openSync, readdirSync, readSync, renameSync, rmSync, statSync, writeFileSync, writeSync } from "node:fs";
import { basename, dirname, join } from "node:path";

/**
 * How long each step waits before the next, in milliseconds. The extension
 * path (a terminal with the plugin loaded) answers within a second or two;
 * the signal path is the fallback for an omp that predates the extension, and
 * OMP leaves on SIGINT promptly, so the waits are short rather than generous.
 */
export const TAKEOVER_TIMINGS = {
  /** For the extension to pick up the request (it polls every 500 ms). */
  ack: 1_500,
  /** For an owner whose extension took the request to exit (OMP closes once its session is idle). */
  extensionExit: 10_000,
  /** After `SIGINT`, then after `SIGTERM`. */
  sigint: 5_000,
  sigterm: 5_000,
  poll: 100,
};

/** How far from the end of a session file the last message is looked for. */
const TAIL_BYTES = 256 * 1024;

/** The request file the owner's extension watches. */
export function requestPath(sessionFile) {
  return join(dirname(sessionFile), `.${basename(sessionFile)}.omp-mobile-takeover`);
}

/** Whether `pid` is a live process this user may signal. */
export function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

/**
 * What a process is: its command and controlling terminal (`ttys007`), or
 * `undefined` when there is no such process.
 * @returns {Promise<{pid: number, command: string, tty: string | undefined} | undefined>}
 */
export function processInfo(pid) {
  return new Promise((resolveInfo) => {
    execFile("ps", ["-o", "tty=", "-o", "args=", "-p", String(pid)], { timeout: 5_000 }, (error, stdout) => {
      const line = stdout?.split("\n").find((text) => text.trim() !== "");
      if (error || line === undefined) {
        resolveInfo(undefined);
        return;
      }
      const [, tty = "", command = ""] = /^\s*(\S+)\s+(.*)$/.exec(line) ?? [];
      resolveInfo({ pid, command: command.trim(), tty: /^(\?+|-)$/.test(tty) || tty === "" ? undefined : tty });
    });
  });
}

/** Whether a command line runs omp: the binary, or an interpreter running a script named omp. */
export function isOmpCommand(command) {
  const [program = "", script = ""] = command.trim().split(/\s+/);
  return /(^|\/)omp$/.test(program) || /(^|\/)(node|bun)$/.test(program) && /(^|\/)omp$/.test(script);
}

/**
 * Whether the session's last message leaves a turn running: a prompt or tool
 * result not answered yet, or an assistant message that called tools. OMP
 * writes the assistant's reply when it ends, so a streaming turn ends in the
 * user's prompt.
 * @param {string} sessionFile
 */
export function sessionBusy(sessionFile) {
  let fd;
  try {
    fd = openSync(sessionFile, "r");
    const size = statSync(sessionFile).size;
    const length = Math.min(size, TAIL_BYTES);
    const buffer = Buffer.alloc(length);
    readSync(fd, buffer, 0, length, size - length);
    const lines = buffer.toString("utf8").split("\n");
    for (let i = lines.length - 1; i >= 0; i -= 1) {
      let entry;
      try {
        entry = JSON.parse(lines[i]);
      } catch {
        continue;
      }
      if (entry?.type !== "message" || entry.message === null || typeof entry.message !== "object") continue;
      const { role, stopReason } = entry.message;
      if (role === "assistant") return stopReason === "toolUse";
      return role === "user" || role === "toolResult";
    }
    return false;
  } catch {
    return false;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/**
 * Session files in `dir` forked from `sessionId` (their header's
 * `parentSession`) and written since `since`: what a second writer leaves.
 */
export function forksOf(dir, sessionId, since) {
  let names;
  try {
    names = readdirSync(dir).filter((name) => name.endsWith(".jsonl"));
  } catch {
    return [];
  }
  const forks = [];
  for (const name of names) {
    const file = join(dir, name);
    let fd;
    try {
      if (statSync(file).mtimeMs < since) continue;
      fd = openSync(file, "r");
      const buffer = Buffer.alloc(64 * 1024);
      const head = buffer.toString("utf8", 0, readSync(fd, buffer, 0, buffer.length, 0));
      for (const line of head.split("\n").slice(0, 3)) {
        try {
          const entry = JSON.parse(line);
          if (entry?.type === "session" && entry.parentSession === sessionId) forks.push(file);
        } catch {
          // Not a header line.
        }
      }
    } catch {
      // Removed while looking.
    } finally {
      if (fd !== undefined) closeSync(fd);
    }
  }
  return forks;
}

/**
 * Write a line to a terminal (`ttys007`) the owner ran in, after it left, so
 * whoever looks at it sees why omp closed. Best effort.
 */
export function tellTerminal(tty, text) {
  if (!/^tty[A-Za-z0-9]+$/.test(tty)) return false;
  let fd;
  try {
    fd = openSync(`/dev/${tty}`, constants.O_WRONLY | constants.O_NOCTTY | constants.O_NONBLOCK);
    writeSync(fd, `\r\n${text}\r\n`);
    return true;
  } catch {
    return false;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/** What the terminal is told once omp left it. */
export function takeoverFarewell(device) {
  return `omp-mobile: this session continues on ${device}. omp closed here so the phone could take it over.`;
}

const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));

/** Wait until `done()` or `ms` passed; whether it became true. */
async function waitFor(done, ms, poll) {
  const deadline = Date.now() + ms;
  while (!done()) {
    if (Date.now() >= deadline) return false;
    await sleep(poll);
  }
  return true;
}

function exists(path) {
  try {
    statSync(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Ask the owner of a session to leave, escalating until it exited.
 * Resolves how it left; rejects (status 504) when it is still running after
 * `SIGTERM`, in which case it still has the session.
 * @param {{pid: number, sessionId: string, sessionFile: string, device: string, timings?: Partial<typeof TAKEOVER_TIMINGS>, kill?: (pid: number, signal: string) => void, isAlive?: (pid: number) => boolean}} options
 * @returns {Promise<{via: "extension" | "SIGINT" | "SIGTERM" | "exited", waitedMs: number}>}
 */
export async function askOwnerToLeave({ pid, sessionId, sessionFile, device, timings = {}, kill = process.kill.bind(process), isAlive = alive }) {
  const t = { ...TAKEOVER_TIMINGS, ...timings };
  const started = Date.now();
  const gone = () => !isAlive(pid);
  const result = (via) => ({ via, waitedMs: Date.now() - started });
  if (gone()) return result("exited");

  const request = requestPath(sessionFile);
  const staging = `${request}.${process.pid}.tmp`;
  let written = false;
  try {
    writeFileSync(staging, `${JSON.stringify({ pid, sessionId, device, at: Date.now() })}\n`, { mode: 0o600 });
    renameSync(staging, request);
    written = true;
  } catch {
    rmSync(staging, { force: true });
  }
  try {
    // The extension removes the request when it takes it, then shuts omp down.
    if (written && (await waitFor(() => gone() || !exists(request), t.ack, t.poll))) {
      const taken = !exists(request);
      if (await waitFor(gone, taken ? t.extensionExit : 0, t.poll)) return result(taken ? "extension" : "exited");
    }
  } finally {
    rmSync(request, { force: true });
  }
  for (const signal of ["SIGINT", "SIGTERM"]) {
    try {
      kill(pid, signal);
    } catch (error) {
      if (error?.code === "ESRCH") return result("exited");
      throw error;
    }
    if (await waitFor(gone, signal === "SIGINT" ? t.sigint : t.sigterm, t.poll)) return result(signal);
  }
  throw Object.assign(new Error(`The omp process (pid ${pid}) did not exit after SIGINT and SIGTERM; it still has this session.`), {
    status: 504,
  });
}
