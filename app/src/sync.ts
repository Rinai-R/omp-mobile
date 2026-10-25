import { daemonFeatures, fetchTranscript, knownFeatures } from "./api";
import { currentTo, heldOfEntry, mergeTranscript, syncQueue, type CachedTranscript } from "./cache";
import { cachedEntries, cachedEntry, loadCached, saveCached, touchCached } from "./transcripts";
import type { Machine, SessionSummary } from "./types";

/**
 * Keeps the phone's copies of recent sessions current without opening them
 * (issue #43): each copy older than its session is extended with
 * `GET /sessions/:id/transcript?since&last`, one request at a time across the
 * app, so a background pass and a chat being left never race on one file.
 * The daemon never starts an omp for these; a session it has nothing for (404)
 * is skipped for a while.
 */
const FEATURE = "transcript-sync";
/** Per machine: session id to when the daemon last had no transcript for it. */
const misses = new Map<string, Map<string, number>>();
let chain: Promise<unknown> = Promise.resolve();

function serial<T>(task: () => Promise<T>): Promise<T> {
  const run = chain.then(task, task);
  chain = run.catch(() => undefined);
  return run;
}

function missesOf(machine: Machine): Map<string, number> {
  let found = misses.get(machine.id);
  if (found === undefined) {
    found = new Map();
    misses.set(machine.id, found);
  }
  return found;
}

/** Whether this machine's daemon serves deltas and transcripts; asks `/hello` when this launch has not yet. */
export async function syncs(machine: Machine): Promise<boolean> {
  if (knownFeatures(machine).includes(FEATURE)) return true;
  return (await daemonFeatures(machine)).includes(FEATURE);
}

export type RefreshOutcome = "saved" | "current" | "missing" | "unsupported" | "invalid";

/**
 * Bring one session's copy up to date from the daemon. `listed` is the
 * session's `updatedAt` as the list showed it, when known.
 */
export function refreshTranscript(machine: Machine, sessionId: string, listed?: number): Promise<RefreshOutcome> {
  return serial(async () => {
    if (!knownFeatures(machine).includes(FEATURE)) return "unsupported";
    const entry = cachedEntry(machine.id, sessionId);
    const held = heldOfEntry(entry);
    let answer = await fetchTranscript(machine, sessionId, held);
    if (answer === null) {
      missesOf(machine).set(sessionId, Date.now());
      return "missing";
    }
    missesOf(machine).delete(sessionId);
    let copy: CachedTranscript | undefined;
    if ((answer.from ?? 0) > 0) copy = await loadCached(machine.id, sessionId);
    let merged = mergeTranscript(copy?.messages ?? [], held, answer);
    if (merged === undefined) {
      // The answer does not fit the copy (the copy changed, or was damaged): take the whole transcript.
      answer = await fetchTranscript(machine, sessionId, undefined);
      if (answer === null) return "missing";
      copy = undefined;
      merged = mergeTranscript([], undefined, answer);
      if (merged === undefined) return "invalid";
    }
    const updatedAt = currentTo(answer.session?.updatedAt, listed);
    const nothingNew =
      copy !== undefined && (answer.from ?? 0) > 0 && answer.messages.length === 0 && JSON.stringify(copy.state) === JSON.stringify(answer.state);
    if (nothingNew) {
      touchCached(machine.id, sessionId, updatedAt);
      return "current";
    }
    saveCached(machine.id, sessionId, { updatedAt, session: answer.session, state: answer.state ?? null, messages: merged });
    return "saved";
  });
}

/** A pass in flight per machine, and the newer list a pass asked for meanwhile. */
const passes = new Map<string, { pending?: { sessions: readonly SessionSummary[]; current: () => boolean } }>();

/**
 * Refresh every session of `sessions` active in the last 24 hours whose copy
 * is older than it, newest first, one at a time. A pass asked for while one
 * runs for the machine runs after it, with the newer list; `current` false
 * stops a pass (the screen left, another computer is shown). A failed request
 * ends the pass: the computer is likely out of reach.
 */
export async function syncSessions(machine: Machine, sessions: readonly SessionSummary[], current: () => boolean): Promise<void> {
  const running = passes.get(machine.id);
  if (running !== undefined) {
    running.pending = { sessions, current };
    return;
  }
  const pass: { pending?: { sessions: readonly SessionSummary[]; current: () => boolean } } = {};
  passes.set(machine.id, pass);
  try {
    let next: { sessions: readonly SessionSummary[]; current: () => boolean } | undefined = { sessions, current };
    while (next !== undefined) {
      const { sessions: list, current: still } = next;
      pass.pending = undefined;
      if (still() && (await syncs(machine))) {
        for (const session of syncQueue(list, cachedEntries(machine.id), missesOf(machine), Date.now())) {
          if (!still()) break;
          try {
            await refreshTranscript(machine, session.id, session.updatedAt);
          } catch {
            break;
          }
        }
      }
      next = pass.pending;
    }
  } finally {
    passes.delete(machine.id);
  }
}
