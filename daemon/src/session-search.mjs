/**
 * Search every OMP session on this computer by title and message text, as
 * the terminal's `/resume` picker does with its literal tier: the query is
 * split on whitespace and a session matches when every word appears, in any
 * case, somewhere in its id, title, directory or user/assistant text.
 * Exact titles lead, then partial titles, then the rest newest first.
 *
 * The picker reads only each file's first 4 KB; a phone search has to find
 * the word said an hour into a session, so whole files are read. What a file
 * holds is kept per `(size, mtime)`: a repeat search reads only the files
 * written since, and tool results (most of a long session's bytes) are
 * skipped before they are parsed. A session's text is kept once, as said,
 * and matched with case-insensitive patterns rather than a lowercased copy:
 * hundreds of sessions keep tens of MB of text, not twice that.
 */
import { open, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { oneLine } from "./omp-sessions.mjs";

const CHUNK_BYTES = 256 * 1024;
/** Files read at once on a cold search: enough to hide disk latency, not enough to starve the event loop. */
const READ_CONCURRENCY = 8;
/** A message's kept text; past it a match is unlikely to be what the user remembers, and memory stays bounded. */
const MESSAGE_CHARS = 50_000;
/** Characters of context a snippet keeps before the match, and its whole length. */
const SNIPPET_BEFORE = 36;
const SNIPPET_CHARS = 140;

/**
 * @typedef {{role: "user" | "assistant", timestamp: number | undefined, start: number, end: number}} SearchMessage a message's span of its record's `text`
 * @typedef {{id: string, title: string, cwd: string, createdAt: number, updatedAt: number, sessionFile: string, meta: string, text: string, messages: SearchMessage[]}} SearchRecord
 * @typedef {{kind: "title"} | {kind: "message", role: "user" | "assistant", timestamp?: number, snippet: string}} SearchMatch
 */

/** @param {string} query */
export function searchTokens(query) {
  const trimmed = query.trim().toLowerCase();
  return trimmed === "" ? [] : trimmed.split(/\s+/);
}

/** Case-insensitive literal patterns of `tokens`. */
function patternsOf(tokens) {
  return tokens.map((token) => new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
}

/** Text parts of a message content field; thinking and tool calls are not what was said. */
function textOf(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  let text = "";
  for (const part of content) {
    if (part !== null && typeof part === "object" && part.type === "text" && typeof part.text === "string") {
      text = text === "" ? part.text : `${text} ${part.text}`;
    }
  }
  return text;
}

/**
 * What one session file holds for a search. Undefined when it has no
 * `session` header. Only `message` lines of the user or the assistant are parsed.
 * @param {string} file
 * @returns {Promise<SearchRecord | undefined>}
 */
export async function readSearchRecord(file) {
  const handle = await open(file, "r");
  try {
    const info = await handle.stat();
    let header;
    let slotTitle = "";
    /** @type {{role: "user" | "assistant", timestamp: number | undefined, text: string}[]} */
    const messages = [];
    let rest = "";
    let offset = 0;
    const buffer = Buffer.alloc(CHUNK_BYTES);
    const take = (line) => {
      if (line === "") return true;
      if (header === undefined) {
        let entry;
        try {
          entry = JSON.parse(line);
        } catch {
          return true;
        }
        if (entry?.type === "title") {
          if (typeof entry.title === "string") slotTitle = oneLine(entry.title);
          return true;
        }
        if (entry?.type !== "session") return false;
        header = entry;
        return true;
      }
      // Cheap screen first: tool results and bookkeeping are never parsed.
      if (!line.startsWith('{"type":"message"') || !(line.includes('"role":"user"') || line.includes('"role":"assistant"'))) return true;
      let entry;
      try {
        entry = JSON.parse(line);
      } catch {
        return true;
      }
      const message = entry?.message;
      if (message?.role !== "user" && message?.role !== "assistant") return true;
      const text = textOf(message.content).trim();
      if (text === "") return true;
      messages.push({
        role: message.role,
        timestamp: typeof message.timestamp === "number" ? message.timestamp : undefined,
        text: text.length > MESSAGE_CHARS ? text.slice(0, MESSAGE_CHARS) : text,
      });
      return true;
    };
    for (;;) {
      const { bytesRead } = await handle.read(buffer, 0, CHUNK_BYTES, offset);
      if (bytesRead === 0) break;
      offset += bytesRead;
      rest += buffer.toString("utf8", 0, bytesRead);
      let start = 0;
      for (let end = rest.indexOf("\n"); end !== -1; end = rest.indexOf("\n", start)) {
        if (!take(rest.slice(start, end))) return undefined;
        start = end + 1;
      }
      rest = rest.slice(start);
    }
    if (rest !== "" && !take(rest)) return undefined;
    if (header === undefined || typeof header.id !== "string" || typeof header.cwd !== "string") return undefined;
    const headerTitle = typeof header.title === "string" ? oneLine(header.title) : "";
    const firstPrompt = messages.find((message) => message.role === "user")?.text ?? "";
    const title = slotTitle || headerTitle || oneLine(firstPrompt) || header.cwd.split("/").filter(Boolean).at(-1) || "session";
    const created = Date.parse(header.timestamp);
    /** @type {SearchMessage[]} */
    const spans = [];
    let at = 0;
    for (const message of messages) {
      spans.push({ role: message.role, timestamp: message.timestamp, start: at, end: at + message.text.length });
      at += message.text.length + 1;
    }
    return {
      id: header.id,
      title,
      cwd: header.cwd,
      createdAt: Number.isFinite(created) ? created : info.birthtimeMs,
      updatedAt: info.mtimeMs,
      sessionFile: file,
      meta: `${header.id}\n${title}\n${header.cwd}`,
      text: messages.map((message) => message.text).join("\n"),
      messages: spans,
    };
  } finally {
    await handle.close();
  }
}

/** Every `*.jsonl` one level under each directory of OMP's session root. */
export async function sessionFilesUnder(root) {
  let dirs;
  try {
    dirs = await readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const files = await Promise.all(
    dirs
      .filter((dir) => dir.isDirectory())
      .map(async (dir) => {
        try {
          return (await readdir(join(root, dir.name))).filter((name) => name.endsWith(".jsonl")).map((name) => join(root, dir.name, name));
        } catch {
          return [];
        }
      }),
  );
  return files.flat();
}

/**
 * One line around the first word of `tokens` that `text` holds.
 * @param {string} text
 * @param {string[]} tokens
 */
export function snippetOf(text, tokens) {
  let at = -1;
  for (const pattern of patternsOf(tokens)) {
    const found = text.search(pattern);
    if (found !== -1 && (at === -1 || found < at)) at = found;
  }
  const start = Math.max(0, at - SNIPPET_BEFORE);
  const cut = text.slice(start, start + SNIPPET_CHARS).replace(/\s+/g, " ").trim();
  return `${start > 0 ? "…" : ""}${cut}${start + SNIPPET_CHARS < text.length ? "…" : ""}`;
}

/**
 * Why `record` matched: its title when that holds every word, else the message
 * holding the most of them (the newest of equals), as a snippet.
 * @param {SearchRecord} record
 * @param {string[]} tokens
 * @returns {SearchMatch}
 */
export function matchOf(record, tokens) {
  const patterns = patternsOf(tokens);
  let best;
  let bestText = "";
  let bestCount = 0;
  for (const message of record.messages) {
    const text = record.text.slice(message.start, message.end);
    let count = 0;
    for (const pattern of patterns) if (pattern.test(text)) count += 1;
    if (count > 0 && count >= bestCount) {
      best = message;
      bestText = text;
      bestCount = count;
    }
  }
  if (patterns.every((pattern) => pattern.test(record.title)) || best === undefined) return { kind: "title" };
  return {
    kind: "message",
    role: best.role,
    ...(best.timestamp !== undefined ? { timestamp: best.timestamp } : {}),
    snippet: snippetOf(bestText, tokens),
  };
}

/**
 * Rank `records` for `query`: exact titles, then partial titles, then every
 * other literal match newest first, as OMP's resume picker ranks them.
 * @param {SearchRecord[]} records
 * @param {string} query
 * @returns {SearchRecord[]}
 */
export function rankRecords(records, query) {
  const tokens = searchTokens(query);
  if (tokens.length === 0) return [];
  const joined = tokens.join(" ");
  const patterns = patternsOf(tokens);
  const hits = records.filter((record) => patterns.every((pattern) => pattern.test(record.meta) || pattern.test(record.text)));
  const tier = (record) => {
    const title = record.title.trim().toLowerCase().replace(/\s+/g, " ");
    if (title === joined) return 0;
    return tokens.every((token) => title.includes(token)) ? 1 : 2;
  };
  return hits
    .map((record) => ({ record, tier: tier(record) }))
    .sort((a, b) => a.tier - b.tier || b.record.updatedAt - a.record.updatedAt)
    .map(({ record }) => record);
}

/** Search records kept per file while the file's size and mtime stay the same. */
export class SessionSearchIndex {
  constructor() {
    /** @type {Map<string, {size: number, mtimeMs: number, record: SearchRecord | undefined}>} */
    this.cache = new Map();
  }

  /**
   * The records of `files`, read afresh where a file changed. One id seen in
   * several files (a moved session's older copy) keeps its newest file.
   * @param {string[]} files
   * @returns {Promise<SearchRecord[]>}
   */
  async records(files) {
    const unique = [...new Set(files)];
    const results = new Array(unique.length);
    let next = 0;
    const worker = async () => {
      while (next < unique.length) {
        const index = next++;
        results[index] = await this.#record(unique[index]);
      }
    };
    await Promise.all(Array.from({ length: Math.min(READ_CONCURRENCY, unique.length) }, worker));
    // Files no longer listed (deleted sessions) leave the cache.
    const listed = new Set(unique);
    for (const file of this.cache.keys()) if (!listed.has(file)) this.cache.delete(file);
    /** @type {Map<string, SearchRecord>} */
    const byId = new Map();
    for (const record of results) {
      if (record === undefined) continue;
      const known = byId.get(record.id);
      if (known === undefined || record.updatedAt > known.updatedAt) byId.set(record.id, record);
    }
    return [...byId.values()];
  }

  /** @param {string} file */
  async #record(file) {
    let info;
    try {
      info = await stat(file);
    } catch {
      this.cache.delete(file);
      return undefined;
    }
    const cached = this.cache.get(file);
    if (cached !== undefined && cached.size === info.size && cached.mtimeMs === info.mtimeMs) return cached.record;
    let record;
    try {
      record = await readSearchRecord(file);
    } catch {
      record = undefined;
    }
    this.cache.set(file, { size: info.size, mtimeMs: info.mtimeMs, record });
    return record;
  }
}
