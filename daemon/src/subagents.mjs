/**
 * A session's subagents, read where OMP keeps them (`session/sub-sessions.ts`):
 * a session at `<dir>/<name>.jsonl` stores each subagent's own session at
 * `<dir>/<name>/<AgentId>.jsonl`, and a subagent's children nest the same way
 * under `<dir>/<name>/<AgentId>/`. Reading the files serves sessions whose omp
 * has exited too; a live omp only adds which subagents still run (its RPC
 * `get_subagents` lists running ones only and forgets them once they end).
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { deltaFrom } from "./transcripts.mjs";

/** One agent id as OMP allocates it (a name, `-2` on a repeat, `.` before a nested child's own). */
const SEGMENT = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,159}$/;
/** The stem of OMP's advisor transcripts (`advisor/transcript-recorder.ts`). */
const ADVISOR = "__advisor";
/** Deep enough for any real delegation chain; a symlink loop cannot recurse past it. */
const MAX_DEPTH = 6;
/** The assignment shown in a list: its start, the rest is in the transcript. */
const TASK_EXCERPT = 300;
/** Parsed files kept while their size and mtime hold: the app polls a running subagent's transcript. */
const CACHE_LIMIT = 32;
/** @type {Map<string, {mtimeMs: number, size: number, parsed: Parsed}>} */
const cache = new Map();

/**
 * @typedef {{agent?: string, task?: string, messages: any[]}} Parsed
 * @typedef {{id: string, agentId: string, parent: string | null, file: string, aborted: boolean}} Found
 * @typedef {{id?: string, status?: string, description?: string, parentToolCallId?: string, sessionFile?: string}} LiveSnapshot
 */

/** Where a session's subagent transcripts live; undefined for a file that is not a session. */
export function subagentDir(sessionFile) {
  return typeof sessionFile === "string" && sessionFile.endsWith(".jsonl") ? sessionFile.slice(0, -6) : undefined;
}

/**
 * Every subagent transcript under a session, parents before their children.
 * `id` is the slash-joined path of agent ids from the session ("Scout", "Scout/Helper").
 * @param {string} sessionFile
 * @returns {Found[]}
 */
export function findSubagents(sessionFile) {
  const dir = subagentDir(sessionFile);
  /** @type {Found[]} */
  const found = [];
  if (dir !== undefined) walk(dir, null, 0, found);
  return found;
}

/** @param {string} dir @param {string | null} parent @param {number} depth @param {Found[]} out */
function walk(dir, parent, depth, out) {
  let dirents;
  try {
    dirents = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  const files = new Set();
  const dirs = new Set();
  for (const dirent of dirents) {
    if (dirent.isFile()) files.add(dirent.name);
    else if (dirent.isDirectory()) dirs.add(dirent.name);
  }
  for (const name of [...files].sort()) {
    if (!name.endsWith(".jsonl")) continue;
    const agentId = name.slice(0, -6);
    // `__advisor.jsonl` and `__advisor.<slug>.jsonl` share the directory and are not subagents; backups are not either.
    if (!SEGMENT.test(agentId) || agentId === ADVISOR || agentId.startsWith(`${ADVISOR}.`) || name.includes(".bak")) continue;
    const id = parent === null ? agentId : `${parent}/${agentId}`;
    out.push({ id, agentId, parent, file: join(dir, name), aborted: files.has(`${name}.tombstone`) });
    // Only real directories: a symlinked one could loop back up the tree.
    if (depth + 1 < MAX_DEPTH && dirs.has(agentId)) walk(join(dir, agentId), id, depth + 1, out);
  }
}

/**
 * The transcript at `id` under a session; undefined for an id that is malformed
 * or names no transcript. Segments are checked, so no id leaves the session's directory.
 * @param {string} sessionFile
 * @param {string} id
 */
export function subagentFile(sessionFile, id) {
  const dir = subagentDir(sessionFile);
  const segments = id.split("/");
  if (dir === undefined || segments.length > MAX_DEPTH || !segments.every((segment) => SEGMENT.test(segment))) return undefined;
  const file = join(dir, ...segments.slice(0, -1), `${segments.at(-1)}.jsonl`);
  return existsSync(file) ? file : undefined;
}

/**
 * A subagent session file's messages in order, its agent type and assignment
 * (OMP's `session_init` entry). Lines that do not parse (a write in progress) are skipped.
 * @param {string} file
 * @returns {Parsed | undefined}
 */
export function readSubagent(file) {
  let info;
  try {
    info = statSync(file);
  } catch {
    return undefined;
  }
  const hit = cache.get(file);
  if (hit !== undefined && hit.mtimeMs === info.mtimeMs && hit.size === info.size) return hit.parsed;
  /** @type {Parsed} */
  const parsed = { messages: [] };
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (line === "") continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (entry?.type === "message" && entry.message !== null && typeof entry.message === "object") parsed.messages.push(entry.message);
    else if (entry?.type === "session_init") {
      if (typeof entry.agent === "string") parsed.agent = entry.agent;
      if (typeof entry.task === "string") parsed.task = entry.task;
    }
  }
  cache.delete(file);
  cache.set(file, { mtimeMs: info.mtimeMs, size: info.size, parsed });
  while (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value);
  return parsed;
}

/**
 * How a subagent stands: running while the live omp lists it; else from its
 * transcript: killed (a tombstone, or a last reply that was aborted), failed
 * (a last reply that errored), or completed. One that stopped mid-step
 * without a final reply is running when its omp is live but could not say
 * (`unsure`: an omp without `get_subagents`), aborted otherwise (its omp exited).
 * @param {{aborted: boolean, live?: LiveSnapshot, unsure?: boolean, messages: any[]}} subagent
 * @returns {"running" | "completed" | "failed" | "aborted"}
 */
export function statusOf({ aborted, live, unsure = false, messages }) {
  if (live !== undefined) return "running";
  if (aborted) return "aborted";
  const last = messages.at(-1);
  if (last?.role === "assistant" && last.stopReason === "error") return "failed";
  if (last?.role === "assistant" && last.stopReason === "aborted") return "aborted";
  if (last?.role === "assistant" && last.stopReason !== "toolUse") return "completed";
  return unsure ? "running" : "aborted";
}

/**
 * The phone's list entry for one subagent. `running`: the live omp's
 * `get_subagents`; null when it is live but could not answer; undefined when no omp runs.
 * @param {Found} found
 * @param {Parsed} parsed
 * @param {readonly LiveSnapshot[] | null | undefined} running
 */
function summaryOf(found, parsed, running) {
  let updatedAt = 0;
  try {
    updatedAt = statSync(found.file).mtimeMs;
  } catch {
    // Removed between the walk and now: it is listed as it was read.
  }
  // OMP lists pending and running subagents only, and drops one as it ends.
  const live = running?.find((snapshot) => snapshot?.sessionFile === found.file);
  const task = parsed.task?.trim();
  return {
    id: found.id,
    agentId: found.agentId,
    parent: found.parent,
    agent: parsed.agent,
    description: live?.description,
    task: task === undefined || task === "" ? undefined : task.length > TASK_EXCERPT ? `${task.slice(0, TASK_EXCERPT)}…` : task,
    status: statusOf({ aborted: found.aborted, live, unsure: running === null, messages: parsed.messages }),
    messageCount: parsed.messages.length,
    updatedAt: Math.round(updatedAt),
    parentToolCallId: live?.parentToolCallId,
  };
}

/**
 * Every subagent of a session, parents before their children.
 * @param {string} sessionFile
 * @param {readonly LiveSnapshot[] | null} [running] see `summaryOf`
 */
export function listSubagents(sessionFile, running) {
  const list = [];
  for (const found of findSubagents(sessionFile)) {
    const parsed = readSubagent(found.file);
    if (parsed !== undefined) list.push(summaryOf(found, parsed, running));
  }
  return list;
}

/**
 * One subagent and its messages: those after what the phone holds when its
 * copy lines up (`since`/`last`, as `/transcript`), else all of them.
 * @param {string} sessionFile
 * @param {string} id
 * @param {readonly LiveSnapshot[] | null | undefined} running see `summaryOf`
 * @param {{since: number, last: string}} held
 * @param {(message: any) => any} toPhone
 */
export function subagentTranscript(sessionFile, id, running, held, toPhone) {
  const file = subagentFile(sessionFile, id);
  const parsed = file === undefined ? undefined : readSubagent(file);
  if (file === undefined || parsed === undefined) return undefined;
  const segments = id.split("/");
  const found = {
    id,
    agentId: segments.at(-1) ?? id,
    parent: segments.length > 1 ? segments.slice(0, -1).join("/") : null,
    file,
    aborted: existsSync(`${file}.tombstone`),
  };
  const subagent = summaryOf(found, parsed, running);
  const { messages } = parsed;
  const from = deltaFrom(messages, held.since, held.last);
  return { subagent, from, total: messages.length, messages: messages.slice(from).map(toPhone) };
}
