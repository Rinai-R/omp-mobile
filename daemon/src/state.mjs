/** The running daemon's state file, as `/mobile` and `omp-mobile relay` read it. */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const STATE_FILE = join(homedir(), ".omp-mobile", "daemon.json");

/**
 * The running daemon's record, if its process is alive.
 * @returns {{pid: number, version: string, url: string, pair: string, relay?: string | null, startedAt: number} | undefined}
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

export function alive(pid) {
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
