import type { ChatItem, ToolItem } from "./types";

/** Items a saved transcript keeps: the end of the chat, which is what a reopen shows first. */
export const CACHED_ITEMS = 400;
/** Characters kept of one tool's arguments or output; the live snapshot has the rest. */
export const CACHED_TOOL_TEXT = 4_000;
/** Saved transcripts kept on the phone, most recently saved first. */
export const CACHED_SESSIONS = 40;

function clip(text: string): string {
  return text.length <= CACHED_TOOL_TEXT ? text : `${text.slice(0, CACHED_TOOL_TEXT)}…`;
}

/** A tool value as text no longer than the cache keeps: OMP results by their text, anything else as JSON. */
function clipValue(value: unknown): unknown {
  if (value === undefined || value === null) return value;
  if (typeof value === "string") return clip(value);
  const content = typeof value === "object" && "content" in value ? value.content : undefined;
  if (Array.isArray(content)) {
    const text = content
      .map((part) => (part !== null && typeof part === "object" && typeof part.text === "string" ? part.text : ""))
      .join("");
    return { content: [{ type: "text", text: clip(text) }] };
  }
  let json: string;
  try {
    json = JSON.stringify(value);
  } catch {
    return undefined;
  }
  return json.length <= CACHED_TOOL_TEXT ? value : clip(json);
}

/**
 * The part of a transcript worth saving: its last {@link CACHED_ITEMS} items,
 * nothing marked as still streaming (a cached chat is not live), and tool
 * arguments and output cut to {@link CACHED_TOOL_TEXT} characters.
 */
export function forCache(items: readonly ChatItem[]): ChatItem[] {
  return items.slice(-CACHED_ITEMS).map((item) => {
    if (item.kind === "message") return { ...item, streaming: false, open: false };
    if (item.kind === "tool") {
      const tool: ToolItem = {
        ...item,
        args: clipValue(item.args),
        result: clipValue(item.result ?? item.partial),
        partial: undefined,
        status: item.status === "running" ? "done" : item.status,
      };
      return tool;
    }
    return item;
  });
}

/** Saved transcripts to delete: all but the {@link CACHED_SESSIONS} most recently saved. */
export function stale<T extends { savedAt: number }>(saved: readonly T[]): T[] {
  return [...saved].sort((a, b) => b.savedAt - a.savedAt).slice(CACHED_SESSIONS);
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
