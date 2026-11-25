/**
 * A session whose omp runs in a herdr terminal, driven through herdr instead of
 * being taken over: the owner keeps their omp on the computer, the phone is
 * one more way into it. To the daemon it looks like an `RpcSession` (the same
 * events and calls), so `SessionEntry` and the phone protocol do not change.
 *
 * - Messages: read from the session file as omp appends them (one event per
 *   message; no word-by-word stream without the omp-mobile extension).
 * - Running or not: herdr's status for the terminal (omp reports it).
 * - Input: `terminal.send`, which waits for the owner's draft; a stop is
 *   `terminal.interrupt`.
 * - A dialog (tool approval, a question): its screen text, answered with
 *   keys, and only while that same dialog is still up.
 * Closing it only lets go: the omp keeps running in its terminal.
 */
import { createHash, randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { closeSync, openSync, readSync, statSync } from "node:fs";
import { runsOmp } from "./herdr.mjs";
import { readSessionMessages } from "./omp-sessions.mjs";

/** How often the session file is looked at for new messages. */
const TAIL_MS = 250;
/** How often the daemon checks that the terminal's omp still has this session (a `/resume` there switches it). */
const OWNER_CHECK_MS = 5_000;
/** After keys went in, when to look at the screen again: a dialog that is still up may show something new. */
const AFTER_KEYS_MS = 400;
/** Where model and thinking-level changes are looked for when the session opens. */
const SETTINGS_TAIL_BYTES = 4 * 1024 * 1024;

/** The keys a phone may press in a terminal dialog: moving, choosing, answering yes/no, leaving. */
const DIALOG_KEYS = new Set(["enter", "esc", "up", "down", "left", "right", "tab", "shift+tab", "space", "backspace", "y", "n", "1", "2", "3", "4", "5", "6", "7", "8", "9"]);

/** What the phone may do in such a session, as `state.capabilities` and the session summary say. */
export const HERDR_CAPABILITIES = Object.freeze({ stream: "message", models: false, images: false, approvals: "keys" });

const hash = (text) => createHash("sha256").update(text).digest("hex");

/**
 * The dialog on omp's screen: the last box it draws (from a line starting
 * `╭` to the next starting `╰`). omp draws its dialogs as such a box above
 * the footer, whose spinner and clock change every frame; the box changes
 * only when the dialog does (another question, another choice highlighted).
 * The whole screen when there is no box.
 * @param {string} screen
 */
export function dialogOf(screen) {
  const lines = screen.split("\n");
  for (let top = lines.length - 1; top >= 0; top -= 1) {
    if (!lines[top].trimStart().startsWith("╭")) continue;
    const bottom = lines.findIndex((line, index) => index > top && line.trimStart().startsWith("╰"));
    // An open box at the bottom is the editor still being drawn: look further up.
    if (bottom === -1 || bottom - top < 2) continue;
    return lines
      .slice(top, bottom + 1)
      .map((line) => line.replace(/\s+$/, ""))
      .join("\n");
  }
  return screen.replace(/\s+$/, "");
}

/** `provider/model-id` as OMP's model object, as far as a session file says. */
function modelFrom(value) {
  if (typeof value !== "string" || value === "") return undefined;
  const slash = value.indexOf("/");
  const id = slash === -1 ? value : value.slice(slash + 1);
  return { provider: slash === -1 ? undefined : value.slice(0, slash), id, name: id };
}

/** The last model and thinking level the session file's tail names. */
function settingsOf(file) {
  const settings = { model: undefined, thinkingLevel: undefined };
  let handle;
  try {
    handle = openSync(file, "r");
    const size = statSync(file).size;
    const start = Math.max(0, size - SETTINGS_TAIL_BYTES);
    const buffer = Buffer.alloc(size - start);
    readSync(handle, buffer, 0, buffer.length, start);
    for (const line of buffer.toString("utf8").split("\n")) applySetting(settings, line);
  } catch {
    // A file that cannot be read has no settings to show.
  } finally {
    if (handle !== undefined) closeSync(handle);
  }
  return settings;
}

function applySetting(settings, line) {
  if (!line.includes("_change")) return;
  let entry;
  try {
    entry = JSON.parse(line);
  } catch {
    return;
  }
  if (entry?.type === "model_change") settings.model = modelFrom(entry.model) ?? settings.model;
  if (entry?.type === "thinking_level_change" && typeof entry.thinkingLevel === "string") settings.thinkingLevel = entry.thinkingLevel;
}

export class HerdrSession extends EventEmitter {
  /**
   * @param {object} options
   * @param {import("./herdr.mjs").Herdr} options.herdr
   * @param {string} options.address the herdr terminal (`t7`)
   * @param {number} options.pid the omp process that holds the session
   * @param {string} options.sessionId
   * @param {string} options.sessionFile
   * @param {() => Promise<boolean | undefined>} [options.owns] whether that omp still has this session (undefined: cannot tell)
   */
  constructor(options) {
    super();
    this.via = "herdr";
    this.capabilities = HERDR_CAPABILITIES;
    this.herdr = options.herdr;
    this.address = options.address;
    this.pid = options.pid;
    this.sessionId = options.sessionId;
    this.sessionFile = options.sessionFile;
    this.owns = options.owns;
    /** Open terminal dialogs, as the phone sees them (`extensionRequests`, as an RpcSession has). */
    this.extensionRequests = new Map();
    /** Per dialog: what must still hold for its keys to go in. */
    this.dialogs = new Map();
    this.closed = false;
    this.running = false;
    this.terminal = undefined;
    this.settings = { model: undefined, thinkingLevel: undefined };
    this.offset = 0;
    this.partial = "";
    this.onTerminal = (address, terminal) => {
      if (address === this.address) this.follow(terminal);
    };
    this.onGone = (address) => {
      if (address === this.address) this.end("the herdr terminal is gone");
    };
    this.onOffline = () => this.end("herdr is not reachable any more");
  }

  async start() {
    const terminal = this.herdr.terminal(this.address);
    if (!this.isOurs(terminal)) throw new Error("that herdr terminal is not running this omp");
    this.terminal = terminal;
    this.settings = settingsOf(this.sessionFile);
    this.offset = statSync(this.sessionFile).size;
    this.herdr.on("terminal", this.onTerminal);
    this.herdr.on("gone", this.onGone);
    this.herdr.on("offline", this.onOffline);
    this.tail = setInterval(() => this.readAppended(), TAIL_MS);
    this.tail.unref?.();
    if (this.owns !== undefined) {
      this.ownerCheck = setInterval(() => void this.checkOwner(), OWNER_CHECK_MS);
      this.ownerCheck.unref?.();
    }
    this.running = terminal.status?.state === "working" || terminal.status?.state === "blocked";
    if (terminal.status?.state === "blocked") void this.openDialog(terminal);
    return this;
  }

  isOurs(terminal) {
    return runsOmp(terminal) && terminal.foreground.pid === this.pid;
  }

  /** The terminal changed: omp left it, it started or finished a run, or a dialog came or went. */
  follow(terminal) {
    if (this.closed) return;
    if (!this.isOurs(terminal)) {
      this.end("omp is no longer running in that herdr terminal");
      return;
    }
    const previous = this.terminal;
    this.terminal = terminal;
    const state = terminal.status?.state;
    if ((state === "working" || state === "blocked") && !this.running) {
      this.running = true;
      this.emit("event", { type: "agent_start" });
    }
    if (state !== "working" && state !== "blocked" && this.running) {
      // The last message may still be on its way to the file: read it first.
      this.readAppended();
      this.running = false;
      this.emit("event", { type: "agent_end", messages: [] });
    }
    if (state === "blocked") {
      if (previous?.status?.state !== "blocked" || previous?.status_ms !== terminal.status_ms) void this.openDialog(terminal);
    } else {
      this.settleDialogs("cancelled");
    }
  }

  /** Show the dialog on the screen now as one request; it replaces any earlier one. */
  async openDialog(terminal) {
    let screen;
    try {
      screen = await this.herdr.screen(this.address);
    } catch {
      return;
    }
    if (this.closed || this.terminal?.status?.state !== "blocked") return;
    const dialog = dialogOf(screen);
    const open = [...this.dialogs.values()].find((item) => item.statusMs === terminal.status_ms && item.hash === hash(dialog));
    if (open !== undefined) return;
    this.settleDialogs("cancelled");
    const id = randomUUID();
    const kind = typeof terminal.status?.kind === "string" ? terminal.status.kind : undefined;
    const request = {
      type: "extension_ui_request",
      id,
      method: "keys",
      kind,
      title: typeof terminal.status?.msg === "string" && terminal.status.msg !== "" ? terminal.status.msg : "omp is waiting in the terminal",
      screen: dialog,
      keys: ["up", "down", "enter", "esc", "tab", "y", "n"],
    };
    this.dialogs.set(id, { statusMs: terminal.status_ms, hash: hash(dialog) });
    this.extensionRequests.set(id, request);
    this.emit("approval", request);
  }

  settleDialogs(reason) {
    for (const id of [...this.extensionRequests.keys()]) {
      this.extensionRequests.delete(id);
      this.dialogs.delete(id);
      this.emit("approval-resolved", { id, reason });
    }
  }

  /** New lines omp wrote to the session file since the last look: its messages, and setting changes. */
  readAppended() {
    if (this.closed) return;
    let size;
    try {
      size = statSync(this.sessionFile).size;
    } catch {
      return;
    }
    if (size < this.offset) {
      // Rewritten shorter (compaction rewrites the file): follow it from its end.
      this.offset = size;
      this.partial = "";
      return;
    }
    if (size === this.offset) return;
    const buffer = Buffer.alloc(size - this.offset);
    let handle;
    try {
      handle = openSync(this.sessionFile, "r");
      readSync(handle, buffer, 0, buffer.length, this.offset);
    } catch {
      return;
    } finally {
      if (handle !== undefined) closeSync(handle);
    }
    this.offset = size;
    const lines = `${this.partial}${buffer.toString("utf8")}`.split("\n");
    this.partial = lines.pop() ?? "";
    for (const line of lines) {
      if (line.trim() === "") continue;
      applySetting(this.settings, line);
      let entry;
      try {
        entry = JSON.parse(line);
      } catch {
        continue;
      }
      if (entry?.type === "message" && entry.message !== null && typeof entry.message === "object") {
        const message = entry.message;
        this.emit("event", { type: "message_end", message });
        // A tool's result: its card on the phone ends, as a live omp's tool_execution_end ends it.
        if (message.role === "toolResult" && typeof message.toolCallId === "string") {
          this.emit("event", {
            type: "tool_execution_end",
            toolCallId: message.toolCallId,
            toolName: message.toolName,
            result: { content: message.content, details: message.details },
            isError: message.isError === true,
          });
        }
      }
    }
  }

  async checkOwner() {
    if (this.closed) return;
    let owns;
    try {
      owns = await this.owns();
    } catch {
      return;
    }
    if (owns === false) this.end("that terminal's omp moved to another session");
  }

  /** The terminal is still running our omp; otherwise nothing may be typed into it. */
  ensureOmp() {
    const terminal = this.herdr.terminal(this.address);
    if (this.closed || !this.isOurs(terminal)) throw new Error("that herdr terminal is not running omp any more");
    return terminal;
  }

  async getState() {
    return {
      sessionId: this.sessionId,
      sessionFile: this.sessionFile,
      isStreaming: this.running,
      model: this.settings.model,
      thinkingLevel: this.settings.thinkingLevel,
      via: this.via,
      capabilities: this.capabilities,
      herdrTerminal: this.address,
    };
  }

  async getMessages() {
    const read = await readSessionMessages(this.sessionFile);
    return { messages: read?.messages ?? [], base: read?.base ?? 0 };
  }

  /** Typed into the terminal like the owner would: herdr waits until their own draft is sent or cleared. */
  async prompt(text, images = []) {
    if (images.length > 0) throw new Error("Images need the omp-mobile extension in that terminal's omp (update omp-mobile there).");
    this.ensureOmp();
    try {
      return await this.herdr.send(this.address, text);
    } catch (error) {
      if (error?.kind === "blocked") throw new Error("omp is waiting for an answer in the terminal; answer it first.");
      throw error;
    }
  }

  async abort() {
    this.ensureOmp();
    return this.herdr.interrupt(this.address);
  }

  /**
   * Press keys in a terminal dialog. They go in only while that same dialog is
   * up (same status time, same screen), and once: keys do not wait for the
   * owner, so a dialog the owner already answered must not get them.
   * @param {string} id
   * @param {{keys?: string[], cancelled?: boolean}} answer
   */
  async respondExtension(id, answer) {
    const dialog = this.dialogs.get(id);
    if (dialog === undefined) throw new Error("unknown or already answered dialog");
    const keys = answer?.cancelled === true ? ["esc"] : Array.isArray(answer?.keys) ? answer.keys : [];
    if (keys.length === 0 || keys.length > 8 || !keys.every((key) => typeof key === "string" && DIALOG_KEYS.has(key))) {
      throw new Error("a dialog takes keys like enter, esc, up, down, y, n");
    }
    this.ensureOmp();
    const now = await this.herdr.call("terminal.get", { terminal: this.address });
    if (!this.isOurs(now) || now.status?.state !== "blocked" || now.status_ms !== dialog.statusMs) {
      throw new Error("The dialog in the terminal changed; look at it again.");
    }
    if (hash(dialogOf(await this.herdr.screen(this.address))) !== dialog.hash) throw new Error("The dialog in the terminal changed; look at it again.");
    if (!this.dialogs.delete(id)) throw new Error("unknown or already answered dialog");
    this.extensionRequests.delete(id);
    await this.herdr.keys(this.address, keys);
    this.emit("approval-resolved", { id, reason: "answered" });
    // Still asking (moved a selection, or the next question): show it again.
    const again = setTimeout(() => {
      const terminal = this.herdr.terminal(this.address);
      if (!this.closed && terminal?.status?.state === "blocked") void this.openDialog(terminal);
    }, AFTER_KEYS_MS);
    again.unref?.();
  }

  async subagents() {
    throw new Error("a herdr session lists subagents from its files");
  }

  async availableModels() {
    throw new Error("Switching models in a terminal session needs the omp-mobile extension there.");
  }

  async setModel() {
    throw new Error("Switching models in a terminal session needs the omp-mobile extension there.");
  }

  async availableThinkingLevels() {
    return { levels: [] };
  }

  async setThinkingLevel() {
    throw new Error("Changing the thinking level in a terminal session needs the omp-mobile extension there.");
  }

  detach() {
    clearInterval(this.tail);
    clearInterval(this.ownerCheck);
    this.herdr.off("terminal", this.onTerminal);
    this.herdr.off("gone", this.onGone);
    this.herdr.off("offline", this.onOffline);
  }

  /** The session cannot go on through herdr: phones are told, and reopening finds out what holds it now. */
  end(reason) {
    if (this.closed) return;
    this.closed = true;
    this.detach();
    this.settleDialogs("closed");
    this.emit("closed", { reason, stderr: "" });
  }

  /** Let go of the terminal; its omp keeps running. */
  async close() {
    if (!this.closed) {
      this.closed = true;
      this.detach();
      this.settleDialogs("closed");
    }
    return "detached";
  }
}
