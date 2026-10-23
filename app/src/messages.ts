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

function messageToItem(message: AgentMessage, index: number): ChatItem | undefined {
  const role = roleOf(message);
  if (role === undefined) return undefined;
  const text = textOf(message.content);
  if (text.trim() === "" && (role !== "assistant" || thinkingOf(message.content) === undefined)) return undefined;
  return {
    kind: "message",
    id: message.id ?? `m-${index}`,
    role,
    text,
    thinking: thinkingOf(message.content),
    createdAt: typeof message.timestamp === "number" ? message.timestamp : undefined,
  };
}

/** The `toolCall` parts of an assistant message, as the cards live `tool_execution_start` events produce. */
function toolCallsOf(message: AgentMessage): ToolItem[] {
  if (message.role !== "assistant" || !Array.isArray(message.content)) return [];
  const tools: ToolItem[] = [];
  for (const part of message.content) {
    if (part === null || typeof part !== "object") continue;
    const call = part as { type?: unknown; id?: unknown; name?: unknown; arguments?: unknown };
    if (call.type !== "toolCall" || typeof call.id !== "string") continue;
    tools.push({
      kind: "tool",
      id: call.id,
      name: typeof call.name === "string" ? call.name : "tool",
      args: call.arguments,
      status: "running",
    });
  }
  return tools;
}

/**
 * The transcript a session's stored messages render as: the same items the
 * live events produce, so reopening a chat shows each tool call under its own
 * name and arguments with its result attached, not a separate result card.
 */
export function snapshotItems(messages: AgentMessage[]): ChatItem[] {
  const items: ChatItem[] = [];
  const tools = new Map<string, ToolItem>();
  messages.forEach((message, index) => {
    if (message.role === "toolResult" || message.role === "tool") {
      const id = typeof message.toolCallId === "string" ? message.toolCallId : undefined;
      const tool = id === undefined ? undefined : tools.get(id);
      if (tool !== undefined) {
        tool.result = { content: message.content };
        tool.isError = message.isError === true;
        tool.status = tool.isError ? "error" : "done";
        return;
      }
      const text = textOf(message.content).trim();
      if (text === "") return;
      items.push({
        kind: "tool",
        id: id ?? message.id ?? nextId("tool"),
        name: typeof message.toolName === "string" ? message.toolName : "result",
        args: null,
        result: text,
        isError: message.isError === true,
        status: message.isError === true ? "error" : "done",
      });
      return;
    }
    const item = messageToItem(message, index);
    if (item !== undefined) items.push(item);
    for (const tool of toolCallsOf(message)) {
      tools.set(tool.id, tool);
      items.push(tool);
    }
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
 * The message an update or end belongs to. OMP's RPC messages carry no id, so
 * the open message of the same role is the one being emitted; an id, when
 * present, wins.
 */
function openIndex(items: ChatItem[], message: AgentMessage | undefined): number {
  if (message?.id !== undefined) {
    const byId = items.findIndex((entry) => entry.id === message.id);
    if (byId !== -1) return byId;
  }
  const role = message === undefined ? undefined : roleOf(message);
  for (let at = items.length - 1; at >= 0; at -= 1) {
    const entry = items[at];
    if (entry?.kind === "message" && entry.open === true && (role === undefined || entry.role === role)) return at;
  }
  return -1;
}

/** An assistant message with neither text nor thinking: a turn that only called tools. */
function blank(item: MessageItem): boolean {
  return item.role === "assistant" && item.text.trim() === "" && (item.thinking ?? "").trim() === "";
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
    if (message === undefined || roleOf(message) === undefined) return items;
    const text = textOf(message.content);
    const item: MessageItem = {
      kind: "message",
      id: message.id ?? nextId("msg"),
      role: roleOf(message) ?? "assistant",
      text,
      thinking: thinkingOf(message.content),
      streaming: true,
      open: true,
    };
    return [...items.filter((entry) => entry.id !== item.id), item];
  }
  if (type === "message_update") {
    const message = event.message as AgentMessage | undefined;
    const delta = streamingText(event);
    if (delta.text === undefined && delta.thinking === undefined) return items;
    const at = openIndex(items, message);
    if (at === -1) return items;
    return items.map((entry, index) => {
      if (index !== at || entry.kind !== "message") return entry;
      return {
        ...entry,
        text: entry.text + (delta.text ?? ""),
        thinking: delta.thinking === undefined ? entry.thinking : (entry.thinking ?? "") + delta.thinking,
        streaming: true,
      };
    });
  }
  if (type === "message_end") {
    const message = event.message as AgentMessage | undefined;
    if (message === undefined) return items;
    const role = roleOf(message);
    if (role === undefined) return items;
    const at = openIndex(items, message);
    const previous = at === -1 ? undefined : items[at];
    const final: MessageItem = {
      kind: "message",
      id: previous?.id ?? message.id ?? nextId("msg"),
      role,
      text: textOf(message.content),
      thinking: thinkingOf(message.content),
      streaming: false,
      open: false,
    };
    const keep = !blank(final) && !(role !== "assistant" && final.text.trim() === "");
    if (at === -1) return keep ? [...items, final] : items;
    if (!keep) return items.filter((_, index) => index !== at);
    return items.map((entry, index) => (index === at ? final : entry));
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
    return items
      .filter((item) => !(item.kind === "message" && item.open === true && blank(item)))
      .map((item) =>
        item.kind === "message" && (item.streaming === true || item.open === true)
          ? { ...item, streaming: false, open: false }
          : item,
      );
  }
  return items;
}

/** Text a tool result carries: OMP results are `{content: [{type: "text", text}], details}`. */
export function resultText(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (value === null || typeof value !== "object") return undefined;
  const content = (value as { content?: unknown }).content;
  if (content === undefined) return undefined;
  const text = textOf(content);
  return text === "" ? undefined : text;
}

/** A short one-line result for a tool card. */
export function toolSummary(tool: ToolItem): string {
  const value = tool.result ?? tool.partial ?? tool.args;
  if (value === null || value === undefined) return tool.status === "running" ? "Running…" : "";
  const text = resultText(value);
  if (text !== undefined) return text.replace(/\s+/g, " ").slice(0, 300);
  try {
    return JSON.stringify(value).replace(/\s+/g, " ").slice(0, 300);
  } catch {
    return String(value);
  }
}
