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

/**
 * `running`: a turn started (key `run:<n>`, the key its `done`/`failed` frame
 * will carry), sent only to streams that ask for it (`?live=1`), for the phone's
 * Live Update; older apps would show it as a banner. While the turn runs it is
 * sent again under the same key and start `time` when its step or plan changes:
 * `text` the step (the tool call's intent, else its name), `plan` the todo list's progress.
 * @typedef {"approval" | "question" | "resolved" | "done" | "failed" | "running"} AttentionKind
 */

/**
 * @typedef {object} AttentionFrame
 * @property {AttentionKind} kind
 * @property {string} key Waiting-item identity: the extension request id; `run:<n>` for running/done/failed.
 * @property {string} sessionId
 * @property {string} sessionTitle
 * @property {string} machine This computer's hostname.
 * @property {string} text Human text: the question, the final answer, or the failure.
 * @property {number} time Epoch ms.
 * @property {Plan} [plan] `running` only: the session's todo list, when it has one.
 */

/** @typedef {{done: number, total: number, phases: number[]}} Plan Tasks done (completed or dropped), all tasks, tasks per phase. */

/**
 * The progress of OMP's todo list (`get_state`'s `todoPhases`); undefined without tasks.
 * @returns {Plan | undefined}
 */
export function planOf(todoPhases) {
  if (!Array.isArray(todoPhases)) return undefined;
  const phases = [];
  let done = 0;
  for (const phase of todoPhases) {
    const tasks = Array.isArray(phase?.tasks) ? phase.tasks.filter((task) => task !== null && typeof task === "object") : [];
    if (tasks.length === 0) continue;
    phases.push(tasks.length);
    done += tasks.filter((task) => task.status === "completed" || task.status === "abandoned").length;
  }
  const total = phases.reduce((sum, count) => sum + count, 0);
  return total === 0 ? undefined : { done, total, phases };
}

const samePlan = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** @typedef {{id: string, title?: string}} SessionLike */

/** The listener sends a comment this often so phones can tell a dead link from a quiet one. */
export const HEARTBEAT_MS = 25_000;
/** OMP's tool approval is a `select` whose title starts with this. */
export const TOOL_APPROVAL_PREFIX = "Allow tool:";
/** The labels OMP starts approval details with (`Command: `, `Path: `), from its `tools/approval.ts` and each tool. */
const DETAIL_LABEL = /^(?:Command|Path|Paths|Pattern|Language|Code|Content|URL|Reason|Origin):\s*/;
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

  /**
   * Approvals and questions still waiting, across all sessions, oldest first;
   * with `live`, also each turn still running, so a reconnecting phone knows.
   * @param {{live?: boolean}} [options]
   */
  pending(options = {}) {
    const open = [];
    for (const state of this.sessions.values()) {
      open.push(...state.open.values());
      if (options.live === true && state.running !== undefined) open.push(state.running);
    }
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
    const emit = (kind, key, text, extra = {}) => {
      const frame = {
        kind,
        key,
        sessionId: session.id,
        sessionTitle: session.title ?? "",
        machine: this.machine,
        text: clip(text),
        time: this.now(),
        ...extra,
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
        // A notification reads in the phone's language, so OMP's English labels (`Command:`) are left out.
        const lines = (approval ? title.slice(TOOL_APPROVAL_PREFIX.length) : title)
          .split("\n")
          .map((line, index) => (approval && index > 0 ? line.replace(DETAIL_LABEL, "") : line).trim());
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
        if (state.running !== undefined) {
          emit("resolved", state.running.key, "closed");
          state.running = undefined;
        }
        break;
      }
      case "notice": {
        if (payload.level === "error") state.error = typeof payload.message === "string" ? payload.message : "error";
        break;
      }
      case "state": {
        const plan = planOf(payload.state?.todoPhases);
        if (samePlan(plan, state.plan)) break;
        state.plan = plan;
        if (state.running !== undefined) state.running = this.#rerun(state, emit, state.running.text);
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
        state.running = emit("running", `run:${state.runs + 1}`, "", state.plan === undefined ? {} : { plan: state.plan });
        return;
      case "tool_execution_start": {
        if (state.running === undefined) return;
        const intent = typeof event.intent === "string" ? event.intent.trim() : "";
        const step = intent !== "" ? intent : typeof event.toolName === "string" ? event.toolName : "";
        if (step !== "" && step !== state.running.text) state.running = this.#rerun(state, emit, step);
        return;
      }
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
        state.running = undefined;
        return;
      }
      default:
    }
  }

  /** The running turn again, with a new step and the current plan; its key and start stay. */
  #rerun(state, emit, step) {
    const running = state.running;
    const frame = emit("running", running.key, step, state.plan === undefined ? {} : { plan: state.plan });
    frame.time = running.time;
    return frame;
  }

  #state(sessionId) {
    let state = this.sessions.get(sessionId);
    if (state === undefined) {
      state = { open: new Map(), runs: 0, error: "", last: undefined, running: undefined, plan: undefined };
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
 * @param {{heartbeatMs?: number, live?: boolean}} [options] `live`: also send `running` frames and their resolutions (`?live=1`).
 * @returns {() => void} ends the stream
 */
export function serveEvents(tracker, req, res, options = {}) {
  const live = options.live === true;
  // A turn's frames other than done/failed exist for the Live Update; streams that did not ask never see them.
  const wanted = (frame) => live || (frame.kind !== "running" && !(frame.kind === "resolved" && frame.key.startsWith("run:")));
  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-store",
    connection: "keep-alive",
    "x-accel-buffering": "no",
  });
  req.socket.setNoDelay(true);
  req.socket.setKeepAlive(true, 30_000);
  res.write(": omp-mobile attention\n\n");
  for (const frame of tracker.pending({ live })) res.write(sseData(frame));
  res.write("event: live\ndata: {}\n\n");
  const off = tracker.subscribe((frame) => {
    if (wanted(frame)) res.write(sseData(frame));
  });
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
