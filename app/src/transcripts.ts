import { Directory, File, Paths } from "expo-file-system";
import { moveAsync, writeAsStringAsync } from "expo-file-system/legacy";
import {
  appendAt,
  cacheName,
  copyLines,
  expired,
  extendTail,
  fingerprint,
  parseCached,
  parseCopyLines,
  parseIndex,
  parseTail,
  replaces,
  retained,
  tailStart,
  type CacheEntry,
  type CachedTail,
  type CachedTranscript,
} from "./cache";
import type { AgentMessage, SessionState, SessionSummary } from "./types";

/**
 * What the phone remembers of each machine between launches: a copy of every
 * session active in the last 24 hours (the daemon's slim messages, one per
 * line, `c-*.jsonl`: a delta is appended, the copy is not rewritten), the end
 * of each copy with its summary and state (`h-*.json`, a chat's first paint,
 * small whatever the session's size), an index of those copies (`index.json`:
 * how current each is, what it holds, when it was viewed), and the last
 * session list (`s-*.json`). A chat opens from its copy at once, offline too,
 * and asks the daemon only for what is new. Files are written off the JS
 * thread, one save at a time; every write is best effort and every read
 * survives a damaged file: the daemon still has the transcript.
 */
const ROOT = new Directory(Paths.document, "transcripts");
const INDEX = new File(ROOT, "index.json");
const LIST_VERSION = 1;
/** A copy written but not yet in the index (a crash between the two) is swept after this long. */
const ORPHAN_MS = 60 * 60_000;

interface SavedSessions {
  v: typeof LIST_VERSION;
  machineId: string;
  savedAt: number;
  sessions: SessionSummary[];
}

/** A copy's messages, one per line. */
function linesFile(name: string): File {
  return new File(ROOT, `c-${name}.jsonl`);
}

/** A copy as earlier versions wrote it: one JSON document, read until the next save replaces it. */
function legacyFile(name: string): File {
  return new File(ROOT, `c-${name}.json`);
}

function tailFile(name: string): File {
  return new File(ROOT, `h-${name}.json`);
}

function sessionsFile(machineId: string): File {
  return new File(ROOT, `s-${cacheName(machineId, "")}.json`);
}

async function readJson(file: File): Promise<unknown> {
  try {
    if (!file.exists) return undefined;
    return JSON.parse(await file.text()) as unknown;
  } catch {
    return undefined;
  }
}

/** Write a whole file or leave the old one: a temporary file, written off the JS thread, moved over it. */
async function write(file: File, text: string): Promise<void> {
  ROOT.create({ intermediates: true, idempotent: true });
  const temporary = new File(ROOT, `${file.name}.tmp`);
  await writeAsStringAsync(temporary.uri, text);
  await moveAsync({ from: temporary.uri, to: file.uri });
}

/** One save at a time, in order: a save reads what the one before it left. */
let queue: Promise<unknown> = Promise.resolve();
function serial<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task);
  queue = run.catch(() => undefined);
  return run;
}

/** The index, read once per launch; keyed by copy file name. */
let index: Map<string, CacheEntry> | undefined;

function entries(): Map<string, CacheEntry> {
  if (index !== undefined) return index;
  let parsed: unknown;
  try {
    parsed = INDEX.exists ? (JSON.parse(INDEX.textSync()) as unknown) : undefined;
  } catch {
    parsed = undefined;
  }
  index = parseIndex(parsed);
  sweep();
  return index;
}

/** The index is written after what it names, and at most one write at a time; a later change rewrites it again. */
let indexWrite: { running: boolean; again: boolean } = { running: false, again: false };
function saveIndex(): void {
  if (indexWrite.running) {
    indexWrite.again = true;
    return;
  }
  indexWrite = { running: true, again: false };
  void write(INDEX, JSON.stringify({ v: 2, entries: Object.fromEntries(entries()) }))
    .catch(() => undefined) // Best effort; a lost index only loses the copies it named.
    .finally(() => {
      const again = indexWrite.again;
      indexWrite = { running: false, again: false };
      if (again) saveIndex();
    });
}

/** The copy file name of a cache file (`c-<name>.jsonl`, `c-<name>.json`, `h-<name>.json`), or undefined. */
function copyName(file: string): string | undefined {
  const match = /^[ch]-([0-9a-f]{16})\.jsonl?$/.exec(file);
  return match?.[1];
}

/**
 * Delete what is no longer kept: copies of sessions quiet for 24 hours,
 * copies the index does not know (damaged index, a crash mid-save), the item
 * caches of earlier versions (`t-*`) and stray temporary files. Runs at
 * launch and after each background pass.
 */
function sweep(now = Date.now()): void {
  const known = entries();
  const gone = expired([...known].map(([name, entry]) => ({ name, ...entry })), now);
  for (const { name } of gone) known.delete(name);
  try {
    if (!ROOT.exists) return;
    for (const item of ROOT.list()) {
      if (!(item instanceof File)) continue;
      const name = item.name;
      const old = now - (item.modificationTime ?? 0) > ORPHAN_MS;
      const copy = copyName(name);
      const stray =
        name.startsWith("t-") ||
        (name.endsWith(".tmp") && old) ||
        (copy !== undefined && !known.has(copy) && (old || gone.some((entry) => entry.name === copy)));
      if (stray) item.delete();
    }
  } catch {
    // Swept next time.
  }
  if (gone.length > 0) saveIndex();
}

/** Drop expired copies now (a long-lived app is not relaunched to sweep). */
export function sweepCache(): void {
  try {
    sweep();
  } catch {
    // Next time.
  }
}

/** What the index knows of a session's copy, if it is kept. */
export function cachedEntry(machineId: string, sessionId: string): CacheEntry | undefined {
  try {
    const entry = entries().get(cacheName(machineId, sessionId));
    return entry !== undefined && retained(entry, Date.now()) ? entry : undefined;
  } catch {
    return undefined;
  }
}

/** Every kept copy of one machine's sessions, by session id. */
export function cachedEntries(machineId: string): Map<string, CacheEntry> {
  const found = new Map<string, CacheEntry>();
  try {
    const now = Date.now();
    for (const entry of entries().values()) {
      if (entry.machineId === machineId && retained(entry, now)) found.set(entry.sessionId, entry);
    }
  } catch {
    // Nothing cached.
  }
  return found;
}

/** A session's saved copy, or undefined (none, expired, damaged). */
export async function loadCached(machineId: string, sessionId: string): Promise<CachedTranscript | undefined> {
  const entry = cachedEntry(machineId, sessionId);
  if (entry === undefined) return undefined;
  const name = cacheName(machineId, sessionId);
  const lines = linesFile(name);
  if (!lines.exists) return parseCached(await readJson(legacyFile(name)), machineId, sessionId);
  const [text, tail] = await Promise.all([lines.text().catch(() => undefined), loadTail(machineId, sessionId)]);
  if (text === undefined || tail === undefined) return undefined;
  const messages = parseCopyLines(text, entry);
  if (messages === undefined) return undefined;
  return { v: 2, machineId, sessionId, updatedAt: tail.updatedAt, savedAt: tail.savedAt, session: tail.session, state: tail.state, messages };
}

/**
 * The end of a session's copy, to paint before the whole copy is read; only
 * when it describes the copy the index knows (count and last message).
 */
export async function loadTail(machineId: string, sessionId: string): Promise<CachedTail | undefined> {
  const entry = cachedEntry(machineId, sessionId);
  if (entry === undefined) return undefined;
  return parseTail(await readJson(tailFile(cacheName(machineId, sessionId))), machineId, entry);
}

/** What a save brings: the whole copy (`from` 0), or the messages after the `from` the saved copy holds, ending in `last`. */
export interface CopyUpdate {
  updatedAt: number;
  session: SessionSummary;
  state: SessionState | null;
  messages: AgentMessage[];
  /** Where `messages` start in the transcript; > 0 continues the saved copy, which must hold exactly that many. */
  from?: number;
}

/**
 * Save a session's copy, current to `updatedAt` (the daemon's clock). An older
 * copy never replaces a newer one: a chat's snapshot and a background refresh
 * can both be on their way. Only what the saved copy lacks is written when it
 * continues it (appended to its file); the files are written off the JS
 * thread. Answers whether it was saved.
 */
export function saveCached(
  machineId: string,
  sessionId: string,
  copy: CopyUpdate,
  /** The chat is open: the copy counts as viewed now. */
  viewed = false,
): Promise<boolean> {
  return serial(async () => {
    try {
      return await store(machineId, sessionId, copy, viewed);
    } catch {
      // The cache is an optimization; the daemon still has the transcript.
      return false;
    }
  });
}

async function store(machineId: string, sessionId: string, copy: CopyUpdate, viewed: boolean): Promise<boolean> {
  const name = cacheName(machineId, sessionId);
  const existing = entries().get(name);
  if (!replaces(existing, copy.updatedAt)) return false;
  const from = copy.from ?? 0;
  if (from > 0 && (existing === undefined || existing.count !== from)) return false;
  const lines = linesFile(name);
  const size = lines.exists ? (lines.size ?? undefined) : undefined;
  let at = appendAt(existing, size, copy.messages, from);
  let whole = from === 0 ? copy.messages : undefined;
  if (at === undefined && whole === undefined) {
    // A delta onto a file the last save did not leave: rewrite it from the saved copy.
    const saved = await loadCached(machineId, sessionId);
    if (saved === undefined || saved.messages.length !== from) return false;
    whole = [...saved.messages, ...copy.messages];
  }
  const count = from + copy.messages.length;
  if (count === 0) return false;
  const last = copy.messages.length > 0 ? fingerprint(copy.messages[copy.messages.length - 1]) : (existing?.last ?? "");
  ROOT.create({ intermediates: true, idempotent: true });
  if (at !== undefined) {
    const added = copy.messages.slice(at);
    if (added.length > 0) await writeAsStringAsync(lines.uri, copyLines(added), { append: true });
  } else {
    await write(lines, copyLines(whole ?? []));
  }
  // The tail: from the whole copy when it is here, else the old tail extended by the delta.
  let end: { from: number; messages: AgentMessage[] } | undefined;
  if (whole !== undefined) {
    const start = tailStart(whole);
    end = { from: start, messages: whole.slice(start) };
  } else {
    // `from > 0`: `copy.messages` are the messages after the saved copy, which the old tail ends.
    const before = await loadTail(machineId, sessionId);
    if (before !== undefined) end = extendTail(before, copy.messages);
  }
  if (end === undefined) {
    const saved = await loadCached(machineId, sessionId);
    const all = saved === undefined ? undefined : [...saved.messages, ...copy.messages];
    if (all === undefined || all.length !== count) return false;
    const start = tailStart(all);
    end = { from: start, messages: all.slice(start) };
  }
  const now = Date.now();
  const tail: CachedTail = {
    v: 2,
    machineId,
    sessionId,
    updatedAt: copy.updatedAt,
    savedAt: now,
    from: end.from,
    count,
    last,
    session: copy.session,
    state: copy.state,
    messages: end.messages,
  };
  // Written after the copy and before the index: a tail that does not match the index is not used.
  await write(tailFile(name), JSON.stringify(tail));
  const legacy = legacyFile(name);
  if (legacy.exists) legacy.delete();
  entries().set(name, {
    machineId,
    sessionId,
    updatedAt: copy.updatedAt,
    viewedAt: viewed ? now : (existing?.viewedAt ?? 0),
    savedAt: now,
    count,
    last,
    bytes: lines.size ?? undefined,
  });
  saveIndex();
  return true;
}

/** The daemon had nothing newer than the copy: it is current to `updatedAt` now, without rewriting it. */
export function touchCached(machineId: string, sessionId: string, updatedAt: number): void {
  try {
    const name = cacheName(machineId, sessionId);
    const existing = entries().get(name);
    if (existing === undefined || updatedAt <= existing.updatedAt) return;
    entries().set(name, { ...existing, updatedAt });
    saveIndex();
  } catch {
    // Best effort.
  }
}

/** The chat was opened: its copy is kept for another 24 hours. */
export function markViewed(machineId: string, sessionId: string): void {
  try {
    const name = cacheName(machineId, sessionId);
    const existing = entries().get(name);
    if (existing === undefined) return;
    entries().set(name, { ...existing, viewedAt: Date.now() });
    saveIndex();
  } catch {
    // Best effort.
  }
}

export function dropTranscript(machineId: string, sessionId: string): void {
  try {
    entries().delete(cacheName(machineId, sessionId));
    saveIndex();
    const name = cacheName(machineId, sessionId);
    for (const file of [linesFile(name), legacyFile(name), tailFile(name)]) if (file.exists) file.delete();
  } catch {
    // Nothing to drop.
  }
}

export async function loadSessionList(machineId: string): Promise<SessionSummary[] | undefined> {
  const saved = await readJson(sessionsFile(machineId));
  if (saved === null || typeof saved !== "object") return undefined;
  const record = saved as Partial<SavedSessions>;
  if (record.v !== LIST_VERSION || record.machineId !== machineId) return undefined;
  return Array.isArray(record.sessions) ? record.sessions : undefined;
}

export function saveSessionList(machineId: string, sessions: readonly SessionSummary[]): void {
  const record: SavedSessions = { v: LIST_VERSION, machineId, savedAt: Date.now(), sessions: [...sessions] };
  // Best effort, as above.
  void serial(() => write(sessionsFile(machineId), JSON.stringify(record))).catch(() => undefined);
}

/** Forget everything saved for a machine removed from the phone. */
export function dropMachine(machineId: string): void {
  try {
    const known = entries();
    for (const [name, entry] of known) {
      if (entry.machineId !== machineId) continue;
      known.delete(name);
      for (const file of [linesFile(name), legacyFile(name), tailFile(name)]) if (file.exists) file.delete();
    }
    saveIndex();
    const list = sessionsFile(machineId);
    if (list.exists) list.delete();
  } catch {
    // Nothing to drop.
  }
}
