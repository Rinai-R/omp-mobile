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
import { existsSync, mkdirSync, readFileSync, realpathSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { homedir, hostname, platform } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import { renderQr } from "./qr.mjs";
import { RpcSession } from "./rpc-session.mjs";
import { Admission, Tailscale, isLoopbackHost } from "./admission.mjs";
import { AttentionTracker, serveEvents } from "./attention.mjs";
import { listOmpSessions, promptTitle, sessionOwners } from "./omp-sessions.mjs";

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

/** Close code after an `open_failed` frame: the session socket opened only to say why the session could not. */
const OPEN_FAILED_CLOSE_CODE = 4000;
/** OMP's content-addressed image store under `<omp home>/agent/blobs`. */
const BLOB_NAME = /^[0-9a-f]{64}$/;

/** @typedef {{id: string, title: string, cwd: string, status: string, model?: string, createdAt: number, updatedAt: number, sessionFile?: string, origin: "daemon" | "omp", openElsewhere?: boolean}} SessionSummary */

/** An error with the HTTP status it answers. */
function httpError(status, message) {
  return Object.assign(new Error(message), { status });
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
function sendBlob(res, ompHome, name) {
  if (!BLOB_NAME.test(name)) {
    sendJson(res, 400, { error: "bad blob name" });
    return;
  }
  const path = join(ompHome, "agent", "blobs", name);
  if (!existsSync(path) || !statSync(path).isFile()) {
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

function titleOf(messages, state, cwd) {
  if (typeof state?.sessionName === "string" && state.sessionName.trim() !== "") {
    return state.sessionName.trim();
  }
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
  }

  async hydrate() {
    const [state, messages] = await Promise.all([this.rpc.getState(), this.rpc.getMessages()]);
    this.state = state;
    this.messages = Array.isArray(messages.messages) ? messages.messages : [];
    this.id = state.sessionId ?? "";
    this.title = titleOf(this.messages, state, this.cwd);
    this.updatedAt = Date.now();
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
    };
  }

  snapshot() {
    return {
      session: this.summary(),
      state: this.state,
      messages: this.messages,
    };
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
      this.updatedAt = Date.now();
      this.broadcast({ type: "state", state: this.state });
    } catch {
      // The process may be exiting; the close event tells clients.
    }
  }

  bind() {
    this.rpc.on("event", (event) => {
      this.updatedAt = Date.now();
      if (event.type === "message_end" && event.message) {
        this.messages.push(event.message);
        if (this.messages.length > 5_000) this.messages.splice(0, this.messages.length - 5_000);
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
    });
    this.rpc.on("protocol-error", (payload) => this.broadcast({ type: "protocol-error", ...payload }));
  }

  /** Extension requests still waiting for an answer, oldest first. */
  openRequests() {
    return this.rpc.extensionRequests instanceof Map ? [...this.rpc.extensionRequests.values()] : [];
  }

  close() {
    this.closed = true;
    this.rpc.close();
    for (const client of this.clients) client.close(1001, "session closed");
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
    /** Resumes in flight, so two opens of one session start one process. @type {Map<string, Promise<SessionEntry>>} */
    this.starting = new Map();
    this.server = createServer((req, res) => void this.admitHttp(req, res));
    this.wsServer = new WebSocketServer({ noServer: true });
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
      sendBlob(res, this.options.ompHome, blob[1]);
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
          if (live !== undefined) this.attention.forget(live);
          live?.close();
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
      sendJson(res, status, { error: error instanceof Error ? error.message : String(error) });
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
    const [found, owners] = await Promise.all([
      listOmpSessions(join(this.options.ompHome, "agent", "sessions"), { limit: OMP_SESSION_LIMIT }),
      this.owners(),
    ]);
    this.ompSessions = new Map(found.map((session) => [session.id, session]));
    const others = found
      .filter((session) => !known.has(session.id))
      .map((session) => ({ ...session, status: "idle", origin: "omp" }));
    const marked = [...dormant, ...others].map((session) =>
      owners?.has(session.id) === true ? { ...session, openElsewhere: true } : session,
    );
    return [...live, ...marked];
  }

  /** Which sessions some omp process holds open (`undefined`: cannot tell). */
  owners() {
    return sessionOwners(join(this.options.ompHome, "run", "session-owners"));
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
    const owner = (await this.owners())?.get(id);
    if (owner !== undefined) {
      throw httpError(409, `This session is open in another omp process (pid ${owner}). Close it there to continue here.`);
    }
    const rpc = new RpcSession({
      cwd: stored.cwd,
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
      await entry.hydrate();
      entry.id = id;
      entry.onChange = (changed) => this.remember(changed);
      entry.onBroadcast = (source, payload) => this.attention.observe(source, payload);
      entry.bind();
      this.sessions.set(id, entry);
      this.remember(entry);
      return entry;
    } catch (error) {
      rpc.close();
      throw error;
    }
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
      await entry.hydrate();
      if (entry.id === "") throw new Error("omp returned no session id");
      entry.onChange = (changed) => this.remember(changed);
      entry.onBroadcast = (source, payload) => this.attention.observe(source, payload);
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
    void this.ensureLive(decodeURIComponent(match[1]))
      .then((entry) => {
        this.wsServer.handleUpgrade(req, socket, head, (ws) => {
          entry.clients.add(ws);
          ws.send(JSON.stringify({ type: "snapshot", ...entry.snapshot() }));
          // A dialog opened before this client connected (it may have come from a notification tap).
          for (const request of entry.openRequests()) ws.send(JSON.stringify({ type: "approval", request }));
          ws.on("message", (data) => void this.handleClientMessage(entry, ws, data.toString()));
          ws.on("close", () => entry.clients.delete(ws));
          ws.on("error", () => entry.clients.delete(ws));
        });
      })
      .catch((error) => {
        const status = typeof error?.status === "number" ? error.status : 500;
        if (status >= 500) this.log(error);
        // A browser-style client only sees that the upgrade failed, never why. Finish
        // the handshake instead, say why the session cannot open, and close: the app
        // shows the reason and stops retrying what a retry cannot fix.
        this.wsServer.handleUpgrade(req, socket, head, (ws) => {
          ws.send(JSON.stringify({ type: "open_failed", status, error: error instanceof Error ? error.message : String(error) }));
          ws.close(OPEN_FAILED_CLOSE_CODE, "session did not open");
        });
      });
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
      ws.send(JSON.stringify({ type: "error", error: error instanceof Error ? error.message : String(error) }));
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
      this.server.listen(this.options.port, this.options.host, () => resolveListen());
    });
  }

  async close() {
    for (const end of this.streams) end();
    this.streams.clear();
    for (const entry of this.sessions.values()) entry.close();
    this.sessions.clear();
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

export { Daemon, SessionEntry, VERSION, PROTOCOL, parseArgs, resolveIdentity };
