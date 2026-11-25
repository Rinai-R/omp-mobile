/**
 * herdr-core, seen from the daemon: which terminals run omp, how each stands
 * (omp reports idle / working / blocked through herdr), and the few calls the
 * daemon makes into one (type a prompt, press keys, interrupt, read the screen).
 *
 * Two `hc connect` processes speak herdr's JSON-RPC lines: one for calls, one
 * for `events.subscribe` (a subscription takes its connection over). Any event
 * about a terminal is answered by reading that terminal again, so the daemon
 * never depends on the shape of an event's data. A herdr that is not there, or
 * goes away, leaves the daemon offline: sessions then open the way they always
 * did, and a retry looks again later.
 */
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { createInterface } from "node:readline";

/** The protocol generation this client speaks, and the calls it needs. */
const GENERATION = 1;
const NEEDED = ["terminal.list", "terminal.get", "terminal.read", "terminal.send", "terminal.keys", "terminal.interrupt", "events.subscribe"];
const CALL_TIMEOUT_MS = 15_000;
/** `terminal.send` waits for the owner's draft (up to a minute) before typing: it gets longer. */
const SEND_TIMEOUT_MS = 90_000;
/** herdr beats every 15 s; nothing for this long means the subscription is gone. */
const SILENCE_MS = 45_000;
const RETRY_MS = [2_000, 5_000, 15_000, 30_000, 60_000];

export class HerdrError extends Error {
  constructor(kind, message) {
    super(message);
    this.name = "HerdrError";
    this.kind = kind;
  }
}

/**
 * The environment for `hc`: without the variables that would make herdr take
 * the daemon for a program in one of its terminals (the daemon may itself have
 * been started from one).
 */
function clientEnv(env) {
  const clean = { ...env };
  for (const name of ["HC_TERMINAL_ID", "HC_SCOPE", "HC_TERMINAL_SOCKET"]) delete clean[name];
  return clean;
}

/** One `hc connect`: JSON-RPC requests out, answers and notifications in. */
class Connection extends EventEmitter {
  constructor(bin, env) {
    super();
    this.nextId = 0;
    /** @type {Map<number, {resolve: (value: any) => void, reject: (error: Error) => void, timer: NodeJS.Timeout}>} */
    this.pending = new Map();
    this.closed = false;
    this.child = spawn(bin, ["connect"], { env, stdio: ["pipe", "pipe", "ignore"] });
    this.child.on("error", (error) => this.end(error));
    this.child.on("exit", () => this.end(new HerdrError("closed", "hc connect exited")));
    this.child.stdin.on("error", () => undefined);
    createInterface({ input: this.child.stdout, crlfDelay: Infinity }).on("line", (line) => this.onLine(line));
  }

  onLine(line) {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    if (message.id !== undefined && message.id !== null) {
      const pending = this.pending.get(message.id);
      if (pending === undefined) return;
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error !== undefined) pending.reject(new HerdrError(message.error.kind ?? "error", message.error.message ?? String(message.error.kind)));
      else pending.resolve(message.result);
      return;
    }
    if (typeof message.method === "string") this.emit("notification", message.method, message.params ?? {});
  }

  call(method, params = {}, timeoutMs = CALL_TIMEOUT_MS) {
    if (this.closed) return Promise.reject(new HerdrError("closed", "herdr is not connected"));
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new HerdrError("timeout", `herdr ${method} timed out`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
  }

  end(error) {
    if (this.closed) return;
    this.closed = true;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
    try {
      this.child.kill();
    } catch {
      // Already gone.
    }
    this.emit("closed", error);
  }
}

/**
 * Whether a terminal runs omp right now: omp reports itself to herdr
 * (`status.app`) and is the terminal's foreground program. Only such a
 * terminal is ever typed into; a shell never is.
 */
export function runsOmp(terminal) {
  return terminal?.status?.app === "omp" && terminal?.foreground?.name === "omp" && Number.isInteger(terminal.foreground.pid);
}

/**
 * herdr's terminals and the calls into them. Emits `terminal` (address, the
 * terminal as read now) on every change, `gone` (address) when one ends, and
 * `online` / `offline`.
 */
export class Herdr extends EventEmitter {
  /** @param {{bin?: string, env?: NodeJS.ProcessEnv, log?: (line: string) => void}} [options] */
  constructor(options = {}) {
    super();
    this.bin = options.bin ?? "hc";
    this.env = clientEnv(options.env ?? process.env);
    this.log = options.log ?? (() => undefined);
    this.online = false;
    /** @type {Map<string, any>} */
    this.terminals = new Map();
    this.stopped = false;
    this.failures = 0;
    /** @type {Connection | undefined} */
    this.control = undefined;
    /** @type {Connection | undefined} */
    this.events = undefined;
    this.retry = undefined;
    this.silence = undefined;
  }

  /** Connect and subscribe. Resolves either way: `online` says how it went. */
  async start() {
    if (this.stopped) return;
    try {
      const control = new Connection(this.bin, this.env);
      this.control = control;
      const hello = await control.call("hello", { generation: GENERATION });
      const methods = Array.isArray(hello?.methods) ? hello.methods : [];
      const missing = NEEDED.filter((method) => !methods.includes(method));
      if (hello?.generation !== GENERATION || missing.length > 0) {
        throw new HerdrError("unsupported", `herdr speaks generation ${hello?.generation}${missing.length > 0 ? `, without ${missing.join(", ")}` : ""}`);
      }
      const events = new Connection(this.bin, this.env);
      this.events = events;
      await events.call("hello", { generation: GENERATION });
      const snapshot = await events.call("events.subscribe", {});
      this.terminals = new Map((snapshot?.terminals ?? []).map((terminal) => [terminal.address, terminal]));
      // `terminal.list` leaves out a terminal's foreground; one `get` each fills it in.
      await Promise.all([...this.terminals.keys()].map((address) => this.refresh(address)));
      events.on("notification", (method, params) => this.onNotification(method, params));
      const lost = () => this.drop();
      events.on("closed", lost);
      control.on("closed", lost);
      this.armSilence();
      this.online = true;
      this.failures = 0;
      this.emit("online");
    } catch (error) {
      this.log(`herdr: not available (${error instanceof Error ? error.message : String(error)}); sessions open without it`);
      this.drop();
    }
  }

  onNotification(method, params) {
    this.armSilence();
    if (method !== "event") return;
    const address = typeof params.terminal === "string" ? params.terminal : undefined;
    if (address === undefined) return;
    if (params.type === "removed") {
      this.forget(address);
      return;
    }
    void this.refresh(address);
  }

  /** Read one terminal again; one that is gone is forgotten. */
  async refresh(address) {
    let terminal;
    try {
      terminal = await this.control.call("terminal.get", { terminal: address });
    } catch (error) {
      if (error instanceof HerdrError && error.kind !== "timeout" && error.kind !== "closed") this.forget(address);
      return undefined;
    }
    if (terminal?.state !== undefined && terminal.state !== "live") {
      this.forget(address);
      return undefined;
    }
    this.terminals.set(address, terminal);
    this.emit("terminal", address, terminal);
    return terminal;
  }

  forget(address) {
    if (!this.terminals.delete(address)) return;
    this.emit("gone", address);
  }

  armSilence() {
    clearTimeout(this.silence);
    this.silence = setTimeout(() => this.drop(), SILENCE_MS);
    this.silence.unref?.();
  }

  /** Lost (or never had) herdr: offline now, every terminal gone, another try later. */
  drop() {
    clearTimeout(this.silence);
    const wasOnline = this.online;
    this.online = false;
    this.control?.end(new HerdrError("closed", "herdr went away"));
    this.events?.end(new HerdrError("closed", "herdr went away"));
    this.control = undefined;
    this.events = undefined;
    for (const address of [...this.terminals.keys()]) this.forget(address);
    if (wasOnline) this.emit("offline");
    if (this.stopped || this.retry !== undefined) return;
    const wait = RETRY_MS[Math.min(this.failures, RETRY_MS.length - 1)];
    this.failures += 1;
    this.retry = setTimeout(() => {
      this.retry = undefined;
      void this.start();
    }, wait);
    this.retry.unref?.();
  }

  /** The herdr terminal whose omp is process `pid`; undefined when there is none (or herdr is offline). */
  ompTerminal(pid) {
    if (!this.online) return undefined;
    for (const terminal of this.terminals.values()) {
      if (runsOmp(terminal) && terminal.foreground.pid === pid) return terminal;
    }
    return undefined;
  }

  terminal(address) {
    return this.terminals.get(address);
  }

  call(method, params, timeoutMs) {
    if (!this.online || this.control === undefined) return Promise.reject(new HerdrError("offline", "herdr is not connected"));
    return this.control.call(method, params, timeoutMs);
  }

  /** Paste `text` and press Enter, once the owner's draft is sent or cleared (herdr waits for it). */
  send(address, text) {
    return this.call("terminal.send", { terminal: address, text }, SEND_TIMEOUT_MS);
  }

  keys(address, keys) {
    return this.call("terminal.keys", { terminal: address, keys });
  }

  interrupt(address) {
    return this.call("terminal.interrupt", { terminal: address });
  }

  /** The screen as text (no history: a dialog is on the screen). */
  async screen(address) {
    const read = await this.call("terminal.read", { terminal: address, lines: 0 });
    return typeof read?.text === "string" ? read.text : "";
  }

  close() {
    this.stopped = true;
    clearTimeout(this.retry);
    this.retry = undefined;
    this.drop();
  }
}
