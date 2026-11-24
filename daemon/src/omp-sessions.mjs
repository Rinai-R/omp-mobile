/**
 * Sessions OMP wrote outside this daemon: the terminal sessions in OMP's own
 * session directory, and which of them another omp process holds open.
 *
 * Reads only what OMP documents as its on-disk contract: one directory per
 * cwd under `<omp home>/agent/sessions`, JSONL files that begin with an
 * optional fixed-width `title` slot and the `session` header, and the owner
 * lock each writing process holds in `<omp home>/run/session-owners/<id>.lock`.
 */
import { execFile } from "node:child_process";
import { open, readdir, stat } from "node:fs/promises";
import { basename, join } from "node:path";

/** How far into a file the first prompt is looked for; headers and setup entries come first. */
const TITLE_SCAN_BYTES = 512 * 1024;
const CHUNK_BYTES = 64 * 1024;
const LSOF_TIMEOUT_MS = 5_000;

/** @typedef {{id: string, title: string, cwd: string, createdAt: number, updatedAt: number, size: number, sessionFile: string}} OmpSession */

/** Text of an OMP message content field (string or content-part array). */
function textOfContent(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object" && typeof part.text === "string") return part.text;
        return "";
      })
      .join("");
  }
  return "";
}

/** The first user prompt, as one line of at most 80 characters. */
export function promptTitle(content) {
  return oneLine(textOfContent(content));
}

/**
 * A title as one line of at most 80 characters. OMP's title cards start with
 * a Nerd Font icon (private-use code points) a phone font has no glyph for.
 */
export function oneLine(text) {
  return text
    .replace(/[\uE000-\uF8FF\u{F0000}-\u{10FFFF}]/gu, "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 80);
}

/**
 * Read a session file's identity and title.
 * Undefined when the file has no `session` header (not an OMP session, or still empty).
 * @param {string} file
 * @returns {Promise<OmpSession | undefined>}
 */
export async function readSessionFile(file) {
  const handle = await open(file, "r");
  try {
    const info = await handle.stat();
    let header;
    let slotTitle = "";
    let firstPrompt = "";
    let rest = "";
    let offset = 0;
    const buffer = Buffer.alloc(CHUNK_BYTES);
    scan: while (offset < TITLE_SCAN_BYTES) {
      const { bytesRead } = await handle.read(buffer, 0, CHUNK_BYTES, offset);
      if (bytesRead === 0) break;
      offset += bytesRead;
      rest += buffer.toString("utf8", 0, bytesRead);
      const lines = rest.split("\n");
      rest = lines.pop() ?? "";
      for (const line of lines) {
        let entry;
        try {
          entry = JSON.parse(line);
        } catch {
          continue;
        }
        if (entry?.type === "title" && header === undefined) {
          if (typeof entry.title === "string") slotTitle = oneLine(entry.title);
        } else if (entry?.type === "session") {
          header = entry;
          if (slotTitle === "" && typeof entry.title === "string") slotTitle = oneLine(entry.title);
          if (slotTitle !== "") break scan;
        } else if (header === undefined) {
          // Legacy files begin with the header; anything else first is not a session.
          return undefined;
        } else if (entry?.type === "message" && entry.message?.role === "user") {
          firstPrompt = promptTitle(entry.message.content);
          if (firstPrompt !== "") break scan;
        }
      }
    }
    if (header === undefined || typeof header.id !== "string" || typeof header.cwd !== "string") return undefined;
    const created = Date.parse(header.timestamp);
    return {
      id: header.id,
      title: slotTitle || firstPrompt || basename(header.cwd) || "session",
      cwd: header.cwd,
      createdAt: Number.isFinite(created) ? created : info.birthtimeMs,
      updatedAt: info.mtimeMs,
      // With the time, what tells this daemon's own omp leaving the file from someone writing it.
      size: info.size,
      sessionFile: file,
    };
  } finally {
    await handle.close();
  }
}

/**
 * The most recently written sessions under OMP's session root, newest first.
 * A missing root is no sessions; unreadable or foreign files are skipped.
 * @param {string} root `<omp home>/agent/sessions`
 * @param {{limit?: number}} [options]
 * @returns {Promise<OmpSession[]>}
 */
export async function listOmpSessions(root, { limit = 50 } = {}) {
  let dirs;
  try {
    dirs = await readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }
  /** @type {{file: string, mtime: number}[]} */
  const files = [];
  await Promise.all(
    dirs
      .filter((dir) => dir.isDirectory())
      .map(async (dir) => {
        const path = join(root, dir.name);
        let names;
        try {
          names = await readdir(path);
        } catch {
          return;
        }
        await Promise.all(
          names
            .filter((name) => name.endsWith(".jsonl"))
            .map(async (name) => {
              const file = join(path, name);
              try {
                files.push({ file, mtime: (await stat(file)).mtimeMs });
              } catch {
                // Removed while listing.
              }
            }),
        );
      }),
  );
  files.sort((a, b) => b.mtime - a.mtime);
  const sessions = [];
  const seen = new Set();
  for (const { file } of files) {
    if (sessions.length >= limit) break;
    let session;
    try {
      session = await readSessionFile(file);
    } catch {
      continue;
    }
    // A moved session can leave an older copy; the newest file wins.
    if (session === undefined || seen.has(session.id)) continue;
    seen.add(session.id);
    sessions.push(session);
  }
  return sessions;
}

/**
 * Session ids whose owner lock some process holds open, with that process id.
 * `undefined` when ownership cannot be read (no `lsof`), which callers must not treat as "nobody".
 * @param {string} ownersDir `<omp home>/run/session-owners`
 * @param {{lsof?: string}} [options]
 * @returns {Promise<Map<string, number> | undefined>}
 */
export function sessionOwners(ownersDir, { lsof = "lsof" } = {}) {
  return new Promise((resolveOwners) => {
    // -F pn: one `p<pid>` line per process, then `n<path>` per open file.
    execFile(lsof, ["-n", "-w", "-F", "pn", "+d", ownersDir], { timeout: LSOF_TIMEOUT_MS }, (error, stdout) => {
      // lsof exits 1 when nothing in the directory is open; that is an answer.
      if (error && (typeof error.code !== "number" || stdout === "")) {
        resolveOwners(error.code === 1 ? new Map() : undefined);
        return;
      }
      resolveOwners(parseLsof(stdout));
    });
  });
}

/** How much of a session file a transcript read looks at: enough for the last turns of a long one. */
const TRANSCRIPT_TAIL_BYTES = 4 * 1024 * 1024;
/** Messages kept from that tail; older ones are dropped from the front and counted in `base`. */
const TRANSCRIPT_TAIL_MESSAGES = 400;

/**
 * The messages OMP wrote into a session file, for a session this daemon never
 * opened: a phone can read a conversation that a terminal omp holds, before
 * taking it over. Only its tail is read (a long session's file grows to
 * megabytes), and only its `message` entries are taken; everything else in
 * the file (title, model changes, custom frames) is not a message.
 * @param {string} file
 * @param {{bytes?: number, messages?: number}} [options]
 * @returns {Promise<{messages: any[], base: number}|undefined>} undefined when the file is not readable
 */
export async function readSessionMessages(file, options = {}) {
  const bytes = options.bytes ?? TRANSCRIPT_TAIL_BYTES;
  const limit = options.messages ?? TRANSCRIPT_TAIL_MESSAGES;
  let handle;
  try {
    handle = await open(file, "r");
    const info = await handle.stat();
    const from = Math.max(0, info.size - bytes);
    // Messages in the part not read, so the indices the phone gets still count from the
    // session's first message: a truncated transcript says where in the session it starts.
    const skipped = from === 0 ? 0 : await countMessages(handle, from);
    // One byte before the cut says whether it falls on a line start or inside a line.
    const lead = from > 0 ? 1 : 0;
    const buffer = Buffer.alloc(info.size - from + lead);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, from - lead);
    let text = buffer.toString("utf8", 0, bytesRead);
    if (lead === 1 && buffer[0] !== 0x0a) {
      // Starting mid-line: the first line is the fragment of a message already cut.
      text = text.slice(text.indexOf("\n") + 1);
    } else if (lead === 1) {
      text = text.slice(1);
    }
    const messages = [];
    for (const line of text.split("\n")) {
      if (line === "") continue;
      let entry;
      try {
        entry = JSON.parse(line);
      } catch {
        continue;
      }
      if (entry?.type === "message" && entry.message !== null && typeof entry.message === "object") messages.push(entry.message);
    }
    const kept = messages.slice(-limit);
    return { messages: kept, base: skipped + messages.length - kept.length };
  } catch {
    return undefined;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

/** How many `message` entries the first `end` bytes of a session file hold, counted by their marker. */
async function countMessages(handle, end) {
  const marker = Buffer.from('{"type":"message"');
  const size = 1024 * 1024;
  const buffer = Buffer.alloc(size + marker.length);
  let count = 0;
  let carry = 0;
  let offset = 0;
  while (offset < end) {
    const want = Math.min(size, end - offset);
    const { bytesRead } = await handle.read(buffer, carry, want, offset);
    if (bytesRead === 0) break;
    const view = buffer.subarray(0, carry + bytesRead);
    let at = view.indexOf(marker);
    while (at !== -1) {
      count += 1;
      at = view.indexOf(marker, at + marker.length);
    }
    // A marker split across two reads is counted once, when its start is in the next view.
    carry = Math.min(marker.length - 1, view.length);
    view.copy(buffer, 0, view.length - carry);
    offset += bytesRead;
  }
  return count;
}

/** @param {string} output `lsof -F pn` output */
export function parseLsof(output) {
  const owners = new Map();
  let pid = 0;
  for (const line of output.split("\n")) {
    if (line.startsWith("p")) pid = Number(line.slice(1));
    else if (line.startsWith("n") && line.endsWith(".lock") && pid > 0) owners.set(basename(line.slice(1), ".lock"), pid);
  }
  return owners;
}
