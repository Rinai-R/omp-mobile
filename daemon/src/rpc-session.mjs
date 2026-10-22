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

const START_TIMEOUT_MS = 45_000;
const REQUEST_TIMEOUT_MS = 60_000;

/** Events that carry no useful state to the phone. */
const IGNORED_UI = new Set(["setStatus", "setWidget", "setTitle", "set_editor_text", "cancel"]);

/**
 * @typedef {object} RpcSessionOptions
 * @property {string} cwd
 * @property {string} [ompBin]
 * @property {string[]} [extraArgs]
 * @property {string} [sessionDir]
 * @property {string} [resume]
 * @property {boolean} [autoApprove]
 */

export class RpcSession extends EventEmitter {
  /** @param {RpcSessionOptions} options */
  constructor(options) {
    super();
    this.cwd = options.cwd;
    this.ompBin = options.ompBin ?? "omp";
    this.extraArgs = options.extraArgs ?? [];
    this.sessionDir = options.sessionDir;
    this.resume = options.resume;
    this.autoApprove = options.autoApprove !== false;
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
  }

  /** Start the process and resolve once it printed `ready`. */
  async start() {
    const args = ["--mode", "rpc", "--cwd", this.cwd, ...this.extraArgs];
    if (this.resume) args.push("--resume", this.resume);
    if (this.autoApprove) args.push("--auto-approve");
    if (this.sessionDir) args.push("--session-dir", this.sessionDir);
    const child = spawn(this.ompBin, args, {
      cwd: this.cwd,
      env: { ...process.env, NO_COLOR: "1" },
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.child = child;
    child.on("error", (error) => this.#fail(error));
    child.on("exit", (code, signal) => {
      this.closed = true;
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
    await ready;
    this.started = true;
    return this;
  }

  /** @param {string} line */
  #onLine(line) {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      this.emit("protocol-error", { line: line.slice(0, 500) });
      return;
    }
    this.updatedAt = Date.now();
    if (message.type === "ready") {
      this.emit("ready", message);
      return;
    }
    if (message.type === "response") {
      const pending = message.id ? this.pending.get(message.id) : undefined;
      if (pending !== undefined && message.id) {
        this.pending.delete(message.id);
        if (message.success === false) pending.reject(new Error(message.error || `RPC ${message.command} failed`));
        else pending.resolve(message);
        return;
      }
      this.emit("response", message);
      return;
    }
    if (message.type === "extension_ui_request") {
      if (IGNORED_UI.has(message.method)) return;
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

  /** @returns {Promise<{messages: object[]}>} */
  async getMessages() {
    const response = await this.request("get_messages");
    return response.data ?? { messages: [] };
  }

  /** @param {string} text */
  async prompt(text) {
    return this.request("prompt", { message: text });
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
    this.extensionRequests.delete(id);
    const response = { type: "extension_ui_response", id, ...answer };
    this.child.stdin.write(`${JSON.stringify(response)}\n`);
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    for (const pending of this.pending.values()) pending.reject(new Error("omp session closed"));
    this.pending.clear();
    this.child?.kill("SIGTERM");
    setTimeout(() => {
      if (this.child !== undefined && this.child.exitCode === null) this.child.kill("SIGKILL");
    }, 2_000).unref();
  }
}

export { REQUEST_TIMEOUT_MS, START_TIMEOUT_MS };
