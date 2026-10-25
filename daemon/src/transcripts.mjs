/**
 * The daemon's saved transcripts: the slim messages of each session it had
 * open, written when the session's omp exits (the reaper, the daemon
 * stopping, omp leaving on its own), so a phone can read a recent session
 * without the daemon starting an omp for it.
 *
 * A record is valid while the session file it was read from has the same
 * modification time and size: anything that wrote the session since (a
 * terminal omp, a resume elsewhere) makes it stale, and it is not served.
 * Records are kept while their session was active in the last
 * {@link RECENT_MS}; nothing is evicted by count.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** How long after its last activity a session's transcript is kept, on the computer and on the phone. */
export const RECENT_MS = 24 * 60 * 60_000;
const VERSION = 1;
const NAME = /^[A-Za-z0-9_-]{1,140}\.json$/;
/** A temporary file left by a write that never finished (a crash) is dropped after this long. */
const TEMP_MAX_AGE_MS = 60_000;
let writes = 0;

/**
 * What identifies one message well enough to line a phone's copy up with the
 * daemon's: OMP stamps every message, and tool results and replies carry ids.
 * The app computes the same string (`app/src/cache.ts`).
 * @param {any} message
 */
export function fingerprint(message) {
  if (message === null || typeof message !== "object") return "";
  const id = typeof message.toolCallId === "string" ? message.toolCallId : typeof message.responseId === "string" ? message.responseId : "";
  return `${String(message.role ?? "")}:${String(message.timestamp ?? "")}:${id}`;
}

/**
 * Where a phone that holds the first `since` messages (the last of them
 * fingerprinted `last`) can continue: `since` when its copy lines up with
 * `messages` there, else 0 (send everything).
 * @param {readonly any[]} messages
 * @param {number} since
 * @param {string} last
 */
export function deltaFrom(messages, since, last) {
  if (!Array.isArray(messages) || !Number.isSafeInteger(since) || since <= 0 || since > messages.length) return 0;
  if (typeof last !== "string" || last === "") return 0;
  return fingerprint(messages[since - 1]) === last ? since : 0;
}

/**
 * The `since` and `last` query parameters, as a phone sends them; anything
 * malformed reads as "nothing held" (a whole transcript).
 * @param {URLSearchParams} searchParams
 */
export function deltaQuery(searchParams) {
  const raw = searchParams.get("since") ?? "";
  const since = /^\d{1,9}$/.test(raw) ? Number(raw) : 0;
  return { since, last: searchParams.get("last") ?? "" };
}

/**
 * The body of a snapshot frame or a `/transcript` answer: the messages after
 * what the phone holds when its copy lines up, else all of them. `from` is the
 * index of the first message sent (0: the whole transcript), `total` how many
 * the daemon holds.
 * @param {{session: any, state: any, messages: any[]}} transcript
 * @param {{since: number, last: string}} [held]
 */
export function deltaBody({ session, state, messages }, held = { since: 0, last: "" }) {
  const from = deltaFrom(messages, held.since, held.last);
  return { session, state, from, total: messages.length, messages: from === 0 ? messages : messages.slice(from) };
}

function fileState(path) {
  try {
    const info = statSync(path);
    return info.isFile() ? { mtimeMs: info.mtimeMs, size: info.size } : undefined;
  } catch {
    return undefined;
  }
}

/** A record that still describes its session file as it is now. */
function current(record) {
  if (typeof record?.sessionFile !== "string") return false;
  const now = fileState(record.sessionFile);
  return now !== undefined && now.mtimeMs === record.file?.mtimeMs && now.size === record.file?.size;
}

export class TranscriptStore {
  /** @param {string} dir */
  constructor(dir) {
    this.dir = dir;
  }

  /** @param {string} id */
  path(id) {
    const safe = id.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 120);
    // Two ids that differ only in characters a file name cannot carry must not share a file.
    const name = safe === id ? safe : `${safe}-${createHash("sha256").update(id).digest("hex").slice(0, 16)}`;
    return join(this.dir, `${name}.json`);
  }

  /**
   * Save a session's slim messages against the current state of its file:
   * call it once omp has exited, when the file is final. Best effort: a full
   * disk only loses the shortcut.
   * @param {string} id
   * @param {{sessionFile?: string, messages: any[], state: any, session: any}} record
   * @returns {boolean} whether it was saved
   */
  write(id, { sessionFile, messages, state, session }) {
    if (typeof id !== "string" || id === "" || typeof sessionFile !== "string" || !Array.isArray(messages)) return false;
    const file = fileState(sessionFile);
    if (file === undefined) return false;
    const path = this.path(id);
    writes += 1;
    const temporary = `${path}.${process.pid}-${writes}.tmp`;
    // No omp runs for it any more: nothing streams and nothing waits for an answer.
    const record = {
      v: VERSION,
      id,
      sessionFile,
      file,
      savedAt: Date.now(),
      activeAt: Math.max(file.mtimeMs, Number(session?.updatedAt) || 0),
      messages,
      state: state !== null && typeof state === "object" ? { ...state, isStreaming: false } : state,
      session: { ...session, status: "idle", waiting: 0 },
    };
    try {
      mkdirSync(this.dir, { recursive: true, mode: 0o700 });
      writeFileSync(temporary, JSON.stringify(record), { mode: 0o600 });
      renameSync(temporary, path);
      return true;
    } catch {
      try {
        unlinkSync(temporary);
      } catch {
        // Never written.
      }
      return false;
    }
  }

  /**
   * A saved transcript that still matches its session file, else undefined.
   * Its session's `updatedAt` is at least the file's time: the file is what a
   * session list dates the session by.
   * @param {string} id
   * @param {string | undefined} sessionFile the file the session is known by now, when known
   */
  read(id, sessionFile) {
    let record;
    try {
      record = JSON.parse(readFileSync(this.path(id), "utf8"));
    } catch {
      return undefined;
    }
    if (record?.v !== VERSION || record.id !== id || !Array.isArray(record.messages)) return undefined;
    if (sessionFile !== undefined && record.sessionFile !== sessionFile) return undefined;
    if (!current(record)) return undefined;
    const session = record.session !== null && typeof record.session === "object" ? record.session : { id };
    return { ...record, session: { ...session, updatedAt: Math.max(Number(session.updatedAt) || 0, record.file.mtimeMs) } };
  }

  /** @param {string} id */
  remove(id) {
    try {
      unlinkSync(this.path(id));
    } catch {
      // Never saved.
    }
  }

  /**
   * Drop transcripts whose session has been quiet longer than
   * {@link RECENT_MS}, and those that can never be served again (their
   * session file changed or is gone, or the record is unreadable).
   */
  prune(now = Date.now()) {
    let names;
    try {
      names = readdirSync(this.dir);
    } catch {
      return 0;
    }
    let dropped = 0;
    for (const name of names) {
      const path = join(this.dir, name);
      if (name.endsWith(".tmp")) {
        try {
          if (now - statSync(path).mtimeMs > TEMP_MAX_AGE_MS) unlinkSync(path);
        } catch {
          // Gone already.
        }
        continue;
      }
      if (!NAME.test(name)) continue;
      let record;
      try {
        record = JSON.parse(readFileSync(path, "utf8"));
      } catch {
        record = undefined;
      }
      const activeAt = Number(record?.activeAt) || 0;
      if (record?.v === VERSION && now - activeAt <= RECENT_MS && current(record)) continue;
      try {
        unlinkSync(path);
        dropped += 1;
      } catch {
        // Gone already.
      }
    }
    return dropped;
  }
}
