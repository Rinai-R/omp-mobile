/**
 * One OMP process in RPC mode (`omp --mode rpc`).
 *
 * The daemon owns the process: commands go to stdin as JSON lines, responses
 * and session events come back on stdout. Nothing here knows the native UI;
 * `server.mjs` is the only place that decides what a phone may see.
 */
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline";
import { RpcFrameDecoder, supportsProtocolV2 } from "./rpc-frame.mjs";

const START_TIMEOUT_MS = 45_000;
/** How long omp gets to leave after `SIGINT`, and again after `SIGTERM`, when the daemon closes it. */
const CLOSE_WAIT_MS = 10_000;

/**
 * The environment without `BUN_BE_BUN`: /mobile starts the daemon under omp's
 * embedded Bun with it set, and a child omp that inherits it would run as Bun.
 */
function withoutBunFlag(env) {
  const { BUN_BE_BUN: _ignored, ...rest } = env;
  return rest;
}
const REQUEST_TIMEOUT_MS = 60_000;
/** Messages per `get_messages_page` request: OMP's maximum; a page also stays under 768 KiB. */
const MESSAGE_PAGE_LIMIT = 256;
/** OMP's `get_messages_page` codes that mean "page later or read it whole", as OMP's own client treats them. */
const PAGE_FALLBACK_CODES = new Set(["session_busy", "stale_cursor"]);
const PAGE_FALLBACK_MESSAGES = new Set([
  "Cannot page messages while the session is changing",
  "RPC message cursor is stale",
]);

/**
 * A failed RPC command: OMP's error text, and its machine-readable `code` when it sent one.
 */
export class RpcCommandError extends Error {
  /**
   * @param {string} message
   * @param {string} command
   * @param {string | undefined} code
   */
  constructor(message, command, code) {
    super(message);
    this.name = "RpcCommandError";
    this.command = command;
    this.code = code;
  }
}

/** Whether a paging failure should fall back to one whole `get_messages`. */
function pageFallback(error) {
  if (!(error instanceof Error)) return false;
  if (error instanceof RpcCommandError && error.code !== undefined && PAGE_FALLBACK_CODES.has(error.code)) return true;
  return PAGE_FALLBACK_MESSAGES.has(error.message);
}

/** Events that carry no useful state to the phone. */
const IGNORED_UI = new Set(["setStatus", "setWidget", "setTitle", "set_editor_text"]);

/**
 * @typedef {object} RpcSessionOptions
 * @property {string} cwd
 * @property {string} [ompBin]
 * @property {string[]} [extraArgs]
 * @property {string} [sessionDir]
 * @property {string} [resume]
 * @property {boolean} [autoApprove]
 */

/**
 * One entry of OMP's model catalog, cut to what a phone lists: provider, name,
 * context window and input kinds. The full object carries endpoints, cost and
 * compatibility fields the app never shows.
 * @param {Record<string, unknown>} model
 */
export function compactModel(model) {
  const thinking = model.thinking;
  const cost = model.cost;
  return {
    provider: typeof model.provider === "string" ? model.provider : "",
    id: typeof model.id === "string" ? model.id : "",
    name: typeof model.name === "string" ? model.name : typeof model.id === "string" ? model.id : "",
    reasoning: model.reasoning === true,
    input: Array.isArray(model.input) ? model.input.filter((kind) => typeof kind === "string") : [],
    contextWindow: typeof model.contextWindow === "number" ? model.contextWindow : undefined,
    cost:
      cost !== null && typeof cost === "object"
        ? {
            input: typeof cost.input === "number" ? cost.input : undefined,
            output: typeof cost.output === "number" ? cost.output : undefined,
          }
        : undefined,
    efforts:
      thinking !== null && typeof thinking === "object" && Array.isArray(thinking.efforts)
        ? thinking.efforts.filter((level) => typeof level === "string")
        : undefined,
  };
}

export class RpcSession extends EventEmitter {
  /** @param {RpcSessionOptions} options */
  constructor(options) {
    super();
    this.cwd = options.cwd;
    this.ompBin = options.ompBin ?? "omp";
    this.extraArgs = options.extraArgs ?? [];
    this.sessionDir = options.sessionDir;
    this.resume = options.resume;
    this.autoApprove = options.autoApprove === true;
    /** @type {import("node:child_process").ChildProcessWithoutNullStreams | undefined} */
    this.child = undefined;
    /** @type {Map<string, {resolve: (value: any) => void, reject: (error: Error) => void}>} */
    this.pending = new Map();
    /** @type {Map<string, object>} */
    this.extensionRequests = new Map();
    this.started = false;
    this.closed = false;
    this.startedAt = Date.now();
    this.updatedAt = Date.now();
    this.lastState = null;
    this.lastError = null;
    this.stderr = "";
    /** 1 until OMP accepts `negotiate_protocol` v2; then frames above 1 MiB arrive as chunks. */
    this.protocolVersion = 1;
    this.frames = new RpcFrameDecoder();
  }

  /** Start the process and resolve once it printed `ready`. */
  async start() {
    // rpc-ui gives tools an interactive UI: OMP's approval prompt reaches the
    // phone as an extension `select` request instead of failing closed.
    const args = ["--mode", "rpc-ui", "--cwd", this.cwd, ...this.extraArgs];
    if (this.resume) args.push("--resume", this.resume);
    if (this.autoApprove) args.push("--auto-approve");
    if (this.sessionDir) args.push("--session-dir", this.sessionDir);
    const child = spawn(this.ompBin, args, {
      cwd: this.cwd,
      env: { ...withoutBunFlag(process.env), NO_COLOR: "1" },
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.child = child;
    child.on("error", (error) => this.#fail(error));
    child.on("exit", (code, signal) => {
      this.closed = true;
      // Nothing can answer the dialogs of a process that is gone.
      for (const id of [...this.extensionRequests.keys()]) this.#settle(id, "closed");
      const reason = signal ? `signal ${signal}` : `exit ${code}`;
      this.emit("closed", { reason, stderr: this.stderr });
      this.#fail(new Error(`omp exited: ${reason}`));
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      this.stderr = `${this.stderr}${chunk}`.slice(-16_384);
    });
    const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
    const ready = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("omp RPC did not become ready")), START_TIMEOUT_MS);
      const onReady = (message) => {
        clearTimeout(timer);
        this.off("ready", onReady);
        resolve(message);
      };
      this.once("ready", onReady);
      this.once("closed", () => {
        clearTimeout(timer);
        reject(new Error(`omp exited before ready: ${this.stderr.slice(-500)}`));
      });
    });
    lines.on("line", (line) => this.#onLine(line));
    const hello = await ready;
    // v1 caps every frame at 1 MiB: a long session's messages or a large tool
    // result would come back as a transport-limit error. v2 chunks them instead.
    if (supportsProtocolV2(hello)) {
      const response = await this.request("negotiate_protocol", { protocolVersion: 2 });
      if (response.data?.protocolVersion !== 2) throw new Error("omp RPC protocol v2 negotiation failed");
      this.protocolVersion = 2;
    }
    this.started = true;
    return this;
  }

  /** @param {string} line */
  #onLine(line) {
    let message;
    try {
      message = this.frames.push(JSON.parse(line));
    } catch {
      this.emit("protocol-error", { line: line.slice(0, 500) });
      return;
    }
    // A chunk of a larger frame: the frame is handled once its last chunk arrives.
    if (message === undefined) return;
    this.updatedAt = Date.now();
    if (message.type === "ready") {
      this.emit("ready", message);
      return;
    }
    if (message.type === "response") {
      const pending = message.id ? this.pending.get(message.id) : undefined;
      if (pending !== undefined && message.id) {
        this.pending.delete(message.id);
        if (message.success === false) {
          pending.reject(new RpcCommandError(message.error || `RPC ${message.command} failed`, message.command, message.code));
        }
        else pending.resolve(message);
        return;
      }
      this.emit("response", message);
      return;
    }
    if (message.type === "extension_ui_request") {
      if (IGNORED_UI.has(message.method)) return;
      if (message.method === "cancel") {
        // OMP closed a dialog itself (timeout, abort); a later answer to it is ignored.
        if (typeof message.targetId === "string") this.#settle(message.targetId, "cancelled");
        return;
      }
      if (message.method === "notify") {
        this.emit("notice", { level: message.notifyType ?? "info", message: message.message });
        return;
      }
      if (message.method === "open_url") {
        this.emit("notice", {
          level: "info",
          message: message.instructions || message.url,
          url: message.url,
          launchUrl: message.launchUrl,
        });
        return;
      }
      this.extensionRequests.set(message.id, message);
      this.emit("approval", message);
      return;
    }
    if (message.type === "available_commands_update") {
      this.emit("commands", message.commands ?? []);
      return;
    }
    this.emit("event", message);
  }

  /**
   * Forget an open extension request and say how it ended.
   * @param {string} id
   * @param {"answered" | "cancelled" | "closed"} reason
   */
  #settle(id, reason) {
    if (!this.extensionRequests.delete(id)) return;
    this.emit("approval-resolved", { id, reason });
  }

  /** @param {Error} error */
  #fail(error) {
    this.lastError = error;
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }

  /**
   * Send one command and wait for its `response` line.
   * @param {string} type
   * @param {Record<string, unknown>} [payload]
   * @param {number} [timeoutMs]
   */
  request(type, payload = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
    if (this.closed || this.child === undefined) {
      return Promise.reject(new Error("omp session is closed"));
    }
    const id = randomUUID();
    const line = JSON.stringify({ id, type, ...payload });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`omp RPC ${type} timed out`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      this.child.stdin.write(`${line}\n`);
    });
  }

  /** @returns {Promise<object>} */
  async getState() {
    const response = await this.request("get_state");
    const data = response.data ?? {};
    // The full system prompt and tool dump are large and never shown on a phone.
    delete data.systemPrompt;
    delete data.dumpTools;
    this.lastState = data;
    return data;
  }

  /**
   * The session's messages. Under protocol v2 they are read in pages, as OMP's
   * own RPC client does: one `get_messages` answer is a single frame, which a
   * long uncompacted session outgrows. A page that cannot be read now (the
   * session is changing, or the cursor went stale) falls back to the whole list
   * in one response, which v2 may chunk.
   * @returns {Promise<{messages: object[]}>}
   */
  async getMessages() {
    // As OMP's own client: pages only once v2 is negotiated (an OMP that offers v2 pages).
    if (this.protocolVersion === 2) {
      try {
        return { messages: await this.#drainPages() };
      } catch (error) {
        if (!pageFallback(error)) throw error;
      }
    }
    const response = await this.request("get_messages");
    return response.data ?? { messages: [] };
  }

  async #drainPages() {
    const messages = [];
    const seen = new Set();
    /** @type {number | undefined} */
    let total;
    /** @type {string | undefined} */
    let cursor;
    do {
      const response = await this.request("get_messages_page", cursor === undefined ? { limit: MESSAGE_PAGE_LIMIT } : { cursor, limit: MESSAGE_PAGE_LIMIT });
      const page = response.data ?? {};
      if (!Number.isSafeInteger(page.totalMessages) || page.totalMessages < 0 || (total !== undefined && page.totalMessages !== total)) {
        throw new Error("omp message pages returned an inconsistent total");
      }
      total = page.totalMessages;
      if (Array.isArray(page.messages)) messages.push(...page.messages);
      cursor = typeof page.nextCursor === "string" && page.nextCursor !== "" ? page.nextCursor : undefined;
      if (cursor !== undefined && seen.has(cursor)) throw new Error("omp message pages repeated a cursor");
      if (cursor !== undefined) seen.add(cursor);
    } while (cursor !== undefined);
    if (messages.length !== total) throw new Error("omp message pages ended before the advertised total");
    return messages;
  }

  /**
   * The models this session can switch to, compacted for a phone list.
   * OMP waits out background discovery first, so this can take a few seconds.
   * @returns {Promise<ReturnType<typeof compactModel>[]>}
   */
  async availableModels() {
    const response = await this.request("get_available_models");
    const models = response.data?.models;
    return Array.isArray(models) ? models.map(compactModel) : [];
  }

  /**
   * Switch this session to another model. Returns the state afterwards: the
   * model's thinking efforts decide which levels the phone may offer.
   * @param {string} provider
   * @param {string} modelId
   */
  async setModel(provider, modelId) {
    await this.request("set_model", { provider, modelId });
    return this.getState();
  }

  /** @returns {Promise<{levels: string[]}>} */
  async availableThinkingLevels() {
    const response = await this.request("get_available_thinking_levels");
    const levels = response.data?.levels;
    return { levels: Array.isArray(levels) ? levels.filter((level) => typeof level === "string") : [] };
  }

  /** @param {string} level */
  async setThinkingLevel(level) {
    await this.request("set_thinking_level", { level });
    return this.getState();
  }

  /**
   * @param {string} text
   * @param {{type: "image", data: string, mimeType: string}[]} [images] OMP `ImageContent` parts sent with the text.
   */
  async prompt(text, images = []) {
    return this.request("prompt", images.length > 0 ? { message: text, images } : { message: text });
  }

  async abort() {
    return this.request("abort");
  }

  /**
   * Answer an extension UI request (select/confirm/input/editor).
   * @param {string} id
   * @param {{value?: string, confirmed?: boolean, cancelled?: boolean}} answer
   */
  respondExtension(id, answer) {
    if (this.closed || this.child === undefined) throw new Error("omp session is closed");
    if (!this.extensionRequests.has(id)) throw new Error("unknown extension request");
    const response = { type: "extension_ui_response", id, ...answer };
    this.child.stdin.write(`${JSON.stringify(response)}\n`);
    this.#settle(id, answer.cancelled === true ? "cancelled" : "answered");
  }

  /**
   * Stop the omp child the way Ctrl+C does: `SIGINT`, then `SIGTERM`, each
   * followed by a wait. OMP routes both through its teardown (the turn is
   * aborted, the session file flushed, its lock released). Never `SIGKILL`: a
   * process cut off mid-write can leave a session half saved. Resolves to how
   * it left, or `"running"` when it ignored both signals.
   * @param {{sigint?: number, sigterm?: number}} [waits] milliseconds after each signal
   * @returns {Promise<"exited" | "SIGINT" | "SIGTERM" | "running">}
   */
  close(waits = {}) {
    if (this.closing !== undefined) return this.closing;
    this.closed = true;
    for (const pending of this.pending.values()) pending.reject(new Error("omp session closed"));
    this.pending.clear();
    const child = this.child;
    this.closing = (async () => {
      if (child === undefined || child.exitCode !== null || child.signalCode !== null) return "exited";
      const exited = new Promise((resolveExit) => child.once("exit", () => resolveExit(true)));
      for (const [signal, wait] of /** @type {const} */ ([
        ["SIGINT", waits.sigint ?? CLOSE_WAIT_MS],
        ["SIGTERM", waits.sigterm ?? CLOSE_WAIT_MS],
      ])) {
        try {
          child.kill(signal);
        } catch {
          return "exited";
        }
        let timer;
        const left = await Promise.race([
          exited,
          new Promise((resolveWait) => {
            timer = setTimeout(() => resolveWait(false), wait);
          }),
        ]);
        clearTimeout(timer);
        if (left) return signal;
      }
      return "running";
    })();
    return this.closing;
  }
}

export { REQUEST_TIMEOUT_MS, START_TIMEOUT_MS, MESSAGE_PAGE_LIMIT, CLOSE_WAIT_MS };
