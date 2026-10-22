import type { AgentMessage, ChatItem, MessageItem, NoticeItem, ToolItem } from "./types";

let counter = 0;
const nextId = (prefix: string): string => `${prefix}-${Date.now().toString(36)}-${(counter += 1)}`;

function partText(part: unknown): string {
  if (typeof part === "string") return part;
  if (part === null || part === undefined || typeof part !== "object") return "";
  const value = part as { type?: unknown; text?: unknown; content?: unknown };
  if (typeof value.text === "string") return value.text;
  if (typeof value.content === "string") return value.content;
  return "";
}

/** Text of an OMP message content field (string or content-part array). */
export function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map(partText).join("");
  return partText(content);
}

function thinkingOf(content: unknown): string | undefined {
  if (!Array.isArray(content)) return undefined;
  const text = content
    .filter((part) => part !== null && typeof part === "object" && (part as { type?: unknown }).type === "thinking")
    .map(partText)
    .join("");
  return text === "" ? undefined : text;
}

export function roleOf(message: AgentMessage): MessageItem["role"] | undefined {
  if (message.role === "user" || message.role === "assistant" || message.role === "system") {
    return message.role;
  }
  return undefined;
}

export function messageToItem(message: AgentMessage, index: number): ChatItem | undefined {
  const role = roleOf(message);
  if (role === undefined) {
    if (message.role === "toolResult" || message.role === "tool") {
      const text = textOf(message.content).trim();
      if (text === "") return undefined;
      return {
        kind: "tool",
        id: message.id ?? nextId("tool"),
        name: "result",
        args: null,
        result: text,
        status: "done",
      };
    }
    return undefined;
  }
  const text = textOf(message.content);
  if (text.trim() === "" && role !== "assistant") return undefined;
  return {
    kind: "message",
    id: message.id ?? `m-${index}`,
    role,
    text,
    thinking: thinkingOf(message.content),
    createdAt: typeof message.timestamp === "number" ? message.timestamp : undefined,
  };
}

export function snapshotItems(messages: AgentMessage[]): ChatItem[] {
  const items: ChatItem[] = [];
  messages.forEach((message, index) => {
    const item = messageToItem(message, index);
    if (item !== undefined) items.push(item);
  });
  return items;
}

function streamingText(event: Record<string, unknown>): { text?: string; thinking?: string } {
  const inner = event.assistantMessageEvent as
    | { type?: string; delta?: string }
    | undefined;
  if (inner === undefined) return {};
  if (inner.type === "text_delta" && typeof inner.delta === "string") return { text: inner.delta };
  if (inner.type === "thinking_delta" && typeof inner.delta === "string") return { thinking: inner.delta };
  return {};
}

function updateItem(items: ChatItem[], id: string, update: (item: MessageItem | ToolItem) => void): ChatItem[] {
  let found = false;
  const next = items.map((item) => {
    if (item.id !== id) return item;
    found = true;
    const copy = { ...item } as MessageItem | ToolItem;
    update(copy);
    return copy;
  });
  return found ? next : items;
}

/**
 * Fold one OMP session event into the transcript.
 * Events are the same union `omp --mode rpc` emits; only the parts the native
 * UI renders are interpreted.
 */
export function applyEvent(items: ChatItem[], event: Record<string, unknown>): ChatItem[] {
  const type = event.type;
  if (type === "message_start") {
    const message = event.message as AgentMessage | undefined;
    if (message === undefined) return items;
    const item = messageToItem(message, items.length);
    if (item === undefined || item.kind !== "message") return items;
    if (items.some((entry) => entry.id === item.id)) return items;
    if (item.role === "assistant") item.streaming = true;
    return [...items, item];
  }
  if (type === "message_update") {
    const message = event.message as AgentMessage | undefined;
    const id = message?.id;
    if (id === undefined) return items;
    const delta = streamingText(event);
    if (delta.text === undefined && delta.thinking === undefined) return items;
    const existing = items.find((entry) => entry.id === id);
    if (existing === undefined) {
      if (message === undefined) return items;
      const item = messageToItem(message, items.length);
      if (item === undefined || item.kind !== "message") return items;
      item.streaming = true;
      if (delta.text !== undefined) item.text += delta.text;
      if (delta.thinking !== undefined) item.thinking = (item.thinking ?? "") + delta.thinking;
      return [...items, item];
    }
    return updateItem(items, id, (item) => {
      if (item.kind !== "message") return;
      if (delta.text !== undefined) item.text += delta.text;
      if (delta.thinking !== undefined) item.thinking = (item.thinking ?? "") + delta.thinking;
      item.streaming = true;
    });
  }
  if (type === "message_end") {
    const message = event.message as AgentMessage | undefined;
    if (message === undefined) return items;
    const item = messageToItem(message, items.length);
    if (item === undefined || item.kind !== "message") return items;
    item.streaming = false;
    const index = items.findIndex((entry) => entry.id === item.id);
    if (index === -1) return [...items, item];
    return items.map((entry, at) => (at === index ? item : entry));
  }
  if (type === "tool_execution_start") {
    const id = typeof event.toolCallId === "string" ? event.toolCallId : nextId("tool");
    const tool: ToolItem = {
      kind: "tool",
      id,
      name: typeof event.toolName === "string" ? event.toolName : "tool",
      args: event.args,
      status: "running",
    };
    return [...items.filter((entry) => entry.id !== id), tool];
  }
  if (type === "tool_execution_update") {
    const id = typeof event.toolCallId === "string" ? event.toolCallId : "";
    if (id === "") return items;
    return updateItem(items, id, (item) => {
      if (item.kind !== "tool") return;
      item.partial = event.partialResult;
    });
  }
  if (type === "tool_execution_end") {
    const id = typeof event.toolCallId === "string" ? event.toolCallId : "";
    if (id === "") return items;
    const isError = event.isError === true;
    return updateItem(items, id, (item) => {
      if (item.kind !== "tool") return;
      item.result = event.result;
      item.isError = isError;
      item.status = isError ? "error" : "done";
    });
  }
  if (type === "notice") {
    const level = event.level === "warning" || event.level === "error" ? event.level : "info";
    const notice: NoticeItem = {
      kind: "notice",
      id: nextId("notice"),
      level,
      text: String(event.message ?? ""),
    };
    return [...items, notice];
  }
  if (type === "turn_end" || type === "agent_end") {
    return items.map((item) =>
      item.kind === "message" && item.streaming === true ? { ...item, streaming: false } : item,
    );
  }
  return items;
}

/** A short one-line result for a tool card. */
export function toolSummary(tool: ToolItem): string {
  const value = tool.result ?? tool.partial ?? tool.args;
  if (value === null || value === undefined) return tool.status === "running" ? "Running…" : "";
  if (typeof value === "string") return value.replace(/\s+/g, " ").slice(0, 300);
  try {
    return JSON.stringify(value).replace(/\s+/g, " ").slice(0, 300);
  } catch {
    return String(value);
  }
}
