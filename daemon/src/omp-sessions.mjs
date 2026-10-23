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

/** @typedef {{id: string, title: string, cwd: string, createdAt: number, updatedAt: number, sessionFile: string}} OmpSession */

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
function oneLine(text) {
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
