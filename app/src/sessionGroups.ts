import type { SessionSummary } from "./types";

/**
 * How the session lists group a computer's sessions: what needs an answer
 * first, then what is running, then the rest by recency, and terminal sessions
 * last. A session appears in exactly one group.
 */
export type GroupKey = "waiting" | "running" | "today" | "earlier" | "terminal";

export interface SessionGroup {
  key: GroupKey;
  title: string;
  sessions: SessionSummary[];
}

const TITLES: Record<GroupKey, string> = {
  waiting: "Needs you",
  running: "Running",
  today: "Today",
  earlier: "Earlier",
  terminal: "From the terminal",
};

function startOfDay(now: number): number {
  const date = new Date(now);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/** Whether `session` matches a search: every word of `query` in its title, directory or model. */
export function matches(session: SessionSummary, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const haystack = `${session.title}\n${session.cwd}\n${session.model ?? ""}`.toLowerCase();
  return words.every((word) => haystack.includes(word));
}

/**
 * The groups for `sessions`, newest first inside each, empty groups left out.
 * The daemon lists the same OMP session once; a repeated id is shown once.
 */
export function groupSessions(sessions: readonly SessionSummary[], now = Date.now(), query = ""): SessionGroup[] {
  const today = startOfDay(now);
  const buckets = new Map<GroupKey, SessionSummary[]>();
  const seen = new Set<string>();
  for (const session of sessions) {
    if (seen.has(session.id) || !matches(session, query)) continue;
    seen.add(session.id);
    let key: GroupKey;
    if ((session.waiting ?? 0) > 0) key = "waiting";
    else if (session.status === "streaming") key = "running";
    else if (session.origin === "omp") key = "terminal";
    else key = session.updatedAt >= today ? "today" : "earlier";
    const list = buckets.get(key) ?? [];
    list.push(session);
    buckets.set(key, list);
  }
  const order: GroupKey[] = ["waiting", "running", "today", "earlier", "terminal"];
  return order
    .filter((key) => (buckets.get(key)?.length ?? 0) > 0)
    .map((key) => ({
      key,
      title: TITLES[key],
      sessions: [...(buckets.get(key) ?? [])].sort((a, b) => b.updatedAt - a.updatedAt),
    }));
}

/** "now", "5m", "3h", "2d", "Oct 3": a compact age for list rows. */
export function age(timestamp: number, now = Date.now()): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return "";
  const seconds = Math.max(0, Math.round((now - timestamp) / 1000));
  if (seconds < 60) return "now";
  if (seconds < 3_600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3_600)}h`;
  if (seconds < 7 * 86_400) return `${Math.floor(seconds / 86_400)}d`;
  const date = new Date(timestamp);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${months[date.getMonth()]} ${date.getDate()}`;
}

/** The last segment of a path: the folder a session runs in. */
export function folderOf(path: string): string {
  return path.split("/").filter(Boolean).at(-1) ?? path;
}

/** Running sessions and those waiting for an answer, for a machine's badge. */
export function attentionCount(sessions: readonly SessionSummary[]): { waiting: number; running: number } {
  let waiting = 0;
  let running = 0;
  for (const session of sessions) {
    if ((session.waiting ?? 0) > 0) waiting += 1;
    else if (session.status === "streaming") running += 1;
  }
  return { waiting, running };
}
