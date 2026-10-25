import type { AgentMessage, ChatItem, ImagePart, MessageItem, NoticeItem, ToolItem } from "./types";
import { t } from "./i18n/index.ts";

let counter = 0;
const nextId = (prefix: string): string => `${prefix}-${Date.now().toString(36)}-${(counter += 1)}`;

function partText(part: unknown): string {
  if (typeof part === "string") return part;
  if (part === null || part === undefined || typeof part !== "object") return "";
  const value = part as { type?: unknown; text?: unknown; content?: unknown };
  // Thinking is not the message's text; `thinkingOf` reads it.
  if (value.type === "thinking" || value.type === "redactedThinking") return "";
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

/**
 * The thinking of an assistant message. OMP keeps it as
 * `{type: "thinking", thinking}` parts; `text` is accepted too.
 */
export function thinkingOf(content: unknown): string | undefined {
  if (!Array.isArray(content)) return undefined;
  const text = content
    .map((part) => {
      if (part === null || typeof part !== "object" || (part as { type?: unknown }).type !== "thinking") return "";
      const value = part as { thinking?: unknown; text?: unknown };
      if (typeof value.thinking === "string") return value.thinking;
      return typeof value.text === "string" ? value.text : "";
    })
    .filter((value) => value !== "")
    .join("\n\n");
  return text.trim() === "" ? undefined : text;
}

/**
 * Image data the phone can show: a blob reference into the computer's store, or
 * base64. OMP writes placeholders such as `<76 bytes>` where it dropped the
 * bytes; those are not images.
 */
function imageData(data: string): boolean {
  if (/^blob:sha256:[0-9a-f]{64}$/.test(data)) return true;
  if (/^data:image\/[a-z0-9.+-]+;base64,/i.test(data)) return true;
  return data.length >= 16 && /^[A-Za-z0-9+/]+={0,2}$/.test(data.slice(0, 4096).replace(/\s+/g, ""));
}

/**
 * Image parts of a content array. OMP keeps them as `{type:"image", data, mimeType}`,
 * where `data` is base64 or a `blob:sha256:` reference into the computer's store.
 */
function imagesOf(content: unknown): ImagePart[] | undefined {
  if (!Array.isArray(content)) return undefined;
  const images: ImagePart[] = [];
  for (const part of content) {
    if (part === null || typeof part !== "object") continue;
    if (!("type" in part) || part.type !== "image") continue;
    if (!("data" in part) || typeof part.data !== "string" || !imageData(part.data)) continue;
    const mimeType = "mimeType" in part && typeof part.mimeType === "string" ? part.mimeType : undefined;
    images.push({ data: part.data, mimeType });
  }
  return images.length === 0 ? undefined : images;
}

/** A result's details.mediaPath, when it names a file in OMP's blob store, as an image part. */
function mediaImages(result: unknown): ImagePart[] | undefined {
  if (result === null || typeof result !== "object") return undefined;
  if (!("details" in result) || result.details === null || typeof result.details !== "object") return undefined;
  const details = result.details;
  if (!("mediaPath" in details) || typeof details.mediaPath !== "string") return undefined;
  const name = details.mediaPath.split("/").pop() ?? "";
  const hash = name.replace(/\.[a-z0-9]+$/i, "");
  return /^[0-9a-f]{64}$/.test(hash) ? [{ data: `blob:sha256:${hash}` }] : undefined;
}

/** Images a tool result carries: inline parts, else a stored media path. */
function resultImages(result: unknown): ImagePart[] | undefined {
  if (result === null || typeof result !== "object") return undefined;
  return imagesOf("content" in result ? result.content : undefined) ?? mediaImages(result);
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
  const thinking = thinkingOf(message.content);
  const images = imagesOf(message.content);
  const empty = text.trim() === "";
  if (empty && images === undefined && (role !== "assistant" || thinking === undefined)) return undefined;
  return {
    kind: "message",
    id: message.id ?? `m-${index}`,
    role,
    text,
    thinking,
    images,
    createdAt: typeof message.timestamp === "number" ? message.timestamp : undefined,
  };
}

/** The one-line intent OMP attaches to a tool call, from the part or its `i` argument. */
function intentOf(part: object): string | undefined {
  if ("intent" in part && typeof part.intent === "string" && part.intent.trim() !== "") return part.intent;
  if (!("arguments" in part) || part.arguments === null || typeof part.arguments !== "object") return undefined;
  const args = part.arguments;
  if (!("i" in args) || typeof args.i !== "string" || args.i.trim() === "") return undefined;
  return args.i;
}

/** The `toolCall` parts of an assistant message, as the cards live `tool_execution_start` events produce. */
function toolCallsOf(message: AgentMessage): ToolItem[] {
  if (message.role !== "assistant" || !Array.isArray(message.content)) return [];
  const tools: ToolItem[] = [];
  for (const part of message.content) {
    if (part === null || typeof part !== "object") continue;
    if (!("type" in part) || part.type !== "toolCall") continue;
    if (!("id" in part) || typeof part.id !== "string") continue;
    tools.push({
      kind: "tool",
      id: part.id,
      name: "name" in part && typeof part.name === "string" ? part.name : "tool",
      intent: intentOf(part),
      args: "arguments" in part ? part.arguments : undefined,
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
export function snapshotItems(messages: AgentMessage[], offset = 0): ChatItem[] {
  // `offset`: where `messages` start in the transcript (a cached tail), so ids stay those of the whole.
  const items: ChatItem[] = [];
  const tools = new Map<string, ToolItem>();
  messages.forEach((message, index) => {
    if (message.role === "toolResult" || message.role === "tool") {
      const id = typeof message.toolCallId === "string" ? message.toolCallId : undefined;
      const tool = id === undefined ? undefined : tools.get(id);
      const images = resultImages(message);
      if (tool !== undefined) {
        tool.result = { content: message.content };
        tool.isError = message.isError === true;
        tool.status = tool.isError ? "error" : "done";
        tool.images = images;
        return;
      }
      const text = textOf(message.content).trim();
      if (text === "" && images === undefined) return;
      items.push({
        kind: "tool",
        id: id ?? message.id ?? nextId("tool"),
        name: typeof message.toolName === "string" ? message.toolName : "result",
        args: null,
        result: text,
        isError: message.isError === true,
        status: message.isError === true ? "error" : "done",
        images,
      });
      return;
    }
    const item = messageToItem(message, offset + index);
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
      images: imagesOf(message.content),
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
    const now = Date.now();
    return items.map((entry, index) => {
      if (index !== at || entry.kind !== "message") return entry;
      const thinkingStartedAt = entry.thinkingStartedAt ?? (delta.thinking !== undefined ? now : undefined);
      // Thinking ends where the answer starts.
      const thinkingMs =
        entry.thinkingMs ??
        (delta.text !== undefined && delta.text !== "" && thinkingStartedAt !== undefined ? now - thinkingStartedAt : undefined);
      return {
        ...entry,
        text: entry.text + (delta.text ?? ""),
        thinking: delta.thinking === undefined ? entry.thinking : (entry.thinking ?? "") + delta.thinking,
        thinkingStartedAt,
        thinkingMs,
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
    const before = previous?.kind === "message" ? previous : undefined;
    const thinking = thinkingOf(message.content) ?? before?.thinking;
    const started = before?.thinkingStartedAt;
    const final: MessageItem = {
      kind: "message",
      id: previous?.id ?? message.id ?? nextId("msg"),
      role,
      text: textOf(message.content),
      // What streamed stays when the final message leaves a part out.
      thinking,
      thinkingStartedAt: started,
      thinkingMs: before?.thinkingMs ?? (started !== undefined && thinking !== undefined ? Date.now() - started : undefined),
      images: imagesOf(message.content),
      streaming: false,
      open: false,
    };
    const keep = !blank(final) && !(role !== "assistant" && final.text.trim() === "" && final.images === undefined);
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
      intent: typeof event.intent === "string" && event.intent.trim() !== "" ? event.intent : undefined,
      args: event.args,
      status: "running",
      startedAt: Date.now(),
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
    const result = event.result;
    const images = resultImages(result);
    return updateItem(items, id, (item) => {
      if (item.kind !== "tool") return;
      item.result = result;
      item.isError = isError;
      item.status = isError ? "error" : "done";
      item.partial = undefined;
      item.images = images;
      item.endedAt = Date.now();
    });
  }
  if (type === "auto_compaction_start" || type === "auto_retry_start" || type === "auto_retry_end") {
    const level: NoticeItem["level"] =
      type === "auto_retry_end" && event.success !== true ? "error" : type === "auto_retry_start" ? "warning" : "info";
    const text =
      type === "auto_compaction_start"
        ? t("notice.compacting")
        : type === "auto_retry_end"
          ? event.success === true
            ? t("notice.retrySucceeded")
            : t("notice.retryStopped", { error: String(event.finalError ?? t("notice.unknownError")) })
          : t("notice.retrying", {
              attempt: String(event.attempt ?? "?"),
              max: String(event.maxAttempts ?? "?"),
              error: String(event.errorMessage ?? ""),
            });
    return [...items, { kind: "notice", id: nextId("notice"), level, text }];
  }
  if (type === "auto_compaction_end") {
    const failed = event.errorMessage !== undefined && event.errorMessage !== null;
    const text = failed
      ? t("notice.compactionFailed", { error: String(event.errorMessage) })
      : event.aborted === true
        ? t("notice.compactionStopped")
        : t("notice.compacted");
    return [...items, { kind: "notice", id: nextId("notice"), level: failed ? "warning" : "info", text }];
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
    const now = Date.now();
    return items
      .filter((item) => !(item.kind === "message" && item.open === true && blank(item)))
      .map((item) =>
        item.kind === "message" && (item.streaming === true || item.open === true)
          ? {
              ...item,
              streaming: false,
              open: false,
              thinkingMs:
                item.thinkingMs ?? (item.thinkingStartedAt !== undefined && item.thinking !== undefined ? now - item.thinkingStartedAt : undefined),
            }
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
  if (value === null || value === undefined) return tool.status === "running" ? t("tool.running") : "";
  const text = resultText(value);
  if (text !== undefined) return text.replace(/\s+/g, " ").slice(0, 300);
  try {
    return JSON.stringify(value).replace(/\s+/g, " ").slice(0, 300);
  } catch {
    return String(value);
  }
}
