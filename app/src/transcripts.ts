import { Directory, File, Paths } from "expo-file-system";
import { cacheName, forCache, stale } from "./cache";
import type { ChatItem, SessionSummary } from "./types";

/**
 * What the phone remembers of each machine between launches: the last
 * transcript of a session and the last session list, so a reopen shows them
 * at once (also offline) while the daemon's live answer is on its way.
 */
const ROOT = new Directory(Paths.document, "transcripts");
const VERSION = 1;

interface SavedTranscript {
  v: typeof VERSION;
  machineId: string;
  sessionId: string;
  savedAt: number;
  items: ChatItem[];
}

interface SavedSessions {
  v: typeof VERSION;
  machineId: string;
  savedAt: number;
  sessions: SessionSummary[];
}

function transcriptFile(machineId: string, sessionId: string): File {
  return new File(ROOT, `t-${cacheName(machineId, sessionId)}.json`);
}

function sessionsFile(machineId: string): File {
  return new File(ROOT, `s-${cacheName(machineId, "")}.json`);
}

async function readJson(file: File): Promise<unknown> {
  if (!file.exists) return undefined;
  try {
    return JSON.parse(await file.text()) as unknown;
  } catch {
    return undefined;
  }
}

function write(file: File, value: unknown): void {
  ROOT.create({ intermediates: true, idempotent: true });
  file.write(JSON.stringify(value));
}

/** A recognizable saved record: this format version and the owner it was asked for. */
function owned(value: unknown, machineId: string): value is { v: number; machineId: string } {
  return (
    value !== null &&
    typeof value === "object" &&
    "v" in value &&
    value.v === VERSION &&
    "machineId" in value &&
    value.machineId === machineId
  );
}

export async function loadTranscript(machineId: string, sessionId: string): Promise<ChatItem[] | undefined> {
  const saved = await readJson(transcriptFile(machineId, sessionId));
  if (!owned(saved, machineId) || !("sessionId" in saved) || saved.sessionId !== sessionId) return undefined;
  return "items" in saved && Array.isArray(saved.items) ? (saved.items as ChatItem[]) : undefined;
}

/** Save a session's transcript and keep only the most recently saved ones. Best effort: a full disk only loses the cache. */
export function saveTranscript(machineId: string, sessionId: string, items: readonly ChatItem[]): void {
  try {
    const record: SavedTranscript = { v: VERSION, machineId, sessionId, savedAt: Date.now(), items: forCache(items) };
    write(transcriptFile(machineId, sessionId), record);
    const saved = ROOT.list()
      .filter((entry): entry is File => entry instanceof File && entry.name.startsWith("t-"))
      .map((file) => ({ file, savedAt: file.modificationTime ?? 0 }));
    for (const { file } of stale(saved)) file.delete();
  } catch {
    // The cache is an optimization; the daemon still has the transcript.
  }
}

export function dropTranscript(machineId: string, sessionId: string): void {
  try {
    const file = transcriptFile(machineId, sessionId);
    if (file.exists) file.delete();
  } catch {
    // Nothing to drop.
  }
}

export async function loadSessionList(machineId: string): Promise<SessionSummary[] | undefined> {
  const saved = await readJson(sessionsFile(machineId));
  if (!owned(saved, machineId)) return undefined;
  return "sessions" in saved && Array.isArray(saved.sessions) ? (saved.sessions as SessionSummary[]) : undefined;
}

export function saveSessionList(machineId: string, sessions: readonly SessionSummary[]): void {
  try {
    const record: SavedSessions = { v: VERSION, machineId, savedAt: Date.now(), sessions: [...sessions] };
    write(sessionsFile(machineId), record);
  } catch {
    // Best effort, as above.
  }
}

/** Forget everything saved for a machine removed from the phone. */
export function dropMachine(machineId: string): void {
  try {
    if (!ROOT.exists) return;
    for (const entry of ROOT.list()) {
      if (!(entry instanceof File)) continue;
      let saved: unknown;
      try {
        saved = JSON.parse(entry.textSync()) as unknown;
      } catch {
        saved = undefined;
      }
      // Unreadable files are dropped too: they can only be stale cache.
      if (saved === undefined || owned(saved, machineId)) entry.delete();
    }
  } catch {
    // Nothing to drop.
  }
}
