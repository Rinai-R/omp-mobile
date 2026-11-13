/**
 * What a DSH Remote Host's `pi` (ACP) backend says about an OMP session, in
 * the shapes the chat already renders: stored history as OMP agent messages
 * (`snapshotItems`), live `session/update` frames as `omp --mode rpc` events
 * (`applyEvent`), and permission requests as approval sheets.
 *
 * Pure: no imports but types, so node:test loads this file directly.
 */
import type { AgentMessage, ApprovalRequest, ModelOption, SessionState } from "../types";

type Json = Record<string, unknown>;

function record(value: unknown): Json | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Json) : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/** `[{type: "text", text}]` parts, from ACP content blocks or DSH message parts. */
function textParts(content: unknown): { type: "text"; text: string }[] {
  if (!Array.isArray(content)) return [];
  const parts: { type: "text"; text: string }[] = [];
  for (const item of content) {
    const part = record(item);
    if (part === undefined) continue;
    // ACP tool content wraps its block: `{type: "content", content: {type: "text", text}}`.
    const block = part.type === "content" ? record(part.content) : part;
    const value = block?.type === "text" ? text(block.text) : undefined;
    if (value !== undefined) parts.push({ type: "text", text: value });
  }
  return parts;
}

function parseArguments(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

/**
 * A session's stored history (DSH `loadSessionHistory` events) as OMP agent
 * messages: user prompts, assistant replies with their tool calls, and tool
 * results. Turn and step markers carry nothing the chat shows.
 */
export function historyMessages(events: readonly unknown[]): AgentMessage[] {
  const messages: AgentMessage[] = [];
  /** Tool calls not yet attached to an assistant message: they precede its text in DSH's projection. */
  let calls: Json[] = [];
  /** The assistant message the step's calls belong to, once one exists. */
  let assistant: AgentMessage | undefined;
  /** Each call's title by id: its result repeats it. */
  const names = new Map<string, string>();
  const flushCalls = () => {
    if (calls.length === 0) return;
    if (assistant !== undefined && Array.isArray(assistant.content)) {
      assistant.content = [...(assistant.content as unknown[]), ...calls];
    } else {
      messages.push({ role: "assistant", content: calls });
    }
    calls = [];
  };
  for (const entry of events) {
    const event = record(record(entry)?.event) ?? record(entry);
    const data = record(event?.data);
    if (event === undefined || data === undefined) continue;
    switch (event.type) {
      case "user/message": {
        flushCalls();
        assistant = undefined;
        const content = textParts(data.content);
        if (content.length > 0) messages.push({ id: text(data.id), role: "user", content });
        break;
      }
      case "tool/call": {
        const id = text(data.callId);
        if (id === undefined) break;
        const name = text(data.name) ?? "tool";
        names.set(id, name);
        calls.push({ type: "toolCall", id, name, arguments: parseArguments(data.arguments) });
        break;
      }
      case "tool/result": {
        flushCalls();
        assistant = undefined;
        const message = record(data.message);
        const parts = Array.isArray(message?.content) ? (message.content as unknown[]) : [];
        for (const item of parts) {
          const part = record(item);
          if (part?.type !== "tool-result") continue;
          const id = text(part.toolCallId);
          let content = textParts(part.content);
          // ACP's content opens with the call's own title line ("$ echo hi") and may close on the
          // output again, trimmed: the card already shows the title, so only the output stays.
          if (content[0] !== undefined && id !== undefined && content[0].text === names.get(id)) content = content.slice(1);
          const last = content.at(-1);
          if (content.length > 1 && last !== undefined && last.text === content.at(-2)?.text.trim()) content = content.slice(0, -1);
          messages.push({ id: text(message?.id), role: "toolResult", toolCallId: id, content, isError: part.isError === true });
        }
        break;
      }
      case "assistant/message": {
        const message = record(data.message);
        const content = Array.isArray(message?.content) ? [...textParts(message.content), ...calls] : calls;
        calls = [];
        assistant = { id: text(message?.id), role: "assistant", content };
        messages.push(assistant);
        break;
      }
      default:
        break;
    }
  }
  flushCalls();
  return messages;
}

/** One translated frame: an OMP event for the transcript, or a change to what the chat shows around it. */
export type AcpOutput =
  | { type: "event"; event: Json }
  | { type: "state"; state: Partial<SessionState> }
  | { type: "approval"; request: ApprovalRequest }
  | { type: "approval_resolved"; id: string }
  | { type: "title"; title: string };

/** A permission request the phone holds, by the approval id the sheet answers with. */
export interface PendingApproval {
  handle: string;
  options: { id: string; name: string; kind: string }[];
  request: ApprovalRequest;
}

/** What an approval answer means to the Host: `respond`'s decision. */
export type Decision = "allow-once" | "reject-once" | "cancel";

/**
 * Turns one session's live ACP frames into OMP events. Stateful: ACP streams
 * chunks without message boundaries, so it opens and closes the assistant
 * message around them, and it remembers tool calls and permission requests.
 *
 * The Host sends a permission request once and never again; `pending` may be
 * shared by the translators of one session, so a request still unanswered
 * when the chat closed is shown again when it reopens (`waiting`).
 */
export class AcpTranslator {
  /** The assistant message being written: its id and what it said so far. */
  private open: { id: string; text: string; thinking: string } | undefined;
  private readonly tools = new Map<string, { name: string; args: unknown }>();
  private readonly pending: Map<string, PendingApproval>;
  private counter = 0;

  constructor(pending = new Map<string, PendingApproval>()) {
    this.pending = pending;
  }

  /** Requests the Host still waits on, to show again. */
  waiting(): AcpOutput[] {
    return [...this.pending.values()].map((item) => ({ type: "approval", request: item.request }));
  }

  /** A new turn's prompt, sent from this phone: the user message the stream does not echo. */
  prompted(prompt: string): AcpOutput[] {
    const message = { id: this.id("user"), role: "user", content: [{ type: "text", text: prompt }], timestamp: Date.now() };
    return [
      ...this.closeMessage(),
      { type: "event", event: { type: "agent_start" } },
      { type: "event", event: { type: "message_start", message } },
      { type: "event", event: { type: "message_end", message } },
      { type: "state", state: { isStreaming: true } },
    ];
  }

  /** The turn ended, from the prompt's own answer or the stream: close what is open. */
  ended(stopReason?: string, error?: string): AcpOutput[] {
    const stop = error !== undefined ? "error" : stopReason === "cancelled" ? "aborted" : undefined;
    const out = this.closeMessage(stop, error);
    // A turn that ended leaves nothing to approve.
    for (const id of this.pending.keys()) out.push({ type: "approval_resolved", id });
    this.pending.clear();
    out.push({ type: "event", event: { type: "agent_end" } }, { type: "state", state: { isStreaming: false } });
    return out;
  }

  frame(method: string, params: unknown): AcpOutput[] {
    const body = record(params);
    if (body === undefined) return [];
    if (method === "session/request_permission") return this.permission(body);
    if (method !== "session/update") return [];
    const update = record(body.update);
    if (update === undefined) return [];
    switch (update.sessionUpdate) {
      case "agent_message_chunk":
      case "agent_thought_chunk": {
        const chunk = text(record(update.content)?.text) ?? "";
        if (chunk === "") return [];
        const thinking = update.sessionUpdate === "agent_thought_chunk";
        const out: AcpOutput[] = [];
        const messageId = text(update.messageId);
        if (this.open === undefined || (messageId !== undefined && messageId !== this.open.id)) {
          out.push(...this.closeMessage());
          this.open = { id: messageId ?? this.id("msg"), text: "", thinking: "" };
          out.push({ type: "event", event: { type: "message_start", message: { id: this.open.id, role: "assistant", content: [], timestamp: Date.now() } } });
          out.push({ type: "state", state: { isStreaming: true } });
        }
        if (thinking) this.open.thinking += chunk;
        else this.open.text += chunk;
        out.push({
          type: "event",
          event: {
            type: "message_update",
            message: { id: this.open.id, role: "assistant" },
            assistantMessageEvent: { type: thinking ? "thinking_delta" : "text_delta", delta: chunk },
          },
        });
        return out;
      }
      case "user_message_chunk": {
        // A prompt sent from another client of the same session.
        const chunk = text(record(update.content)?.text) ?? "";
        if (chunk === "") return [];
        const message = { id: text(update.messageId) ?? this.id("user"), role: "user", content: [{ type: "text", text: chunk }], timestamp: Date.now() };
        return [...this.closeMessage(), { type: "event", event: { type: "message_start", message } }, { type: "event", event: { type: "message_end", message } }];
      }
      case "tool_call": {
        const id = text(update.toolCallId);
        if (id === undefined) return [];
        const name = text(update.name) ?? text(update.title) ?? "tool";
        const args = update.rawInput ?? {};
        this.tools.set(id, { name, args });
        return [
          ...this.closeMessage(),
          { type: "event", event: { type: "tool_execution_start", toolCallId: id, toolName: name, intent: text(record(args)?.i), args } },
          { type: "state", state: { isStreaming: true } },
        ];
      }
      case "tool_call_update": {
        const id = text(update.toolCallId);
        if (id === undefined) return [];
        const out: AcpOutput[] = [];
        if (!this.tools.has(id)) {
          // Joined mid-call: the card the start would have made.
          const name = text(update.name) ?? text(update.title) ?? "tool";
          this.tools.set(id, { name, args: update.rawInput ?? {} });
          out.push({ type: "event", event: { type: "tool_execution_start", toolCallId: id, toolName: name, args: update.rawInput ?? {} } });
        }
        const result = toolResult(update);
        if (update.status === "completed" || update.status === "failed") {
          this.tools.delete(id);
          out.push({ type: "event", event: { type: "tool_execution_end", toolCallId: id, result, isError: update.status === "failed" } });
        } else if (result !== undefined) {
          out.push({ type: "event", event: { type: "tool_execution_update", toolCallId: id, partialResult: result } });
        }
        return out;
      }
      case "usage_update": {
        const used = typeof update.used === "number" ? update.used : undefined;
        const size = typeof update.size === "number" ? update.size : undefined;
        if (used === undefined) return [];
        return [
          {
            type: "state",
            state: { contextUsage: { tokens: used, contextWindow: size, percent: size !== undefined && size > 0 ? (used / size) * 100 : undefined } },
          },
        ];
      }
      case "session_info_update": {
        const title = text(update.title);
        return title === undefined || title.trim() === "" ? [] : [{ type: "title", title }];
      }
      case "prompt_completed":
        return this.ended(text(update.stopReason));
      case "prompt_failed":
        return this.ended(undefined, text(update.error) ?? text(record(update.error)?.message) ?? "The turn failed.");
      default:
        return [];
    }
  }

  /** The Host's answer for an approval the sheet closed with; undefined for one this phone does not hold. */
  answer(id: string, value: { value?: string; confirmed?: boolean; cancelled?: boolean }): { handle: string; decision: Decision } | undefined {
    const pending = this.pending.get(id);
    if (pending === undefined) return undefined;
    this.pending.delete(id);
    if (value.cancelled === true || value.value === undefined) return { handle: pending.handle, decision: "cancel" };
    const option = pending.options.find((item) => item.name === value.value);
    // ACP `allow_always` is granted once here: the phone has no way to show what "always" would cover.
    const decision: Decision = option === undefined ? "cancel" : option.kind.startsWith("allow") ? "allow-once" : "reject-once";
    return { handle: pending.handle, decision };
  }

  private permission(body: Json): AcpOutput[] {
    const pending = permissionRequest(body);
    if (pending === undefined) return [];
    this.pending.set(pending.request.id, pending);
    return [{ type: "approval", request: pending.request }];
  }

  /** End the assistant message being written, with the text its chunks added up to. */
  private closeMessage(stop?: "error" | "aborted", error?: string): AcpOutput[] {
    const open = this.open;
    if (open === undefined) {
      if (stop === undefined) return [];
      // A turn that ended badly before saying anything still says how it ended.
      const message = { id: this.id("msg"), role: "assistant", content: [], stopReason: stop, errorMessage: error };
      return [{ type: "event", event: { type: "message_end", message } }];
    }
    this.open = undefined;
    const content: Json[] = [];
    if (open.thinking !== "") content.push({ type: "thinking", thinking: open.thinking });
    if (open.text !== "") content.push({ type: "text", text: open.text });
    const message: Json = { id: open.id, role: "assistant", content };
    if (stop !== undefined) {
      message.stopReason = stop;
      message.errorMessage = error;
    }
    return [{ type: "event", event: { type: "message_end", message } }];
  }

  private id(prefix: string): string {
    this.counter += 1;
    return `acp-${prefix}-${Date.now().toString(36)}-${this.counter}`;
  }
}

/** A `session/request_permission` as the approval sheet shows it; undefined for one the phone cannot answer. */
export function permissionRequest(params: unknown): PendingApproval | undefined {
  const body = record(params);
  if (body === undefined) return undefined;
  const handle = text(body.requestHandle);
  if (handle === undefined) return undefined;
  const call = record(body.toolCall);
  const options = (Array.isArray(body.options) ? body.options : [])
    .map((item) => record(item))
    .filter((item): item is Json => item !== undefined)
    .map((item) => ({ id: text(item.optionId) ?? "", name: text(item.name) ?? "", kind: text(item.kind) ?? "" }))
    // Always-rules are the Host's settings, not a one-tap choice on a phone.
    .filter((item) => item.name !== "" && !item.kind.endsWith("_always"));
  if (options.length === 0) return undefined;
  const id = `acp-${handle}`;
  const title = text(call?.title) ?? "Allow this tool call?";
  const command = text(record(call?.rawInput)?.command);
  const request: ApprovalRequest = {
    id,
    method: "select",
    title,
    message: command !== undefined && command !== title ? command : undefined,
    options: options.map((item) => item.name),
  };
  return { handle, options, request };
}

/** Whether a `session/update` says the turn is over. */
export function endsTurn(params: unknown): boolean {
  const update = record(record(params)?.update)?.sessionUpdate;
  return update === "prompt_completed" || update === "prompt_failed";
}

/** A tool's output as OMP results carry it: `{content: [{type: "text", text}]}`. */
function toolResult(update: Json): unknown {
  const raw = record(update.rawOutput);
  if (raw !== undefined && Array.isArray(raw.content)) return { content: textParts(raw.content) };
  // Without raw output, ACP content repeats the call's own line first ("$ echo …"): the rest is output.
  const parts = textParts(update.content);
  if (parts.length === 0) return undefined;
  return { content: parts.slice(1) };
}

/** The Host's model catalog for a session, as the model sheet lists models. */
export function modelOptions(catalog: unknown): { models: ModelOption[]; current?: { provider: string; model: string; effort?: string } } {
  const body = record(catalog);
  const models: ModelOption[] = [];
  for (const group of Array.isArray(body?.groups) ? body.groups : []) {
    const provider = text(record(group)?.id);
    const list = record(group)?.models;
    if (provider === undefined || !Array.isArray(list)) continue;
    for (const item of list) {
      const model = record(item);
      const id = text(model?.id);
      if (id === undefined) continue;
      const efforts = (Array.isArray(record(model?.reasoning)?.efforts) ? (record(model?.reasoning)?.efforts as unknown[]) : [])
        .map((effort) => text(record(effort)?.id))
        .filter((effort): effort is string => effort !== undefined);
      models.push({ provider, id, name: text(model?.name) ?? id, reasoning: efforts.length > 0, input: ["text", "image"], efforts });
    }
  }
  const current = record(body?.current);
  const provider = text(current?.provider);
  const model = text(current?.model);
  return {
    models,
    current: provider === undefined || model === undefined ? undefined : { provider, model, effort: text(current?.reasoningEffort) },
  };
}
