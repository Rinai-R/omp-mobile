import type { AgentMessage, SessionState, SessionSummary, Transcript } from "./types";

/**
 * The phone's copy of each recent session (issue #43), as pure logic: what a
 * copy holds, how a delta from the daemon (#42) extends it, how long it is
 * kept, and when it is due for a refresh. `transcripts.ts` keeps the files.
 */

/** A session stays cached while its last activity (its `updatedAt`, or when it was viewed here) is this recent. */
export const RECENT_MS = 24 * 60 * 60_000;
/** A session the daemon had no transcript for (404) is not asked again for this long. */
export const MISS_RETRY_MS = 5 * 60_000;

/** One session's saved copy: the daemon's slim messages, its state and summary. */
export interface CachedTranscript {
  v: 2;
  machineId: string;
  sessionId: string;
  /** The session's `updatedAt` this copy is current to (the daemon's clock). */
  updatedAt: number;
  savedAt: number;
  session: SessionSummary;
  state: SessionState | null;
  messages: AgentMessage[];
}

/** What the index knows of a saved copy without reading it: enough to ask for a delta and to expire it. */
export interface CacheEntry {
  machineId: string;
  sessionId: string;
  updatedAt: number;
  /** When the chat was last opened on this phone (the phone's clock); 0 if never. */
  viewedAt: number;
  savedAt: number;
  /** How many messages the copy holds, and the fingerprint of the last. */
  count: number;
  last: string;
  /**
   * The size in bytes of the copy's message file as last written (one message
   * per line): a file of another size was not left by the last save, so it is
   * rewritten instead of appended to. Absent for copies of earlier versions.
   */
  bytes?: number;
}

/** What the phone holds of a transcript, as `since`/`last` tell the daemon. */
export interface Held {
  since: number;
  last: string;
}

/**
 * What identifies one message well enough to line the phone's copy up with
 * the daemon's. Must equal the daemon's `fingerprint()` (daemon/src/transcripts.mjs).
 */
export function fingerprint(message: unknown): string {
  if (message === null || typeof message !== "object") return "";
  const value = message as Record<string, unknown>;
  const id = typeof value.toolCallId === "string" ? value.toolCallId : typeof value.responseId === "string" ? value.responseId : "";
  return `${String(value.role ?? "")}:${String(value.timestamp ?? "")}:${id}`;
}

/** What to ask a delta against, for a copy of `messages`; undefined when there is nothing to extend. */
export function heldOf(messages: readonly AgentMessage[] | undefined): Held | undefined {
  if (messages === undefined || messages.length === 0) return undefined;
  return { since: messages.length, last: fingerprint(messages[messages.length - 1]) };
}

/** What the index says the copy holds; undefined for an empty one. */
export function heldOfEntry(entry: Pick<CacheEntry, "count" | "last"> | undefined): Held | undefined {
  return entry === undefined || entry.count <= 0 ? undefined : { since: entry.count, last: entry.last };
}

/** The query string that carries `held` (empty for none). */
export function heldQuery(held: Held | undefined): string {
  return held === undefined ? "" : `since=${held.since}&last=${encodeURIComponent(held.last)}`;
}

/**
 * The transcript after the daemon's answer: its messages as they are, or the
 * phone's copy extended at `from`. Undefined when the answer does not fit the
 * copy it was asked against (another `from`, a different message there, a
 * count that does not add up): the caller then asks for the whole transcript,
 * and never shows a spliced one.
 * @param base the copy `held` was computed from
 * @param held what was sent as `since`/`last`; undefined if nothing was
 */
export function mergeTranscript(
  base: readonly AgentMessage[],
  held: Held | undefined,
  answer: Pick<Transcript, "from" | "total" | "messages" | "base">,
): AgentMessage[] | undefined {
  if (!Array.isArray(answer.messages)) return undefined;
  const from = answer.from ?? 0;
  if (!Number.isSafeInteger(from) || from < 0) return undefined;
  let merged: AgentMessage[];
  if (from === 0) {
    // Only the end of a session past the daemon's cap: it is not the transcript from its start.
    if (startOf(answer) > 0) return undefined;
    merged = answer.messages;
  } else {
    if (held === undefined || from !== held.since || from > base.length) return undefined;
    if (fingerprint(base[from - 1]) !== held.last) return undefined;
    merged = [...base.slice(0, from), ...answer.messages];
  }
  if (answer.total !== undefined && answer.total !== merged.length) return undefined;
  return merged;
}

/**
 * Messages a copy's tail file keeps: what a chat paints first, before the
 * whole copy is read. Its size does not grow with the session.
 */
export const TAIL_MESSAGES = 160;
/** How far back a tail may reach for a turn's start, so it does not open mid-turn. */
const TAIL_REACH = 3 * TAIL_MESSAGES;

/** The end of a copy that paints the chat at once: its last messages and what they belong to. */
export interface CachedTail {
  v: 2;
  machineId: string;
  sessionId: string;
  updatedAt: number;
  savedAt: number;
  /** Index of the first tail message in the whole copy. */
  from: number;
  /** The whole copy's size and last fingerprint: the tail describes that copy and no other. */
  count: number;
  last: string;
  session: SessionSummary;
  state: SessionState | null;
  messages: AgentMessage[];
}

/**
 * A stretch of a transcript the phone holds: `messages` are the transcript's
 * messages from index `offset` on, to its end as far as the phone knows.
 * A chat opens on its cached tail (offset > 0) and gets the rest later.
 */
export interface TranscriptWindow {
  offset: number;
  messages: AgentMessage[];
}

/**
 * Where a tail of `messages` starts: about the last {@link TAIL_MESSAGES},
 * moved to the start of a turn (a user message) so it does not open on a
 * tool result whose call it lacks. Reaches back at most {@link TAIL_REACH}.
 */
export function tailStart(messages: readonly AgentMessage[]): number {
  const length = messages.length;
  if (length <= TAIL_MESSAGES) return 0;
  const candidate = length - TAIL_MESSAGES;
  for (let i = candidate; i < length; i += 1) if (messages[i]?.role === "user") return i;
  for (let i = candidate - 1; i >= Math.max(0, length - TAIL_REACH); i -= 1) if (messages[i]?.role === "user") return i;
  return candidate;
}

/** Where a whole answer starts in its session: 0, or the daemon's `base` past its message cap. */
export function startOf(answer: Pick<Transcript, "base">): number {
  const base = answer.base;
  return typeof base === "number" && Number.isSafeInteger(base) && base > 0 ? base : 0;
}

/** What the window tells the daemon it holds: the transcript up to its end. */
export function heldOfWindow(window: TranscriptWindow): Held | undefined {
  const count = window.offset + window.messages.length;
  if (count === 0 || window.messages.length === 0) return undefined;
  return { since: count, last: fingerprint(window.messages[window.messages.length - 1]) };
}

/**
 * The window after the daemon's answer to `held`: its messages whole
 * (offset 0), or the window extended at `from`. Undefined when the answer
 * does not fit the window it was asked against.
 */
export function mergeWindow(
  window: TranscriptWindow,
  held: Held | undefined,
  answer: Pick<Transcript, "from" | "total" | "messages" | "base">,
): TranscriptWindow | undefined {
  if (!Array.isArray(answer.messages)) return undefined;
  const from = answer.from ?? 0;
  if (!Number.isSafeInteger(from) || from < 0) return undefined;
  if (from === 0) {
    if (answer.total !== undefined && answer.total !== answer.messages.length) return undefined;
    // A session past the daemon's cap: the window starts where what the daemon holds does.
    return { offset: startOf(answer), messages: answer.messages };
  }
  if (held === undefined || from !== held.since || from !== window.offset + window.messages.length) return undefined;
  if (window.messages.length === 0 || fingerprint(window.messages[window.messages.length - 1]) !== held.last) return undefined;
  const merged = { offset: window.offset, messages: [...window.messages, ...answer.messages] };
  if (answer.total !== undefined && answer.total !== merged.offset + merged.messages.length) return undefined;
  return merged;
}

/**
 * The whole transcript from a window and a copy that starts at 0 (the full
 * cached copy, read after the tail painted): the copy's messages before the
 * window, then the window. Undefined unless the copy reaches the window and
 * agrees with it where they meet.
 */
export function attachHead(window: TranscriptWindow, head: readonly AgentMessage[]): TranscriptWindow | undefined {
  if (window.offset === 0) return window;
  if (window.messages.length === 0 || head.length <= window.offset) return undefined;
  if (fingerprint(head[window.offset]) !== fingerprint(window.messages[0])) return undefined;
  return { offset: 0, messages: [...head.slice(0, window.offset), ...window.messages] };
}

/** A tail to paint first: read back, and only if it describes the copy the index knows. */
export function parseTail(value: unknown, machineId: string, entry: Pick<CacheEntry, "sessionId" | "count" | "last">): CachedTail | undefined {
  if (value === null || typeof value !== "object") return undefined;
  const tail = value as Record<string, unknown>;
  if (tail.v !== 2 || tail.machineId !== machineId || tail.sessionId !== entry.sessionId) return undefined;
  if (tail.count !== entry.count || tail.last !== entry.last) return undefined;
  if (!Array.isArray(tail.messages) || !isNumber(tail.from) || !isNumber(tail.updatedAt)) return undefined;
  if (tail.session === null || typeof tail.session !== "object") return undefined;
  if (!tail.messages.every((message) => message !== null && typeof message === "object")) return undefined;
  const messages = tail.messages as AgentMessage[];
  // Its messages end the copy: they reach its count and its last is the copy's last.
  if (messages.length === 0 || tail.from < 0 || tail.from + messages.length !== entry.count) return undefined;
  if (fingerprint(messages[messages.length - 1]) !== entry.last) return undefined;
  return value as CachedTail;
}

/** When a cached session was last active: its own last update, or the last time it was viewed here. */
export function activeAt(entry: Pick<CacheEntry, "updatedAt" | "viewedAt">): number {
  return Math.max(entry.updatedAt, entry.viewedAt);
}

/** Whether a saved copy is still kept: its session was active in the last {@link RECENT_MS}. */
export function retained(entry: Pick<CacheEntry, "updatedAt" | "viewedAt">, now: number): boolean {
  return now - activeAt(entry) <= RECENT_MS;
}

/** Saved copies to delete: those whose session has been quiet longer than {@link RECENT_MS}. No count limit. */
export function expired<T extends Pick<CacheEntry, "updatedAt" | "viewedAt">>(entries: readonly T[], now: number): T[] {
  return entries.filter((entry) => !retained(entry, now));
}

/** Whether a copy current to `entry` is older than the session the daemon lists. */
export function behind(session: Pick<SessionSummary, "updatedAt">, entry: Pick<CacheEntry, "updatedAt"> | undefined): boolean {
  return entry === undefined || session.updatedAt > entry.updatedAt;
}

/**
 * The sessions a background pass refreshes, newest first: active in the last
 * {@link RECENT_MS} and newer than their copy, minus those held by another omp
 * (the daemon's copy of them is stale), those the daemon recently had none
 * for (`misses`: session id to the time it answered 404), and the one whose
 * chat is on screen (`onScreen`: its chat keeps its copy and refreshes it when left).
 */
export function syncQueue(
  sessions: readonly SessionSummary[],
  entries: ReadonlyMap<string, CacheEntry>,
  misses: ReadonlyMap<string, number>,
  now: number,
  onScreen?: string,
): SessionSummary[] {
  return sessions
    .filter((session) => {
      const entry = entries.get(session.id);
      if (session.openElsewhere === true || session.id === onScreen) return false;
      if (now - Math.max(session.updatedAt, entry?.viewedAt ?? 0) > RECENT_MS) return false;
      if (!behind(session, entry)) return false;
      const missed = misses.get(session.id);
      return missed === undefined || now - missed > MISS_RETRY_MS;
    })
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

/**
 * What a copy is current to after an answer: the session's `updatedAt` in
 * the answer, or the one the list showed when the refresh was asked if that
 * is later (the answer is at least that new).
 */
export function currentTo(answered: number | undefined, listed: number | undefined): number {
  const a = typeof answered === "number" && Number.isFinite(answered) ? answered : 0;
  const b = typeof listed === "number" && Number.isFinite(listed) ? listed : 0;
  return Math.max(a, b);
}

/** Whether a copy current to `updatedAt` may replace the saved one: never an older over a newer. */
export function replaces(existing: Pick<CacheEntry, "updatedAt"> | undefined, updatedAt: number): boolean {
  return existing === undefined || updatedAt >= existing.updatedAt;
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** A saved copy read back, or undefined for anything else (another format, another session, a damaged file). */
export function parseCached(value: unknown, machineId: string, sessionId: string): CachedTranscript | undefined {
  if (value === null || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  if (record.v !== 2 || record.machineId !== machineId || record.sessionId !== sessionId) return undefined;
  if (!Array.isArray(record.messages) || !isNumber(record.updatedAt)) return undefined;
  if (record.session === null || typeof record.session !== "object") return undefined;
  if (!record.messages.every((message) => message !== null && typeof message === "object")) return undefined;
  return value as CachedTranscript;
}

/** The index read back: the entries that are well formed; anything damaged is left out (its copy is swept). */
export function parseIndex(value: unknown): Map<string, CacheEntry> {
  const entries = new Map<string, CacheEntry>();
  if (value === null || typeof value !== "object") return entries;
  const record = value as { v?: unknown; entries?: unknown };
  if (record.v !== 2 || record.entries === null || typeof record.entries !== "object") return entries;
  for (const [name, raw] of Object.entries(record.entries as Record<string, unknown>)) {
    if (raw === null || typeof raw !== "object") continue;
    const entry = raw as Record<string, unknown>;
    if (typeof entry.machineId !== "string" || typeof entry.sessionId !== "string") continue;
    if (!isNumber(entry.updatedAt) || !isNumber(entry.viewedAt) || !isNumber(entry.savedAt) || !isNumber(entry.count)) continue;
    if (typeof entry.last !== "string") continue;
    entries.set(name, {
      ...(isNumber(entry.bytes) ? { bytes: entry.bytes } : {}),
      machineId: entry.machineId,
      sessionId: entry.sessionId,
      updatedAt: entry.updatedAt,
      viewedAt: entry.viewedAt,
      savedAt: entry.savedAt,
      count: entry.count,
      last: entry.last,
    });
  }
  return entries;
}

/**
 * A copy's messages as its file keeps them: one JSON message per line, so a
 * delta is appended instead of the whole copy rewritten.
 */
export function copyLines(messages: readonly AgentMessage[]): string {
  let text = "";
  for (const message of messages) text += `${JSON.stringify(message)}\n`;
  return text;
}

/**
 * The messages of a copy file, if it holds the copy the index knows: at
 * least `count` lines (a save that did not finish may have left more), the
 * last of them fingerprinted `last`. Undefined for anything else.
 */
export function parseCopyLines(text: string, entry: Pick<CacheEntry, "count" | "last">): AgentMessage[] | undefined {
  const messages: AgentMessage[] = [];
  let at = 0;
  while (messages.length < entry.count) {
    const end = text.indexOf("\n", at);
    if (end === -1) return undefined;
    let message: unknown;
    try {
      message = JSON.parse(text.slice(at, end));
    } catch {
      return undefined;
    }
    if (message === null || typeof message !== "object") return undefined;
    messages.push(message as AgentMessage);
    at = end + 1;
  }
  if (messages.length === 0 || fingerprint(messages[messages.length - 1]) !== entry.last) return undefined;
  return messages;
}

/**
 * Where a save may append to the copy file instead of rewriting it: the index
 * in `messages` of the first message the file lacks, or undefined to rewrite.
 * `from` is where `messages` start in the transcript: 0 for a whole copy, the
 * saved count for a delta. Appending needs the file exactly as the last save
 * left it (`size` equals the recorded bytes) and `messages` to continue it.
 */
export function appendAt(
  entry: Pick<CacheEntry, "count" | "last" | "bytes"> | undefined,
  size: number | undefined,
  messages: readonly AgentMessage[],
  from = 0,
): number | undefined {
  if (entry === undefined || entry.bytes === undefined || size !== entry.bytes || entry.count <= 0) return undefined;
  if (from > 0) return from === entry.count ? 0 : undefined;
  if (messages.length < entry.count || fingerprint(messages[entry.count - 1]) !== entry.last) return undefined;
  return entry.count;
}

/**
 * The tail after a delta, from the tail before it: the last messages of both,
 * started at a turn as {@link tailStart} does. `delta` continues `tail` (its
 * first message is the transcript's message `tail.from + tail.messages.length`).
 */
export function extendTail(tail: Pick<CachedTail, "from" | "messages">, delta: readonly AgentMessage[]): { from: number; messages: AgentMessage[] } {
  const joined = [...tail.messages, ...delta];
  const start = tailStart(joined);
  return { from: tail.from + start, messages: joined.slice(start) };
}

/** A file name for one machine's session: stable, short, and free of URL characters. */
export function cacheName(machineId: string, sessionId: string): string {
  // FNV-1a, 64-bit as two 32-bit halves.
  let a = 0x811c9dc5;
  let b = 0x01000193;
  const text = `${machineId}\n${sessionId}`;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    a = Math.imul(a ^ code, 0x01000193) >>> 0;
    b = Math.imul(b ^ code, 0x811c9dc5) >>> 0;
  }
  return `${a.toString(16).padStart(8, "0")}${b.toString(16).padStart(8, "0")}`;
}
