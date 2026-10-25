import { Directory, File, Paths } from "expo-file-system";
import {
  cacheName,
  expired,
  fingerprint,
  parseCached,
  parseIndex,
  replaces,
  retained,
  type CacheEntry,
  type CachedTranscript,
} from "./cache";
import type { AgentMessage, SessionState, SessionSummary } from "./types";

/**
 * What the phone remembers of each machine between launches: a copy of every
 * session active in the last 24 hours (the daemon's slim messages, state and
 * summary, `c-*.json`), an index of those copies (`index.json`: how current
 * each is, what it holds, when it was viewed), and the last session list
 * (`s-*.json`). A chat opens from its copy at once, offline too, and asks the
 * daemon only for what is new. Every write is best effort and every read
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

function copyFile(machineId: string, sessionId: string): File {
  return new File(ROOT, `c-${cacheName(machineId, sessionId)}.json`);
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

/** Write a whole file or leave the old one: a temporary file moved over it. */
function write(file: File, text: string): void {
  ROOT.create({ intermediates: true, idempotent: true });
  const temporary = new File(ROOT, `${file.name}.tmp`);
  temporary.write(text);
  try {
    temporary.moveSync(file, { overwrite: true });
  } catch {
    file.write(text);
    try {
      temporary.delete();
    } catch {
      // Already moved.
    }
  }
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

function saveIndex(): void {
  try {
    write(INDEX, JSON.stringify({ v: 2, entries: Object.fromEntries(entries()) }));
  } catch {
    // Best effort; a lost index only loses the copies it named.
  }
}

/**
 * Delete what is no longer kept: copies of sessions quiet for 24 hours,
 * copies the index does not know (damaged index, a crash mid-save), the item
 * caches of earlier versions (`t-*`) and stray temporary files.
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
      const stray =
        name.startsWith("t-") ||
        (name.endsWith(".tmp") && old) ||
        (name.startsWith("c-") && name.endsWith(".json") && !known.has(name.slice(2, -5)) && old);
      if (stray) item.delete();
    }
  } catch {
    // Swept next launch.
  }
  if (gone.length > 0) saveIndex();
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
  if (cachedEntry(machineId, sessionId) === undefined) return undefined;
  return parseCached(await readJson(copyFile(machineId, sessionId)), machineId, sessionId);
}

/**
 * Save a session's copy, current to `updatedAt` (the daemon's clock). An older
 * copy never replaces a newer one: a chat's snapshot and a background refresh
 * can both be on their way. Answers whether it was saved.
 */
export function saveCached(
  machineId: string,
  sessionId: string,
  copy: { updatedAt: number; session: SessionSummary; state: SessionState | null; messages: AgentMessage[] },
  /** The chat is open: the copy counts as viewed now. */
  viewed = false,
): boolean {
  try {
    const name = cacheName(machineId, sessionId);
    const existing = entries().get(name);
    if (!replaces(existing, copy.updatedAt)) return false;
    const now = Date.now();
    const record: CachedTranscript = { v: 2, machineId, sessionId, savedAt: now, ...copy };
    write(copyFile(machineId, sessionId), JSON.stringify(record));
    entries().set(name, {
      machineId,
      sessionId,
      updatedAt: copy.updatedAt,
      viewedAt: viewed ? now : (existing?.viewedAt ?? 0),
      savedAt: now,
      count: copy.messages.length,
      last: fingerprint(copy.messages[copy.messages.length - 1]),
    });
    saveIndex();
    return true;
  } catch {
    // The cache is an optimization; the daemon still has the transcript.
    return false;
  }
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
    const file = copyFile(machineId, sessionId);
    if (file.exists) file.delete();
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
  try {
    const record: SavedSessions = { v: LIST_VERSION, machineId, savedAt: Date.now(), sessions: [...sessions] };
    write(sessionsFile(machineId), JSON.stringify(record));
  } catch {
    // Best effort, as above.
  }
}

/** Forget everything saved for a machine removed from the phone. */
export function dropMachine(machineId: string): void {
  try {
    const known = entries();
    for (const [name, entry] of known) {
      if (entry.machineId !== machineId) continue;
      known.delete(name);
      const file = new File(ROOT, `c-${name}.json`);
      if (file.exists) file.delete();
    }
    saveIndex();
    const list = sessionsFile(machineId);
    if (list.exists) list.delete();
  } catch {
    // Nothing to drop.
  }
}
