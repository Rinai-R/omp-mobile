import type { ChatItem } from "./types";

/**
 * How a chat's rows change when more of the transcript arrives under what is
 * on screen, without losing what live events added there: the reply that is
 * streaming, the prompt just sent, a tool that is still running. Rows from
 * snapshot messages alone know none of those until the turn ends.
 */

/** A row only live events know of: a message still being written, or a tool still running. */
function isLive(item: ChatItem): boolean {
  return (item.kind === "message" && item.open === true) || (item.kind === "tool" && item.status === "running");
}

/**
 * The older part of the copy (the rows of the messages before the tail) put
 * above the rows on screen. The rows on screen stay exactly as they are,
 * live ones included; an older row with the id of one on screen is left out.
 */
export function prependHistory(current: readonly ChatItem[], older: readonly ChatItem[]): ChatItem[] {
  if (older.length === 0) return [...current];
  const ids = new Set(current.map((item) => item.id));
  return [...older.filter((item) => !ids.has(item.id)), ...current];
}

/**
 * The rows a snapshot rebuilds, with what is still live on screen kept while
 * the session is mid-turn: a running tool keeps the output it has streamed so
 * far, and an open message or running tool the snapshot does not hold yet
 * stays at the end. When the session is not streaming the snapshot is the
 * whole truth (a turn that ended while the link was down must not stay open).
 */
export function keepLive(rebuilt: readonly ChatItem[], current: readonly ChatItem[], streaming: boolean): ChatItem[] {
  if (!streaming) return [...rebuilt];
  const live = new Map(current.filter(isLive).map((item) => [item.id, item]));
  if (live.size === 0) return [...rebuilt];
  const ids = new Set(rebuilt.map((item) => item.id));
  const merged = rebuilt.map((item) => {
    const shown = live.get(item.id);
    return item.kind === "tool" && item.status === "running" && shown?.kind === "tool" ? shown : item;
  });
  return [...merged, ...[...live.values()].filter((item) => !ids.has(item.id))];
}
