/**
 * The source a fork is made from. A whole-session fork is OMP's own
 * `omp --fork <file>`, which only reads the file. A fork from one message
 * first cuts the file to the path from its root to that message into a
 * private temporary copy, keeping the original header (same session id), so
 * `omp --fork` of the copy records the original as the fork's parent, exactly
 * as a whole-session fork does. The original file is never written.
 */
import { cp, mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

/** @typedef {{role: "user" | "assistant", timestamp: number}} ForkPoint */

/**
 * Whether `value` names a message to fork from.
 * @returns {value is ForkPoint}
 */
export function isForkPoint(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    (value.role === "user" || value.role === "assistant") &&
    Number.isFinite(value.timestamp)
  );
}

/**
 * The lines of a fork cut at `at`: the leading `title` slot and `session`
 * header as they are, then the entries from the root to the message, through
 * the tool results of its tool-call batch (OMP's `fork` never ends on calls
 * whose results it dropped). Label entries are dropped and leaf markers
 * cleared, as OMP's own branched sessions do. Undefined when no message matches.
 * @param {string} text the session file
 * @param {ForkPoint} at
 * @returns {string[] | undefined}
 */
export function cutAt(text, at) {
  const lines = text.split("\n").filter((line) => line.trim() !== "");
  /** @type {string[]} */
  const head = [];
  /** @type {Map<string, {line: string, entry: any}>} */
  const byId = new Map();
  /** @type {Map<string, string[]>} children ids in file order */
  const children = new Map();
  let target;
  let headerSeen = false;
  for (const line of lines) {
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (!headerSeen) {
      if (entry?.type === "title" || entry?.type === "session") head.push(line);
      if (entry?.type === "session") headerSeen = true;
      continue;
    }
    if (typeof entry?.id !== "string") continue;
    byId.set(entry.id, { line, entry });
    const parent = typeof entry.parentId === "string" ? entry.parentId : "";
    const list = children.get(parent) ?? [];
    list.push(entry.id);
    children.set(parent, list);
    if (entry.type === "message" && entry.message?.role === at.role && entry.message?.timestamp === at.timestamp) target = entry.id;
  }
  if (!headerSeen || target === undefined) return undefined;

  const pathTo = (id) => {
    const path = [];
    const seen = new Set();
    for (let cursor = id; typeof cursor === "string" && byId.has(cursor) && !seen.has(cursor); cursor = byId.get(cursor).entry.parentId) {
      seen.add(cursor);
      path.push(cursor);
    }
    return path.reverse();
  };

  // The tool calls of the batch the message belongs to that have no result on the path yet.
  const answered = new Set();
  let batch;
  const path = pathTo(target);
  for (let index = path.length - 1; index >= 0; index -= 1) {
    const entry = byId.get(path[index]).entry;
    if (entry.type !== "message") continue;
    if (entry.message.role === "toolResult") {
      answered.add(entry.message.toolCallId);
      continue;
    }
    if (entry.message.role === "assistant") batch = entry.message;
    break;
  }
  const pending = new Set();
  for (const block of Array.isArray(batch?.content) ? batch.content : []) {
    if (block?.type === "toolCall" && !answered.has(block.id)) pending.add(block.id);
  }
  let leaf = target;
  let cursor = target;
  while (pending.size > 0) {
    const kids = (children.get(cursor) ?? []).map((id) => byId.get(id).entry);
    const result = kids.findLast((kid) => kid.type === "message" && kid.message?.role === "toolResult" && pending.has(kid.message.toolCallId));
    if (result !== undefined) {
      pending.delete(result.message.toolCallId);
      leaf = cursor = result.id;
      continue;
    }
    // Step over a lone bookkeeping entry; any message or fork in the tree ends the batch.
    if (kids.length !== 1 || kids[0].type === "message") break;
    cursor = kids[0].id;
  }

  const kept = [];
  for (const id of pathTo(leaf)) {
    const { line, entry } = byId.get(id);
    if (entry.type === "label") continue;
    if (entry.activeLeafId === undefined) {
      kept.push(line);
      continue;
    }
    const { activeLeafId: _leaf, ...rest } = entry;
    kept.push(JSON.stringify(rest));
  }
  return [...head, ...kept];
}

/**
 * Write the cut of `sourceFile` at `at` to a private temporary directory.
 * Resolves to the copy and a cleanup, or undefined when no message matches.
 * @param {string} sourceFile
 * @param {ForkPoint} at
 * @returns {Promise<{file: string, remove: () => Promise<void>} | undefined>}
 */
export async function writeCut(sourceFile, at) {
  const lines = cutAt(await readFile(sourceFile, "utf8"), at);
  if (lines === undefined) return undefined;
  const dir = await mkdtemp(join(tmpdir(), "omp-mobile-fork-"));
  const file = join(dir, basename(sourceFile));
  await writeFile(file, `${lines.join("\n")}\n`, { mode: 0o600 });
  return { file, remove: () => rm(dir, { recursive: true, force: true }) };
}

/**
 * Copy a session's artifact directory (beside its file, without `.jsonl`) to
 * the fork's, merging and never overwriting, as OMP's own `/fork` does: kept
 * tool results cite `artifact://N`. A fork cut from a temporary copy has to
 * be given them; `omp --fork` of the copy finds none beside it.
 * @param {string} sourceFile
 * @param {string} forkFile
 */
export async function copyArtifacts(sourceFile, forkFile) {
  const real = await realpath(sourceFile).catch(() => sourceFile);
  if (!real.endsWith(".jsonl") || !forkFile.endsWith(".jsonl")) return;
  const from = real.slice(0, -".jsonl".length);
  const to = forkFile.slice(0, -".jsonl".length);
  try {
    if (!(await stat(from)).isDirectory()) return;
  } catch {
    return;
  }
  await mkdir(to, { recursive: true });
  await cp(from, to, { recursive: true, force: false, errorOnExist: false });
}
