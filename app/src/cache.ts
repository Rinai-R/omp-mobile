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
  answer: Pick<Transcript, "from" | "total" | "messages">,
): AgentMessage[] | undefined {
  if (!Array.isArray(answer.messages)) return undefined;
  const from = answer.from ?? 0;
  if (!Number.isSafeInteger(from) || from < 0) return undefined;
  let merged: AgentMessage[];
  if (from === 0) {
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
  answer: Pick<Transcript, "from" | "total" | "messages">,
): TranscriptWindow | undefined {
  if (!Array.isArray(answer.messages)) return undefined;
  const from = answer.from ?? 0;
  if (!Number.isSafeInteger(from) || from < 0) return undefined;
  if (from === 0) {
    if (answer.total !== undefined && answer.total !== answer.messages.length) return undefined;
    return { offset: 0, messages: answer.messages };
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
 * (the daemon's copy of them is stale) and those the daemon recently had none
 * for (`misses`: session id to the time it answered 404).
 */
export function syncQueue(
  sessions: readonly SessionSummary[],
  entries: ReadonlyMap<string, CacheEntry>,
  misses: ReadonlyMap<string, number>,
  now: number,
): SessionSummary[] {
  return sessions
    .filter((session) => {
      const entry = entries.get(session.id);
      if (session.openElsewhere === true) return false;
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
