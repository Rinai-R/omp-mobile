/**
 * Attention stream: the moments a phone should hear about while the app is in
 * the background — a tool approval or another question waiting for an answer,
 * the answer (or cancellation) that settles it, and an agent run that finished
 * or failed — folded from what every live session broadcasts, across all
 * sessions, and served as one Server-Sent Events stream (`GET /events`).
 *
 * The tracker reads the same payloads `SessionEntry.broadcast` sends its
 * WebSocket clients (`{type: "event" | "approval" | "approval_resolved" |
 * "notice" | "closed", ...}`), so a frame never depends on a client being
 * connected to that session.
 */
import { hostname } from "node:os";

/** @typedef {"approval" | "question" | "resolved" | "done" | "failed"} AttentionKind */

/**
 * @typedef {object} AttentionFrame
 * @property {AttentionKind} kind
 * @property {string} key Waiting-item identity: the extension request id; `run:<n>` for done/failed.
 * @property {string} sessionId
 * @property {string} sessionTitle
 * @property {string} machine This computer's hostname.
 * @property {string} text Human text: the question, the final answer, or the failure.
 * @property {number} time Epoch ms.
 */

/** @typedef {{id: string, title?: string}} SessionLike */

/** The listener sends a comment this often so phones can tell a dead link from a quiet one. */
export const HEARTBEAT_MS = 25_000;
/** OMP's tool approval is a `select` whose title starts with this. */
export const TOOL_APPROVAL_PREFIX = "Allow tool:";
const ASKING = new Set(["select", "confirm", "input", "editor"]);
const TEXT_MAX = 280;

function clip(value) {
  const text = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
  return text.length > TEXT_MAX ? `${text.slice(0, TEXT_MAX - 1)}…` : text;
}

function textOf(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => (part && typeof part === "object" && part.type === "text" && typeof part.text === "string" ? part.text : ""))
    .join("");
}

/**
 * Whether an extension UI request is OMP's tool approval rather than another question.
 * @param {{method?: string, title?: unknown}} request
 */
export function isToolApproval(request) {
  return request.method === "select" && typeof request.title === "string" && request.title.startsWith(TOOL_APPROVAL_PREFIX);
}

function lastAssistant(messages) {
  if (!Array.isArray(messages)) return undefined;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i]?.role === "assistant") return messages[i];
  }
  return undefined;
}

/** Folds session broadcasts into attention frames and fans them out. */
export class AttentionTracker {
  /** @param {{machine?: string, now?: () => number}} [options] */
  constructor(options = {}) {
    this.machine = options.machine ?? hostname();
    this.now = options.now ?? (() => Date.now());
    /** @type {Map<string, {open: Map<string, AttentionFrame>, runs: number, error: string, last: object | undefined}>} */
    this.sessions = new Map();
    /** @type {Set<(frame: AttentionFrame) => void>} */
    this.subscribers = new Set();
  }

  /** Approvals and questions still waiting, across all sessions, oldest first. */
  pending() {
    const open = [];
    for (const state of this.sessions.values()) open.push(...state.open.values());
    return open.sort((a, b) => a.time - b.time);
  }

  /**
   * @param {(frame: AttentionFrame) => void} listener
   * @returns {() => void} unsubscribe
   */
  subscribe(listener) {
    this.subscribers.add(listener);
    return () => this.subscribers.delete(listener);
  }

  /** Drop a session that is gone, resolving whatever it still had open. */
  forget(session) {
    this.observe(session, { type: "closed" });
    this.sessions.delete(session.id);
  }

  /**
   * Fold one payload a session broadcast.
   * @param {SessionLike} session
   * @param {{type: string, [key: string]: any}} payload
   * @returns {AttentionFrame[]} the frames it produced
   */
  observe(session, payload) {
    const state = this.#state(session.id);
    const frames = [];
    const emit = (kind, key, text) => {
      const frame = {
        kind,
        key,
        sessionId: session.id,
        sessionTitle: session.title ?? "",
        machine: this.machine,
        text: clip(text),
        time: this.now(),
      };
      frames.push(frame);
      return frame;
    };
    switch (payload?.type) {
      case "approval": {
        const request = payload.request ?? {};
        if (typeof request.id !== "string" || !ASKING.has(request.method)) break;
        if (state.open.has(request.id)) break;
        const approval = isToolApproval(request);
        const title = typeof request.title === "string" ? request.title : "";
        // OMP's tool approval title is `Allow tool: bash\nCommand: echo hi`: the tool, then its details.
        const lines = (approval ? title.slice(TOOL_APPROVAL_PREFIX.length) : title).split("\n").map((line) => line.trim());
        const text = [...lines, request.message].filter(Boolean).join(" · ");
        state.open.set(request.id, emit(approval ? "approval" : "question", request.id, text));
        break;
      }
      case "approval_resolved": {
        if (typeof payload.id !== "string" || !state.open.delete(payload.id)) break;
        emit("resolved", payload.id, typeof payload.reason === "string" ? payload.reason : "answered");
        break;
      }
      case "closed": {
        for (const key of [...state.open.keys()]) {
          state.open.delete(key);
          emit("resolved", key, "closed");
        }
        break;
      }
      case "notice": {
        if (payload.level === "error") state.error = typeof payload.message === "string" ? payload.message : "error";
        break;
      }
      case "event":
        this.#event(state, payload.event ?? {}, emit);
        break;
      default:
    }
    for (const frame of frames) for (const listener of this.subscribers) listener(frame);
    return frames;
  }

  #event(state, event, emit) {
    switch (event.type) {
      case "agent_start":
        state.error = "";
        state.last = undefined;
        return;
      case "notice":
        if (event.level === "error") state.error = typeof event.message === "string" ? event.message : "error";
        return;
      case "message_end":
        if (event.message?.role === "assistant") state.last = event.message;
        return;
      case "agent_end": {
        state.runs += 1;
        const key = `run:${state.runs}`;
        const last = lastAssistant(event.messages) ?? state.last;
        const stop = last?.stopReason;
        if (stop === "error" || stop === "aborted") {
          const reason = typeof last.errorMessage === "string" && last.errorMessage !== "" ? last.errorMessage : stop === "aborted" ? "Aborted" : "Failed";
          emit("failed", key, reason);
        } else if (state.error !== "") {
          emit("failed", key, state.error);
        } else {
          emit("done", key, textOf(last?.content));
        }
        state.error = "";
        state.last = undefined;
        return;
      }
      default:
    }
  }

  #state(sessionId) {
    let state = this.sessions.get(sessionId);
    if (state === undefined) {
      state = { open: new Map(), runs: 0, error: "", last: undefined };
      this.sessions.set(sessionId, state);
    }
    return state;
  }
}

/** One SSE frame of data. */
export function sseData(frame) {
  return `data: ${JSON.stringify(frame)}\n\n`;
}

/**
 * Serve the stream on an authorized request: open approvals/questions first,
 * then `event: live`, then frames as they happen, with a heartbeat comment.
 * @param {AttentionTracker} tracker
 * @param {import("node:http").IncomingMessage} req
 * @param {import("node:http").ServerResponse} res
 * @param {{heartbeatMs?: number}} [options]
 * @returns {() => void} ends the stream
 */
export function serveEvents(tracker, req, res, options = {}) {
  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-store",
    connection: "keep-alive",
    "x-accel-buffering": "no",
  });
  req.socket.setNoDelay(true);
  req.socket.setKeepAlive(true, 30_000);
  res.write(": omp-mobile attention\n\n");
  for (const frame of tracker.pending()) res.write(sseData(frame));
  res.write("event: live\ndata: {}\n\n");
  const off = tracker.subscribe((frame) => res.write(sseData(frame)));
  const heartbeat = setInterval(() => res.write(": ping\n\n"), options.heartbeatMs ?? HEARTBEAT_MS);
  let ended = false;
  const end = () => {
    if (ended) return;
    ended = true;
    off();
    clearInterval(heartbeat);
    if (!res.writableEnded) res.end();
  };
  req.on("close", end);
  res.on("close", end);
  res.on("error", end);
  return end;
}
