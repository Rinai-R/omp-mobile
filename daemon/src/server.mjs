#!/usr/bin/env node
/**
 * omp-mobile daemon.
 *
 * One process on the computer owns OMP RPC sessions and serves them to the
 * native app over HTTP + WebSocket. It binds a Tailscale address (or loopback
 * for development) and requires a per-computer bearer token, so nothing needs
 * to be exposed to the public internet.
 */
import { STATUS_CODES, createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { homedir, hostname, platform } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import { renderQr } from "./qr.mjs";
import { RpcSession } from "./rpc-session.mjs";
import { Admission, Tailscale, isLoopbackHost } from "./admission.mjs";
import { AttentionTracker, serveEvents } from "./attention.mjs";
import { listOmpSessions, oneLine, promptTitle, sessionOwners } from "./omp-sessions.mjs";
import { askOwnerToLeave, forksOf, isOmpCommand, processInfo, sessionBusy, takeoverFarewell, tellTerminal } from "./takeover.mjs";
import { TranscriptStore, deltaBody, deltaQuery } from "./transcripts.mjs";

const { version: VERSION } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const PROTOCOL = 1;
const DEFAULT_PORT = 7390;
const DEFAULT_TOKEN_FILE = join(homedir(), ".omp-mobile", "token");
const DEFAULT_REGISTRY_FILE = join(homedir(), ".omp-mobile", "sessions.json");
const DEFAULT_STATE_FILE = join(homedir(), ".omp-mobile", "daemon.json");
const DEFAULT_OMP_HOME = join(homedir(), ".omp");
const MAX_BODY = 256 * 1024;
/** Terminal sessions listed next to the daemon's own, newest first. */
const OMP_SESSION_LIMIT = 50;
/**
 * Session events after which `get_state` differs from what the phone holds:
 * the model or thinking level changed, or the todo/queue/goal panels moved.
 */
const STATE_EVENTS = new Set([
  "model_changed",
  "thinking_level_changed",
  "queue_update",
  "todo_reminder",
  "todo_auto_clear",
  "goal_updated",
]);
/**
 * How long OMP's session directory and owner locks are reused for, in ms.
 * The phone probes every 15 s; without this every probe would rescan every
 * session file (hundreds, often a gigabyte) and spawn `lsof` again.
 */
const SESSION_SCAN_TTL_MS = 3_000;
const OWNERS_TTL_MS = 1_500;
/** WebSocket keepalive: a protocol ping plus a `ping` frame, and a dead peer after one missed beat. */
const HEARTBEAT_MS = 20_000;
/** A live omp nobody has looked at for this long is closed; the next open resumes it. */
const IDLE_SESSION_MS = 30 * 60_000;
const REAP_INTERVAL_MS = 60_000;
/** Messages a live session keeps in memory; older ones leave its front (its `base` counts them). */
const MAX_LIVE_MESSAGES = 5_000;
/** Events that are a session being used: a turn and what it streams. State and setting echoes are not. */
const ACTIVITY_EVENT = /^(agent_|turn_|message_|tool_execution_|auto_compaction_|auto_retry_)/;
/**
 * The fields of a tool result's `details` the app reads: an edit's diff, a
 * read's line count, a command's run time, a screenshot's file. The rest
 * (an edit's old and new text, a read's display copy) repeats what the
 * result already says, and was a fifth of a long session's snapshot.
 */
const PHONE_DETAILS = ["diff", "totalLines", "wallTimeMs", "mediaPath"];
/** Inline images shorter than this (base64 characters) stay inline: a reference would save nothing. */
const STASH_MIN_CHARS = 4_096;
/** Stashed images untouched this long are dropped at start; the session file still has them. */
const BLOB_CACHE_MAX_AGE_MS = 30 * 24 * 60 * 60_000;
/** Image types a phone may attach to a prompt: what the camera and the photo picker produce. */
const PROMPT_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
/** At most this many images per prompt, each at most this many decoded bytes. */
const MAX_PROMPT_IMAGES = 8;
const MAX_PROMPT_IMAGE_BYTES = 10 * 1024 * 1024;

/**
 * The images of a `prompt` frame as OMP's `ImageContent`, checked: base64 that
 * round-trips, a known image type, bounded count and size. Anything else is
 * refused whole rather than sent half.
 * @param {unknown} value
 * @returns {{type: "image", data: string, mimeType: string}[]}
 */
export function promptImages(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new Error("images must be a list");
  if (value.length > MAX_PROMPT_IMAGES) throw new Error(`at most ${MAX_PROMPT_IMAGES} images per message`);
  return value.map((image, index) => {
    const data = image?.data;
    const mimeType = image?.mimeType;
    if (typeof mimeType !== "string" || !PROMPT_IMAGE_TYPES.has(mimeType)) throw new Error(`image ${index + 1}: unsupported type`);
    if (typeof data !== "string" || data === "") throw new Error(`image ${index + 1}: no data`);
    const bytes = Buffer.from(data, "base64");
    if (bytes.byteLength === 0 || bytes.toString("base64") !== data) throw new Error(`image ${index + 1}: data is not base64`);
    if (bytes.byteLength > MAX_PROMPT_IMAGE_BYTES) throw new Error(`image ${index + 1}: larger than ${MAX_PROMPT_IMAGE_BYTES / 1024 / 1024} MB`);
    return { type: "image", data, mimeType };
  });
}

/**
 * What this daemon supports beyond protocol 1, for an app to offer only what
 * the computer it talks to can do. `prompt-images`: `prompt` frames carry `images`;
 * `takeover`: `POST /sessions/:id/takeover` continues a session another omp process holds;
 * `heartbeat`: session sockets get a `ping` frame every 20 s, so the app can
 * treat a silent link as gone; `transcript-sync`: a session socket's `since`/`last`
 * ask for a delta snapshot (`from`, `total`), and `GET /sessions/:id/transcript`
 * answers the same without starting an omp.
 */
const FEATURES = ["prompt-images", "takeover", "heartbeat", "transcript-sync"];
/** Who a phone continues a session on, as the terminal it leaves is told. */
const DEFAULT_DEVICE = "OMP Mobile";
/** Close code after an `open_failed` frame: the session socket opened only to say why the session could not. */
const OPEN_FAILED_CLOSE_CODE = 4000;
/** OMP's content-addressed image store under `<omp home>/agent/blobs`. */
const BLOB_NAME = /^[0-9a-f]{64}$/;

/** @typedef {{pid: number, busy: boolean, terminal: boolean}} SessionOwner */
/** @typedef {{id: string, title: string, cwd: string, status: string, model?: string, createdAt: number, updatedAt: number, sessionFile?: string, origin: "daemon" | "omp", openElsewhere?: boolean, owner?: SessionOwner, waiting?: number}} SessionSummary */

/** An error with the HTTP status it answers, and any detail its JSON answer carries. */
function httpError(status, message, detail = {}) {
  return Object.assign(new Error(message), { status, detail });
}

/** The JSON answer for a failed request: the reason and the error's detail (a 409's `owner`). */
function errorBody(error) {
  const detail = error !== null && typeof error === "object" && typeof error.detail === "object" ? error.detail : {};
  return { error: error instanceof Error ? error.message : String(error), ...detail };
}

function parseArgs(argv) {
  const options = {
    host: "127.0.0.1",
    port: DEFAULT_PORT,
    cwd: process.cwd(),
    omp: "omp",
    tokenFile: DEFAULT_TOKEN_FILE,
    registryFile: DEFAULT_REGISTRY_FILE,
    stateFile: DEFAULT_STATE_FILE,
    token: "",
    sessionDir: "",
    ompHome: DEFAULT_OMP_HOME,
    autoApprove: false,
    approvalMode: "",
    tailscale: "tailscale",
    whois: true,
    qr: true,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[i + 1];
    switch (flag) {
      case "--host":
        options.host = value;
        i += 1;
        break;
      case "--port":
        options.port = Number(value);
        i += 1;
        break;
      case "--cwd":
        options.cwd = resolve(value);
        i += 1;
        break;
      case "--omp":
        options.omp = value;
        i += 1;
        break;
      case "--token":
        options.token = value;
        i += 1;
        break;
      case "--token-file":
        options.tokenFile = resolve(value);
        i += 1;
        break;
      case "--registry-file":
        options.registryFile = resolve(value);
        i += 1;
        break;
      case "--state-file":
        options.stateFile = resolve(value);
        i += 1;
        break;
      case "--session-dir":
        options.sessionDir = resolve(value);
        i += 1;
        break;
      case "--omp-home":
        options.ompHome = resolve(value);
        i += 1;
        break;
      case "--tailscale":
        options.tailscale = value;
        i += 1;
        break;
      case "--no-whois":
        options.whois = false;
        break;
      case "--auto-approve":
        options.autoApprove = true;
        break;
      case "--approval-mode":
        options.approvalMode = value;
        i += 1;
        break;
      case "--no-qr":
        options.qr = false;
        break;
      case "--help":
      case "-h":
        printHelp();
        process.exit(0);
      default:
        if (flag.startsWith("--")) {
          console.error(`unknown flag: ${flag}`);
          process.exit(2);
        }
    }
  }
  return options;
}

function printHelp() {
  console.log(`omp-mobile daemon ${VERSION}

Usage: omp-mobile [options]

  --host <address>       Bind address (default 127.0.0.1). \`tailscale\`: this computer's Tailscale IPv4
  --cwd <dir>            Default working directory for new sessions
  --omp <path>           omp executable (default "omp")
  --session-dir <dir>    OMP session directory for sessions this daemon creates
  --omp-home <dir>       OMP home whose terminal sessions are listed (default ~/.omp)
  --token <token>        Fixed bearer token (otherwise generated and stored)
  --token-file <path>    Token file (default ~/.omp-mobile/token)
  --registry-file <path> Session registry (default ~/.omp-mobile/sessions.json)
  --state-file <path>    Where the running daemon records its pid and pairing link (default ~/.omp-mobile/daemon.json)
  --auto-approve         Pass --auto-approve to omp (no tool approvals reach the phone)
  --approval-mode <m>    Pass --approval-mode to omp (always-ask, always-ask-cached, write, yolo)
  --tailscale <path>     tailscale CLI used for admission (default "tailscale")
  --no-whois             Skip the whois user check (the Host check and token still apply)

Admission: on a non-loopback --host every request and WebSocket upgrade must name
this node in Host (421 otherwise) and come from a tailnet device of this node's
user (403 otherwise), before the token is checked. Loopback hosts skip admission.
  --no-qr                Do not print the pairing QR code at startup
`);
}

function loadToken(options) {
  if (options.token) return options.token;
  const envToken = process.env.OMP_MOBILE_TOKEN;
  if (envToken) return envToken;
  try {
    const token = readFileSync(options.tokenFile, "utf8").trim();
    if (token.length >= 16) return token;
  } catch {
    // Generate below.
  }
  const token = randomBytes(24).toString("hex");
  mkdirSync(dirname(options.tokenFile), { recursive: true, mode: 0o700 });
  writeFileSync(options.tokenFile, `${token}\n`, { mode: 0o600 });
  return token;
}

function loadRegistry(path) {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return new Map();
    return new Map(Object.entries(parsed));
  } catch {
    return new Map();
  }
}

function saveRegistry(path, registry) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, `${JSON.stringify(Object.fromEntries(registry), null, 2)}\n`, { mode: 0o600 });
}

/**
 * The directory an omp starts in, recreated when it has been removed (a
 * session in /tmp outlives its directory). Answers a 410 the phone can show
 * when it cannot be recreated (a parent that is a file, no permission).
 * @param {string} cwd
 * @returns {string}
 */
export function ensureWorkingDirectory(cwd) {
  try {
    if (statSync(cwd).isDirectory()) return cwd;
  } catch {
    // Missing: recreate it below.
  }
  try {
    mkdirSync(cwd, { recursive: true });
    return cwd;
  } catch {
    throw httpError(410, `the session's working directory is gone and cannot be recreated: ${cwd}`);
  }
}

/**
 * Write an inline image to the daemon's blob cache under its SHA-256 and
 * answer the `blob:sha256:` reference the app loads from `/blobs`; undefined
 * leaves the image inline (too small, already a reference, not base64, no disk).
 * @param {{data?: unknown}} part
 * @param {string} blobDir
 */
function stashImage(part, blobDir) {
  const data = part.data;
  if (typeof data !== "string" || data.length < STASH_MIN_CHARS || data.startsWith("blob:") || data.startsWith("data:")) return undefined;
  const bytes = Buffer.from(data, "base64");
  if (bytes.length === 0) return undefined;
  const hash = createHash("sha256").update(bytes).digest("hex");
  const path = join(blobDir, hash);
  try {
    if (!existsSync(path)) {
      mkdirSync(blobDir, { recursive: true, mode: 0o700 });
      writeFileSync(path, bytes, { mode: 0o600 });
    }
  } catch {
    return undefined;
  }
  return `blob:sha256:${hash}`;
}

/**
 * A message as a snapshot carries it to the phone: inline images moved to
 * the blob cache and sent as references (the app loads only the ones it
 * shows), and tool details cut to {@link PHONE_DETAILS}. A long session's
 * snapshot was mostly base64 screenshots and copies of edited text --
 * megabytes the phone downloaded, parsed and cached before it showed anything.
 * Live events still carry messages whole.
 * @param {any} message
 * @param {string | undefined} blobDir no stashing when undefined
 */
export function phoneMessage(message, blobDir) {
  if (message === null || typeof message !== "object") return message;
  let next = message;
  if (blobDir !== undefined && Array.isArray(message.content)) {
    let changed = false;
    const content = message.content.map((part) => {
      const ref = part !== null && typeof part === "object" && part.type === "image" ? stashImage(part, blobDir) : undefined;
      if (ref === undefined) return part;
      changed = true;
      return { ...part, data: ref };
    });
    if (changed) next = { ...next, content };
  }
  const tool = message.role === "toolResult" || message.role === "tool";
  if (tool && message.details !== null && typeof message.details === "object" && !Array.isArray(message.details)) {
    const details = {};
    for (const key of PHONE_DETAILS) if (key in message.details) details[key] = message.details[key];
    next = { ...next, details };
  }
  return next;
}

/** Drop stashed images older than {@link BLOB_CACHE_MAX_AGE_MS}; the next open of their session stashes them again. */
export function pruneBlobCache(blobDir, now = Date.now()) {
  let names;
  try {
    names = readdirSync(blobDir);
  } catch {
    return 0;
  }
  let dropped = 0;
  for (const name of names) {
    if (!BLOB_NAME.test(name)) continue;
    const path = join(blobDir, name);
    try {
      if (now - statSync(path).mtimeMs > BLOB_CACHE_MAX_AGE_MS) {
        unlinkSync(path);
        dropped += 1;
      }
    } catch {
      // Gone already.
    }
  }
  return dropped;
}

/**
 * When the messages were last written: the newest timestamp OMP stamped on
 * them, or undefined when none carries one.
 * @param {readonly any[]} messages
 */
export function lastActivity(messages) {
  let latest;
  for (let i = messages.length - 1; i >= 0 && i >= messages.length - 50; i -= 1) {
    const at = Number(messages[i]?.timestamp);
    if (Number.isFinite(at) && at > 0 && (latest === undefined || at > latest)) latest = at;
  }
  return latest;
}

/**
 * When a session the daemon knows but has no omp for was last used: what the
 * registry says, or its file's time when something wrote the file since --
 * unless the file is exactly as this daemon's own omp left it on exit (omp
 * rewrites the whole file as it closes; that is not anyone using it).
 * @param {{updatedAt?: number, closedFile?: {mtimeMs: number, size: number}} | undefined} stored
 * @param {{updatedAt: number, size?: number} | undefined} scanned
 */
export function dormantActivity(stored, scanned) {
  const known = Number(stored?.updatedAt) || 0;
  if (scanned === undefined || !(scanned.updatedAt > known)) return known;
  const closed = stored?.closedFile;
  if (closed !== undefined && closed !== null && closed.mtimeMs === scanned.updatedAt && closed.size === scanned.size) return known;
  return scanned.updatedAt;
}

/** A file's time and size, as `TranscriptStore` checks them; undefined when it cannot be read. */
function fileState(path) {
  try {
    const info = statSync(path);
    return info.isFile() ? { mtimeMs: info.mtimeMs, size: info.size } : undefined;
  } catch {
    return undefined;
  }
}

function storedSummary(stored) {
  return {
    id: stored.id,
    title: stored.title,
    cwd: stored.cwd,
    status: "idle",
    model: stored.model,
    createdAt: stored.createdAt,
    updatedAt: stored.updatedAt,
    sessionFile: stored.sessionFile,
    origin: "daemon",
  };
}

function tokenMatches(actual, expected) {
  if (typeof actual !== "string" || actual.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i += 1) diff |= actual.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

function authOf(req, url) {
  const header = req.headers.authorization;
  if (typeof header === "string" && header.startsWith("Bearer ")) return header.slice(7);
  return url.searchParams.get("token") ?? "";
}

function sendJson(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(data),
    "cache-control": "no-store",
  });
  res.end(data);
}

/** What a stored blob is, from its first bytes: OMP keeps the extension off the hash name. */
export function blobType(bytes) {
  if (bytes.length >= 4 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") {
    return "image/webp";
  }
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return "image/png";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 4 && bytes.toString("ascii", 0, 4) === "GIF8") return "image/gif";
  return "application/octet-stream";
}

/** A stored image: `GET /blobs/<sha256>[.ext]`, authenticated like every other route. */
function sendBlob(res, dirs, name) {
  if (!BLOB_NAME.test(name)) {
    sendJson(res, 400, { error: "bad blob name" });
    return;
  }
  // OMP's own store first, then the images this daemon stashed from snapshots.
  const path = dirs.map((dir) => join(dir, name)).find((candidate) => existsSync(candidate) && statSync(candidate).isFile());
  if (path === undefined) {
    sendJson(res, 404, { error: "no such blob" });
    return;
  }
  const bytes = readFileSync(path);
  res.writeHead(200, {
    "content-type": blobType(bytes),
    "content-length": bytes.length,
    "cache-control": "private, max-age=31536000, immutable",
  });
  res.end(bytes);
}

function readBody(req) {
  return new Promise((resolveBody, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new Error("request body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (chunks.length === 0) {
        resolveBody({});
        return;
      }
      try {
        resolveBody(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(new Error("invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

export function titleOf(messages, state, cwd) {
  // OMP's session names can start with a Nerd Font icon, as its stored titles do (see `oneLine`).
  const named = typeof state?.sessionName === "string" ? oneLine(state.sessionName) : "";
  if (named !== "") return named;
  if (Array.isArray(messages)) {
    const title = promptTitle(messages.find((message) => message?.role === "user")?.content);
    if (title !== "") return title;
  }
  return cwd.split("/").filter(Boolean).at(-1) ?? "session";
}

function modelOf(state) {
  const model = state?.model;
  if (model === undefined || model === null) return undefined;
  return typeof model.name === "string" ? model.name : typeof model.id === "string" ? model.id : undefined;
}

class SessionEntry {
  /**
   * @param {string} cwd
   * @param {RpcSession} rpc
   */
  constructor(cwd, rpc) {
    this.cwd = cwd;
    this.rpc = rpc;
    this.id = "";
    this.state = null;
    this.messages = [];
    /** How many messages left the front of `messages` (the cap): `messages[0]` is the transcript's message `base`. */
    this.base = 0;
    /** The session file as this omp left it on exit, so its rewrite is not taken for activity. */
    this.closedFile = undefined;
    this.createdAt = Date.now();
    this.updatedAt = this.createdAt;
    this.title = cwd.split("/").filter(Boolean).at(-1) ?? "session";
    /** @type {Set<import("ws").WebSocket>} */
    this.clients = new Set();
    /** @type {((entry: SessionEntry) => void) | undefined} */
    this.onChange = undefined;
    /**
     * Hears every payload broadcast, whether or not a client is connected (the attention stream).
     * @type {((entry: SessionEntry, payload: object) => void) | undefined}
     */
    this.onBroadcast = undefined;
    this.closed = false;
    /** When the last phone left; undefined while one is connected. The reaper reads it. */
    this.idleSince = undefined;
    /** Where inline images go (see `phoneMessage`); undefined keeps them inline. */
    this.blobDir = undefined;
    /**
     * Hears the omp process exit, once its session file is final (the daemon saves the transcript).
     * @type {((entry: SessionEntry) => void) | undefined}
     */
    this.onClosed = undefined;
  }

  /**
   * @param {number} [knownActivity] when the session was last used, as the daemon knew it before this omp
   */
  async hydrate(knownActivity) {
    const [state, messages] = await Promise.all([this.rpc.getState(), this.rpc.getMessages()]);
    this.state = state;
    this.messages = Array.isArray(messages.messages) ? messages.messages.map((message) => phoneMessage(message, this.blobDir)) : [];
    this.base = 0;
    this.id = state.sessionId ?? "";
    this.title = titleOf(this.messages, state, this.cwd);
    // Opening a session is not using it: it is as recent as its last message (a new one: now).
    const known = Math.max(lastActivity(this.messages) ?? 0, Number(knownActivity) || 0);
    this.updatedAt = known > 0 ? known : Date.now();
    return this;
  }

  summary() {
    return {
      id: this.id,
      title: this.title,
      cwd: this.cwd,
      status: this.state?.isStreaming === true ? "streaming" : "idle",
      model: modelOf(this.state),
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      sessionFile: this.state?.sessionFile,
      origin: "daemon",
      // OMP questions and tool approvals still waiting for an answer: the session needs the user.
      waiting: this.openRequests().length,
    };
  }

  /**
   * What a phone is sent on open: everything, or only the messages after the
   * ones it holds when its copy lines up (see `deltaBody`).
   * @param {{since: number, last: string}} [held]
   */
  snapshot(held) {
    return deltaBody({ session: this.summary(), state: this.state, messages: this.messages, base: this.base }, held);
  }

  broadcast(payload) {
    this.onBroadcast?.(this, payload);
    const text = JSON.stringify(payload);
    for (const client of this.clients) {
      if (client.readyState === 1) client.send(text);
    }
  }

  async refreshState() {
    try {
      this.state = await this.rpc.getState();
      this.broadcast({ type: "state", state: this.state });
    } catch {
      // The process may be exiting; the close event tells clients.
    }
  }

  bind() {
    this.rpc.on("event", (event) => {
      if (typeof event?.type === "string" && ACTIVITY_EVENT.test(event.type)) this.updatedAt = Date.now();
      if (event.type === "message_end" && event.message) {
        this.messages.push(phoneMessage(event.message, this.blobDir));
        if (this.messages.length > MAX_LIVE_MESSAGES) {
          // Indices stay the transcript's: a phone's `since` still lines up after the front is dropped.
          const dropped = this.messages.length - MAX_LIVE_MESSAGES;
          this.messages.splice(0, dropped);
          this.base += dropped;
        }
        // The first prompt names a session that was created untitled.
        const title = titleOf(this.messages, this.state, this.cwd);
        if (title !== this.title) {
          this.title = title;
          this.onChange?.(this);
        }
      }
      if (STATE_EVENTS.has(event.type)) void this.refreshState();
      // A `todo` tool call rewrites the list before any reminder fires.
      if (event.type === "tool_execution_end" && event.toolName === "todo") void this.refreshState();
      if (event.type === "turn_end" || event.type === "agent_end") void this.refreshState();
      this.broadcast({ type: "event", event });
    });
    this.rpc.on("approval", (request) => {
      this.broadcast({ type: "approval", request });
    });
    // Answered by any client, or closed by OMP itself: every client drops its dialog.
    this.rpc.on("approval-resolved", ({ id, reason }) => {
      this.broadcast({ type: "approval_resolved", id, reason });
    });
    this.rpc.on("notice", (notice) => {
      this.broadcast({ type: "notice", ...notice });
    });
    this.rpc.on("closed", ({ reason, stderr }) => {
      this.closed = true;
      this.broadcast({ type: "closed", reason, stderr: stderr.slice(-2_000) });
      try {
        this.onClosed?.(this);
      } catch {
        // Saving the transcript is a shortcut; the session file has everything.
      }
    });
    this.rpc.on("protocol-error", (payload) => this.broadcast({ type: "protocol-error", ...payload }));
  }

  /** Extension requests still waiting for an answer, oldest first. */
  openRequests() {
    return this.rpc.extensionRequests instanceof Map ? [...this.rpc.extensionRequests.values()] : [];
  }

  /** Disconnect the phones and stop omp gracefully (see `RpcSession.close`). */
  close() {
    this.closed = true;
    for (const client of this.clients) client.close(1001, "session closed");
    return this.rpc.close();
  }
}

class Daemon {
  /**
   * @param {object} options
   * @param {string} token
   * @param {{admission?: {check(req: import("node:http").IncomingMessage): Promise<{ok: boolean, status?: number, error?: string}>}, user?: string}} [identity]
   *   Listener admission (absent: none) and this node's login name for /hello.
   */
  constructor(options, token, identity = {}) {
    this.options = options;
    this.token = token;
    /**
     * Where failures nothing else reports go: the daemon's output is `~/.omp-mobile/daemon.log`.
     * @type {(error: unknown) => void}
     */
    this.log = options.log ?? ((error) => console.error(`${new Date().toISOString()} ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`));
    this.admission = identity.admission;
    this.user = identity.user ?? "";
    this.startedAt = Date.now();
    /** The last authenticated request from a client (not `/mobile`'s own probe), for `/mobile` to see a phone connect. */
    /** @type {{address: string, at: number} | null} */
    this.lastPhone = null;
    /** @type {Map<string, SessionEntry>} */
    this.sessions = new Map();
    /** @type {Map<string, object>} */
    this.registry = loadRegistry(options.registryFile);
    this.attention = new AttentionTracker({ machine: hostname() });
    /** @type {Set<() => void>} open `/events` streams, ended on close */
    this.streams = new Set();
    /** OMP's own sessions as last listed, for resuming one the app picked. @type {Map<string, import("./omp-sessions.mjs").OmpSession>} */
    this.ompSessions = new Map();
    /** The last full scan of OMP's session directory, reused within `SESSION_SCAN_TTL_MS`. */
    this.sessionScan = { at: 0, list: /** @type {import("./omp-sessions.mjs").OmpSession[]} */ ([]), pending: undefined };
    /** The last `lsof` of the owner locks, pending or settled, reused within `OWNERS_TTL_MS`. */
    this.ownerLookup = { at: 0, owners: /** @type {Promise<Map<string, number> | undefined> | undefined} */ (undefined) };
    /** @type {ReturnType<typeof setInterval> | undefined} */
    this.heartbeat = undefined;
    /** @type {ReturnType<typeof setInterval> | undefined} */
    this.reaper = undefined;
    /** Resumes in flight, so two opens of one session start one process. @type {Map<string, Promise<SessionEntry>>} */
    this.starting = new Map();
    /** Takeovers in flight, so two phones asking at once ask the owner once. @type {Map<string, Promise<object>>} */
    this.takingOver = new Map();
    /** Images stashed out of snapshots, served by `/blobs` next to OMP's own store. */
    this.blobDir = options.blobDir ?? join(dirname(options.registryFile ?? DEFAULT_REGISTRY_FILE), "blobs");
    /** Transcripts of sessions whose omp exited, served by `/transcript` without starting one. */
    this.transcripts = new TranscriptStore(options.transcriptDir ?? join(dirname(options.registryFile ?? DEFAULT_REGISTRY_FILE), "transcripts"));
    this.server = createServer((req, res) => void this.admitHttp(req, res));
    // Compressed frames: a snapshot is JSON text, several times smaller deflated, and
    // the phone's WebSocket client (OkHttp) asks for permessage-deflate on its own.
    this.wsServer = new WebSocketServer({ noServer: true, perMessageDeflate: { threshold: 1_024 } });
    this.server.on("upgrade", (req, socket, head) => void this.admitUpgrade(req, socket, head));
  }

  baseUrl() {
    return `http://${this.options.host}:${this.options.port}`;
  }

  async admitHttp(req, res) {
    if (this.admission !== undefined) {
      let verdict;
      try {
        verdict = await this.admission.check(req);
      } catch (error) {
        verdict = { ok: false, status: 403, error: `admission failed: ${error instanceof Error ? error.message : String(error)}` };
      }
      if (!verdict.ok) {
        sendJson(res, verdict.status, { error: verdict.error });
        return;
      }
    }
    await this.handleHttp(req, res);
  }

  async admitUpgrade(req, socket, head) {
    socket.on("error", () => socket.destroy());
    if (this.admission !== undefined) {
      let verdict;
      try {
        verdict = await this.admission.check(req);
      } catch (error) {
        verdict = { ok: false, status: 403, error: String(error) };
      }
      if (!verdict.ok) {
        socket.write(`HTTP/1.1 ${verdict.status} ${STATUS_CODES[verdict.status] ?? "Rejected"}\r\n\r\n`);
        socket.destroy();
        return;
      }
    }
    this.handleUpgrade(req, socket, head);
  }

  async handleHttp(req, res) {
    const url = new URL(req.url ?? "/", this.baseUrl());
    res.setHeader("access-control-allow-origin", "*");
    res.setHeader("access-control-allow-headers", "authorization, content-type");
    res.setHeader("access-control-allow-methods", "GET, POST, DELETE, OPTIONS");
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }
    if (url.pathname === "/hello") {
      sendJson(res, 200, {
        name: hostname(),
        os: platform(),
        version: VERSION,
        protocol: PROTOCOL,
        sessionCount: this.sessions.size,
        cwd: this.options.cwd,
        user: this.user || null,
        features: FEATURES,
      });
      return;
    }
    if (!tokenMatches(authOf(req, url), this.token)) {
      sendJson(res, 401, { error: "unauthorized" });
      return;
    }
    this.noteClient(req);
    const blob = /^\/blobs\/([0-9a-f]{64})(?:\.[a-z0-9]+)?$/.exec(url.pathname);
    if (blob !== null && req.method === "GET") {
      sendBlob(res, [join(this.options.ompHome, "agent", "blobs"), this.blobDir], blob[1]);
      return;
    }
    if (url.pathname === "/status" && req.method === "GET") {
      sendJson(res, 200, {
        pid: process.pid,
        version: VERSION,
        startedAt: this.startedAt,
        url: this.baseUrl(),
        liveSessions: this.sessions.size,
        eventStreams: this.streams.size,
        lastPhone: this.lastPhone,
      });
      return;
    }
    if (url.pathname === "/events" && req.method === "GET") {
      const end = serveEvents(this.attention, req, res);
      this.streams.add(end);
      res.on("close", () => this.streams.delete(end));
      return;
    }
    try {
      if (url.pathname === "/sessions" && req.method === "GET") {
        sendJson(res, 200, { sessions: await this.listSessions() });
        return;
      }
      if (url.pathname === "/sessions" && req.method === "POST") {
        const body = await readBody(req);
        const cwd = typeof body.cwd === "string" && body.cwd.trim() !== "" ? resolve(body.cwd) : this.options.cwd;
        if (!isAbsolute(cwd) || !existsSync(cwd) || !statSync(cwd).isDirectory()) {
          sendJson(res, 400, { error: "cwd is not a directory" });
          return;
        }
        const entry = await this.createSession(cwd);
        if (typeof body.prompt === "string" && body.prompt.trim() !== "") {
          await entry.rpc.prompt(body.prompt);
        }
        sendJson(res, 201, { session: entry.summary() });
        return;
      }
      const takeover = /^\/sessions\/([^/]+)\/takeover$/.exec(url.pathname);
      if (takeover !== null && req.method === "POST") {
        const body = await readBody(req);
        const device = typeof body.device === "string" && body.device.trim() !== "" ? body.device.trim().slice(0, 60) : DEFAULT_DEVICE;
        sendJson(res, 200, await this.takeOver(decodeURIComponent(takeover[1]), device));
        return;
      }
      const transcript = /^\/sessions\/([^/]+)\/transcript$/.exec(url.pathname);
      if (transcript !== null && req.method === "GET") {
        sendJson(res, 200, this.transcript(decodeURIComponent(transcript[1]), deltaQuery(url.searchParams)));
        return;
      }
      const match = /^\/sessions\/([^/]+)$/.exec(url.pathname);
      if (match !== null) {
        const id = decodeURIComponent(match[1]);
        if (req.method === "GET") {
          const live = await this.ensureLive(id);
          sendJson(res, 200, live.snapshot());
          return;
        }
        if (req.method === "DELETE") {
          const live = this.sessions.get(id);
          if (live !== undefined) {
            this.attention.forget(live);
            // Closed for good: its exit must not save it, or bring it back into the registry.
            live.onClosed = undefined;
          }
          live?.close();
          this.transcripts.remove(id);
          this.forgetOwners();
          this.sessions.delete(id);
          this.registry.delete(id);
          saveRegistry(this.options.registryFile, this.registry);
          sendJson(res, 200, { ok: true });
          return;
        }
      }
      sendJson(res, 404, { error: "not found" });
    } catch (error) {
      const status = typeof error?.status === "number" ? error.status : 500;
      // A refusal the API defines (404, 409, 410) is an answer; anything else is a failure worth keeping.
      if (status >= 500) this.log(error);
      sendJson(res, status, errorBody(error));
    }
  }

  /**
   * Live sessions, then the ones this daemon created earlier, then OMP's other
   * sessions (terminal ones), newest first. A dormant session another omp
   * process holds open is marked `openElsewhere`; opening it is refused.
   */
  async listSessions() {
    const live = [...this.sessions.values()].map((entry) => entry.summary());
    const known = new Set(live.map((session) => session.id));
    const dormant = [...this.registry.values()]
      .filter((stored) => !known.has(stored.id))
      .map((stored) => storedSummary(stored));
    for (const session of dormant) known.add(session.id);
    const [found, owners] = await Promise.all([this.scanOmpSessions(), this.owners()]);
    this.ompSessions = new Map(found.map((session) => [session.id, session]));
    const others = found
      .filter((session) => !known.has(session.id))
      .map((session) => ({ ...session, status: "idle", origin: "omp" }));
    // A dormant session is as recent as its file when a terminal omp wrote it since, not when our own omp's exit did.
    for (const session of dormant) {
      session.updatedAt = dormantActivity(this.registry.get(session.id), this.ompSessions.get(session.id));
    }
    const marked = await Promise.all(
      [...dormant, ...others].map(async (session) => {
        const pid = owners?.get(session.id);
        if (pid === undefined) return session;
        return { ...session, openElsewhere: true, owner: await this.ownerOf(pid, session.sessionFile) };
      }),
    );
    return [...live, ...marked];
  }

  /**
   * What the phone is told about the process holding a session: whether it is
   * mid-turn (by the session file's last message) and runs in a terminal.
   * @returns {Promise<SessionSummary["owner"]>}
   */
  async ownerOf(pid, sessionFile) {
    const info = await processInfo(pid);
    return { pid, busy: typeof sessionFile === "string" && sessionBusy(sessionFile), terminal: info?.tty !== undefined };
  }

  /**
   * OMP's sessions, rescanned at most every `SESSION_SCAN_TTL_MS`: a phone's
   * probes ask for the same list every few seconds, and reading the first
   * 512 KB of up to 50 of hundreds of files is the daemon's most expensive read.
   */
  scanOmpSessions() {
    const scan = this.sessionScan;
    if (Date.now() - scan.at < SESSION_SCAN_TTL_MS) return Promise.resolve(scan.list);
    if (scan.pending !== undefined) return scan.pending;
    scan.pending = listOmpSessions(join(this.options.ompHome, "agent", "sessions"), { limit: OMP_SESSION_LIMIT }).then(
      (list) => {
        this.sessionScan = { at: Date.now(), list, pending: undefined };
        return list;
      },
      (error) => {
        scan.pending = undefined;
        throw error;
      },
    );
    return scan.pending;
  }

  /** Which sessions some omp process holds open (`undefined`: cannot tell). Cached for `OWNERS_TTL_MS`. */
  owners() {
    const lookup = this.ownerLookup;
    if (lookup.owners !== undefined && Date.now() - lookup.at < OWNERS_TTL_MS) return lookup.owners;
    const owners = sessionOwners(join(this.options.ompHome, "run", "session-owners"));
    this.ownerLookup = { at: Date.now(), owners };
    return owners;
  }

  /** The owner locks changed (a takeover, an omp closing): the next look must not reuse the cache. */
  forgetOwners() {
    this.ownerLookup = { at: 0, owners: undefined };
  }

  /**
   * A session's transcript without starting an omp: a live session's from
   * memory, a closed one's from its saved copy while its session file is
   * unchanged; otherwise a 404 the phone skips.
   * @param {string} id
   * @param {{since: number, last: string}} held
   */
  transcript(id, held) {
    const live = this.sessions.get(id);
    if (live !== undefined && !live.closed) return live.snapshot(held);
    const known = this.registry.get(id)?.sessionFile ?? this.ompSessions.get(id)?.sessionFile;
    const saved = this.transcripts.read(id, typeof known === "string" ? known : undefined);
    if (saved === undefined) throw httpError(404, "not cached");
    return deltaBody(saved, held);
  }

  /** The omp of a session exited: save its transcript and when it was last active. */
  sessionClosed(entry) {
    if (entry.id === "") return;
    const sessionFile = entry.state?.sessionFile;
    entry.closedFile = typeof sessionFile === "string" ? fileState(sessionFile) : undefined;
    this.transcripts.write(entry.id, { sessionFile, messages: entry.messages, base: entry.base, state: entry.state, session: entry.summary() });
    if (this.registry.has(entry.id)) this.remember(entry);
  }

  remember(entry) {
    this.registry.set(entry.id, {
      id: entry.id,
      title: entry.title,
      cwd: entry.cwd,
      model: entry.summary().model,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
      sessionFile: entry.state?.sessionFile,
      // Set once its omp exited: the file as that omp left it (see `dormantActivity`).
      ...(entry.closedFile !== undefined ? { closedFile: entry.closedFile } : {}),
    });
    saveRegistry(this.options.registryFile, this.registry);
  }

  /**
   * The live session for `id`, resuming it on demand: one this daemon created
   * earlier, or any other OMP session it listed. Concurrent opens share one start.
   */
  ensureLive(id) {
    const live = this.sessions.get(id);
    if (live !== undefined && !live.closed) return Promise.resolve(live);
    // Its OMP process exited: resume it afresh instead of serving a dead session.
    if (live !== undefined) this.sessions.delete(id);
    let starting = this.starting.get(id);
    if (starting === undefined) {
      starting = this.resume(id).finally(() => this.starting.delete(id));
      this.starting.set(id, starting);
    }
    return starting;
  }

  async resume(id) {
    const stored = this.registry.get(id) ?? this.ompSessions.get(id);
    if (stored === undefined || typeof stored.sessionFile !== "string") throw httpError(404, "unknown session");
    if (!existsSync(stored.sessionFile)) throw httpError(410, "session file is gone");
    // A second omp on the same file would fork it into a new one; the session
    // stays with the process that has it (a terminal) until that one exits.
    // This comes before the directory check: a held session is a takeover, not
    // a broken one, and the phone's Take over button needs the 409.
    const owner = (await this.owners())?.get(id);
    if (owner !== undefined) {
      throw httpError(409, `This session is open in another omp process (pid ${owner}). Close it there to continue here.`, {
        owner: await this.ownerOf(owner, stored.sessionFile),
      });
    }
    // OMP refuses to start in a directory that no longer exists (a session in
    // /tmp whose directory was cleaned up). Recreate it here instead of letting
    // the start wait out its timeout and answer with a bare 500.
    const cwd = ensureWorkingDirectory(stored.cwd);
    const rpc = new RpcSession({
      cwd,
      ompBin: this.options.omp,
      resume: stored.sessionFile,
      autoApprove: this.options.autoApprove,
      extraArgs: this.options.approvalMode ? ["--approval-mode", this.options.approvalMode] : [],
    });
    // Until the session is registered the process is ours alone to close: left
    // running it would hold the session's owner lock, so every later open would
    // be refused as "open in another omp process" naming this very child.
    try {
      await rpc.start();
      const entry = new SessionEntry(stored.cwd, rpc);
      entry.blobDir = this.blobDir;
      await entry.hydrate(this.registry.has(id) ? dormantActivity(this.registry.get(id), this.ompSessions.get(id)) : stored.updatedAt);
      entry.id = id;
      // Idle from now for the reaper, until a phone attaches: its last activity may be long ago.
      entry.idleSince = Date.now();
      entry.onChange = (changed) => this.remember(changed);
      entry.onBroadcast = (source, payload) => this.attention.observe(source, payload);
      entry.onClosed = (closed) => this.sessionClosed(closed);
      entry.bind();
      this.sessions.set(id, entry);
      this.remember(entry);
      return entry;
    } catch (error) {
      rpc.close();
      throw error;
    }
  }

  /**
   * Continue a session another omp process holds: ask that process to leave
   * (see `takeover.mjs`), then open the session here. Concurrent takeovers of
   * one session share one attempt.
   * @param {string} id
   * @param {string} device Who continues it, as the terminal is told.
   */
  takeOver(id, device) {
    let running = this.takingOver.get(id);
    if (running === undefined) {
      running = this.runTakeover(id, device).finally(() => this.takingOver.delete(id));
      this.takingOver.set(id, running);
    }
    return running;
  }

  async runTakeover(id, device) {
    const live = this.sessions.get(id);
    if (live !== undefined && !live.closed) return { ...live.snapshot(), takeover: { pid: null, via: "live", waitedMs: 0, busy: false, forks: [] } };
    // The phone may take over a session listed before this daemon started.
    if (!this.registry.has(id) && !this.ompSessions.has(id)) await this.listSessions();
    const stored = this.registry.get(id) ?? this.ompSessions.get(id);
    if (stored === undefined || typeof stored.sessionFile !== "string") throw httpError(404, "unknown session");
    if (!existsSync(stored.sessionFile)) throw httpError(410, "session file is gone");
    const owners = await this.owners();
    if (owners === undefined) throw httpError(503, "Cannot tell which process holds this session (lsof is not available).");
    const pid = owners.get(id);
    let outcome = { pid: null, via: "free", waitedMs: 0, busy: false, forks: [] };
    if (pid !== undefined) {
      const info = await processInfo(pid);
      if (info !== undefined && !isOmpCommand(info.command)) {
        throw httpError(409, `The process holding this session (pid ${pid}) is not omp; it is left alone.`);
      }
      const busy = sessionBusy(stored.sessionFile);
      const since = Date.now();
      const left = await askOwnerToLeave({ pid, sessionId: id, sessionFile: stored.sessionFile, device, timings: this.options.takeoverTimings });
      // The kernel drops the lock with the process; give a slow exit a moment.
      const deadline = Date.now() + 3_000;
      while ((await this.owners())?.get(id) === pid && Date.now() < deadline) await new Promise((wait) => setTimeout(wait, 100));
      // Whoever looks at the terminal sees why omp closed.
      if (info?.tty !== undefined) tellTerminal(info.tty, takeoverFarewell({ device, sessionFile: stored.sessionFile }));
      const forks = forksOf(dirname(stored.sessionFile), id, since);
      if (forks.length > 0) this.log(new Error(`taking over ${id} from pid ${pid} left forked session files: ${forks.join(", ")}`));
      outcome = { pid, via: left.via, waitedMs: left.waitedMs, busy, forks };
    }
    // The owner left: the cached lock map is stale and would refuse this open.
    this.forgetOwners();
    const entry = await this.ensureLive(id);
    return { ...entry.snapshot(), takeover: outcome };
  }

  async createSession(cwd) {
    const rpc = new RpcSession({
      cwd,
      ompBin: this.options.omp,
      sessionDir: this.options.sessionDir || undefined,
      autoApprove: this.options.autoApprove,
      extraArgs: this.options.approvalMode ? ["--approval-mode", this.options.approvalMode] : [],
    });
    try {
      await rpc.start();
      const entry = new SessionEntry(cwd, rpc);
      entry.blobDir = this.blobDir;
      await entry.hydrate();
      if (entry.id === "") throw new Error("omp returned no session id");
      entry.idleSince = Date.now();
      entry.onChange = (changed) => this.remember(changed);
      entry.onBroadcast = (source, payload) => this.attention.observe(source, payload);
      entry.onClosed = (closed) => this.sessionClosed(closed);
      entry.bind();
      this.sessions.set(entry.id, entry);
      this.remember(entry);
      return entry;
    } catch (error) {
      rpc.close();
      throw error;
    }
  }

  handleUpgrade(req, socket, head) {
    const url = new URL(req.url ?? "/", this.baseUrl());
    const match = /^\/sessions\/([^/]+)\/ws$/.exec(url.pathname);
    if (match === null) {
      socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
      socket.destroy();
      return;
    }
    if (!tokenMatches(authOf(req, url), this.token)) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }
    this.noteClient(req);
    const id = decodeURIComponent(match[1]);
    // What the phone already holds, read now: the snapshot is cut against it once the session is open.
    const held = deltaQuery(url.searchParams);
    // Finish the handshake before the session is open: a slow omp can take
    // tens of seconds, and a phone's WebSocket client gives up after ~10 s --
    // then retries, starting another omp every time. The snapshot (or
    // `open_failed`) follows on the open socket instead.
    this.wsServer.handleUpgrade(req, socket, head, (ws) => {
      ws.isAlive = true;
      ws.on("pong", () => {
        ws.isAlive = true;
      });
      /** @type {SessionEntry | undefined} */
      let entry;
      /** Frames the phone sent before the session was ready. */
      const early = [];
      ws.on("message", (data) => {
        if (entry === undefined) {
          early.push(data.toString());
          return;
        }
        void this.handleClientMessage(entry, ws, data.toString());
      });
      ws.on("close", () => {
        if (entry !== undefined) this.detach(entry, ws);
      });
      ws.on("error", () => {
        if (entry !== undefined) this.detach(entry, ws);
      });
      void this.ensureLive(id).then(
        (live) => {
          entry = live;
          if (ws.readyState !== 1) return;
          live.clients.add(ws);
          live.idleSince = undefined;
          ws.send(JSON.stringify({ type: "snapshot", ...live.snapshot(held) }));
          // A dialog opened before this client connected (it may have come from a notification tap).
          for (const request of live.openRequests()) ws.send(JSON.stringify({ type: "approval", request }));
          for (const data of early) void this.handleClientMessage(live, ws, data);
          early.length = 0;
        },
        (error) => {
          const status = typeof error?.status === "number" ? error.status : 500;
          if (status >= 500) this.log(error);
          if (ws.readyState !== 1) return;
          // Say why the session cannot open and close: the app shows the reason
          // and stops retrying what a retry cannot fix.
          ws.send(JSON.stringify({ type: "open_failed", status, ...errorBody(error) }));
          ws.close(OPEN_FAILED_CLOSE_CODE, "session did not open");
        },
      );
    });
  }

  /** A phone left a session: it counts as idle from now, for the reaper. */
  detach(entry, ws) {
    if (!entry.clients.delete(ws)) return;
    if (entry.clients.size === 0) entry.idleSince = Date.now();
  }

  async handleClientMessage(entry, ws, text) {
    let message;
    try {
      message = JSON.parse(text);
    } catch {
      ws.send(JSON.stringify({ type: "error", error: "invalid JSON" }));
      return;
    }
    try {
      switch (message.type) {
        case "prompt": {
          const images = promptImages(message.images);
          const text = typeof message.text === "string" ? message.text : "";
          if (text.trim() === "" && images.length === 0) throw new Error("empty prompt");
          await entry.rpc.prompt(text, images);
          ws.send(JSON.stringify({ type: "accepted", command: "prompt" }));
          return;
        }
        case "abort":
          await entry.rpc.abort();
          ws.send(JSON.stringify({ type: "accepted", command: "abort" }));
          return;
        case "approval": {
          if (typeof message.id !== "string") throw new Error("missing approval id");
          const answer = {};
          if (typeof message.value === "string") answer.value = message.value;
          if (typeof message.confirmed === "boolean") answer.confirmed = message.confirmed;
          if (message.cancelled === true) answer.cancelled = true;
          entry.rpc.respondExtension(message.id, answer);
          ws.send(JSON.stringify({ type: "accepted", command: "approval" }));
          return;
        }
        case "refresh":
          await entry.refreshState();
          return;
        case "models": {
          const models = await entry.rpc.availableModels();
          ws.send(JSON.stringify({ type: "models", models }));
          return;
        }
        case "set_model": {
          if (typeof message.provider !== "string" || typeof message.modelId !== "string") {
            throw new Error("set_model needs provider and modelId");
          }
          const state = await entry.rpc.setModel(message.provider, message.modelId);
          entry.state = state;
          entry.updatedAt = Date.now();
          entry.onChange?.(entry);
          entry.broadcast({ type: "state", state });
          ws.send(JSON.stringify({ type: "accepted", command: "set_model" }));
          return;
        }
        case "thinking_levels": {
          const { levels } = await entry.rpc.availableThinkingLevels();
          ws.send(
            JSON.stringify({ type: "thinking_levels", levels, current: entry.state?.thinkingLevel ?? null }),
          );
          return;
        }
        case "set_thinking_level": {
          if (typeof message.level !== "string" || message.level === "") throw new Error("set_thinking_level needs a level");
          const state = await entry.rpc.setThinkingLevel(message.level);
          entry.state = state;
          entry.updatedAt = Date.now();
          entry.broadcast({ type: "state", state });
          ws.send(JSON.stringify({ type: "accepted", command: "set_thinking_level" }));
          return;
        }
        default:
          throw new Error(`unknown command ${String(message.type)}`);
      }
    } catch (error) {
      // `command` names the frame that failed, so the app can tell a refused prompt from any other error.
      ws.send(
        JSON.stringify({
          type: "error",
          command: typeof message?.type === "string" ? message.type : undefined,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  }

  /**
   * Remember an authenticated client request. `/mobile` marks its own status
   * polls with `x-omp-mobile-probe`; anything else is the app. An address cannot
   * tell them apart: an emulator's requests leave from this computer's own address.
   */
  noteClient(req) {
    if (req.headers["x-omp-mobile-probe"] !== undefined) return;
    const address = String(req.socket?.remoteAddress ?? "").replace(/^::ffff:/i, "");
    this.lastPhone = { address, at: Date.now() };
  }

  listen() {
    return new Promise((resolveListen) => {
      this.server.listen(this.options.port, this.options.host, () => {
        this.startTimers();
        resolveListen();
      });
    });
  }

  /** Keepalive pings and the idle-session reaper, once the daemon listens; old stashed images go. */
  startTimers() {
    pruneBlobCache(this.blobDir);
    this.transcripts.prune();
    this.heartbeat = setInterval(() => this.pingClients(), this.options.heartbeatMs ?? HEARTBEAT_MS);
    this.heartbeat.unref?.();
    this.reaper = setInterval(() => this.reapIdleSessions(), this.options.reapIntervalMs ?? REAP_INTERVAL_MS);
    this.reaper.unref?.();
  }

  /**
   * Ping every WebSocket and drop the ones that missed the previous beat. A
   * protocol ping plus a small frame keeps NAT and phone radios from dropping
   * an idle session silently; the app ignores the frame, older ones too.
   */
  pingClients() {
    const beat = JSON.stringify({ type: "ping", at: Date.now() });
    for (const ws of this.wsServer.clients) {
      if (ws.isAlive === false) {
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      try {
        ws.ping();
        ws.send(beat);
      } catch {
        // Closing; the close handler cleans up.
      }
    }
  }

  /** Close live sessions no phone has looked at for `IDLE_SESSION_MS` (never mid-turn). */
  reapIdleSessions() {
    const now = Date.now();
    for (const [id, entry] of this.sessions) {
      if (entry.clients.size > 0 || entry.state?.isStreaming === true) continue;
      if (now - (entry.idleSince ?? entry.updatedAt) < (this.options.idleSessionMs ?? IDLE_SESSION_MS)) continue;
      entry.close();
      this.sessions.delete(id);
    }
  }

  async close() {
    clearInterval(this.heartbeat);
    clearInterval(this.reaper);
    for (const end of this.streams) end();
    this.streams.clear();
    // Each omp saves and releases its session before the daemon exits.
    const closing = [...this.sessions.values()].map((entry) => entry.close());
    this.sessions.clear();
    const outcomes = await Promise.all(closing);
    const stuck = outcomes.filter((outcome) => outcome === "running").length;
    if (stuck > 0) console.error(`omp-mobile: ${stuck} omp process(es) ignored SIGINT and SIGTERM and are still running`);
    this.wsServer.close();
    await new Promise((resolveClose) => this.server.close(() => resolveClose()));
  }
}

function startupError(message) {
  return Object.assign(new Error(message), { startup: true });
}

/**
 * Build the listener admission from `tailscale status`.
 * Loopback skips admission; a non-loopback host without tailscale refuses to
 * start unless --no-whois.
 */
async function resolveIdentity(options) {
  const tailscale = new Tailscale({ binary: options.tailscale });
  const loopback = isLoopbackHost(options.host);
  let self;
  let failure;
  try {
    self = await tailscale.status();
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error);
  }
  const user = self?.loginName ?? "";
  if (loopback) {
    return { admission: undefined, user, notes: [`  admission  off (loopback host ${options.host}; token only)`] };
  }
  if (self === undefined && options.whois) {
    throw startupError(
      `cannot read tailscale status (${failure}); admission needs the tailscale CLI on a non-loopback host. ` +
        `Pass --tailscale <path>, bind --host 127.0.0.1, or use --no-whois to skip the user check.`,
    );
  }
  const effective = self ?? { ips: [], dnsName: "", userId: 0, loginName: "" };
  const admission = new Admission({ self: effective, bindHost: options.host, tailscale, whois: options.whois });
  const notes = [`  admission  host ∈ {${[...admission.hosts].join(", ")}}`];
  if (options.whois) notes.push(`  whois      same user only (${user || `user ${effective.userId}`})`);
  else notes.push("  WARNING    --no-whois: any device that can reach this address and holds the token is admitted");
  return { admission, user, notes };
}

/** 100.64.0.0/10 or a MagicDNS *.ts.net name: what the app accepts in a pairing code. */
function isTailnetAddress(host) {
  const octets = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (octets !== null) return octets[1] === "100" && Number(octets[2]) >= 64 && Number(octets[2]) <= 127;
  return /\.ts\.net$/i.test(host);
}

/** This computer's Tailscale IPv4 address, for `--host tailscale`. */
async function tailscaleHost(options) {
  let self;
  try {
    self = await new Tailscale({ binary: options.tailscale }).status();
  } catch (error) {
    throw startupError(`--host tailscale: cannot read tailscale status (${error instanceof Error ? error.message : String(error)})`);
  }
  const ipv4 = self.ips.find((ip) => isTailnetAddress(ip));
  if (ipv4 === undefined) throw startupError("--host tailscale: this computer has no Tailscale IPv4 address");
  return ipv4;
}

/** Record the running daemon for `/mobile` (owner-only: the pairing link carries the token). */
function writeState(path, state) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
}

/** Remove the state file if it still describes this process. */
function clearState(path) {
  try {
    if (JSON.parse(readFileSync(path, "utf8")).pid === process.pid) unlinkSync(path);
  } catch {
    // Already gone or replaced by another daemon.
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.host === "tailscale") options.host = await tailscaleHost(options);
  const token = loadToken(options);
  const identity = await resolveIdentity(options);
  const daemon = new Daemon(options, token, identity);
  await daemon.listen();
  const url = daemon.baseUrl();
  const pair = `omp-mobile://pair?url=${encodeURIComponent(url)}&token=${encodeURIComponent(token)}`;
  writeState(options.stateFile, { pid: process.pid, version: VERSION, url, pair, startedAt: daemon.startedAt });
  console.log(`omp-mobile daemon ${VERSION}`);
  console.log(`  listening  ${url}`);
  console.log(`  cwd        ${options.cwd}`);
  for (const line of identity.notes) (line.includes("WARNING") ? console.warn : console.log)(line);
  console.log(`  token      ${token}`);
  console.log(`  pair       ${pair}`);
  if (options.qr) {
    console.log("");
    console.log("  Scan with OMP on your phone (Machines > Scan to pair):");
    console.log(renderQr(pair));
    // The app accepts only tailnet addresses from a code; say so before the user tries.
    if (!isTailnetAddress(options.host)) {
      console.log(`  note: ${options.host} is not a Tailscale address, so the app will refuse this code.`);
      console.log("        Start with --host <this computer's Tailscale IP> to pair a phone.");
    }
  }
  const shutdown = async () => {
    clearState(options.stateFile);
    await daemon.close();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
  // A daemon started by /mobile has no terminal; a closed one must not stop it.
  process.on("SIGHUP", () => undefined);
}

// npm runs the `omp-mobile` bin through a symlink; compare real paths.
const isMain = process.argv[1] !== undefined && realpathSync(resolve(process.argv[1])) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((error) => {
    console.error(error?.startup === true ? `omp-mobile daemon: ${error.message}` : error);
    process.exit(1);
  });
}

export { Daemon, SessionEntry, VERSION, PROTOCOL, FEATURES, parseArgs, resolveIdentity };
