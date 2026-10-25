import { daemonFeatures, fetchTranscript, knownFeatures } from "./api";
import { currentTo, heldOfEntry, mergeTranscript, startOf, syncQueue } from "./cache";
import { cachedEntries, cachedEntry, loadTail, saveCached, sweepCache, touchCached } from "./transcripts";
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

/** The chat on screen: it keeps its own copy current, so a pass leaves it alone. */
let onScreen = { machineId: "", sessionId: "" };

/** A chat opened (or, with empty ids, closed): the background pass skips its session meanwhile. */
export function setSyncOnScreen(machineId: string, sessionId: string): void {
  onScreen = { machineId, sessionId };
}

/**
 * Bring one session's copy up to date from the daemon. `listed` is the
 * session's `updatedAt` as the list showed it, when known. A delta is
 * appended to the copy without reading it back.
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
    const from = answer.from ?? 0;
    if (from > 0 && held !== undefined) {
      // A delta: it must continue the copy exactly where the index says the copy ends.
      const fits = from === held.since && Array.isArray(answer.messages) && (answer.total === undefined || answer.total === from + answer.messages.length);
      if (fits) {
        const updatedAt = currentTo(answer.session?.updatedAt, listed);
        if (answer.messages.length === 0) {
          const tail = await loadTail(machine.id, sessionId);
          if (tail !== undefined && JSON.stringify(tail.state) === JSON.stringify(answer.state ?? null)) {
            touchCached(machine.id, sessionId, updatedAt);
            return "current";
          }
        }
        const saved = await saveCached(machine.id, sessionId, { updatedAt, session: answer.session, state: answer.state ?? null, messages: answer.messages, from });
        return saved ? "saved" : "current";
      }
      // The answer does not fit the copy (the copy changed, or was damaged): take the whole transcript.
      answer = await fetchTranscript(machine, sessionId, undefined);
      if (answer === null) return "missing";
    }
    if (startOf(answer) > 0) {
      // Past the daemon's message cap it holds only the session's end: no copy from its start to keep.
      // Not asked again for a while, rather than every pass for megabytes it cannot save.
      missesOf(machine).set(sessionId, Date.now());
      return "invalid";
    }
    const merged = mergeTranscript([], undefined, answer);
    if (merged === undefined) return "invalid";
    const updatedAt = currentTo(answer.session?.updatedAt, listed);
    const saved = await saveCached(machine.id, sessionId, { updatedAt, session: answer.session, state: answer.state ?? null, messages: merged });
    return saved ? "saved" : "current";
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
        const skip = () => (onScreen.machineId === machine.id ? onScreen.sessionId : undefined);
        for (const session of syncQueue(list, cachedEntries(machine.id), missesOf(machine), Date.now(), skip())) {
          if (!still()) break;
          // Opened while the pass ran.
          if (session.id === skip()) continue;
          try {
            await refreshTranscript(machine, session.id, session.updatedAt);
          } catch {
            break;
          }
        }
      }
      next = pass.pending;
    }
    // A long-lived app is not relaunched to expire copies: drop them after each pass.
    sweepCache();
  } finally {
    passes.delete(machine.id);
  }
}
