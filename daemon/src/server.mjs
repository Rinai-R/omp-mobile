#!/usr/bin/env node
/**
 * omp-mobile daemon.
 *
 * One process on the computer owns OMP RPC sessions and serves them to the
 * native app over HTTP + WebSocket. It binds a Tailscale address (or loopback
 * for development) and requires a per-computer bearer token, so nothing needs
 * to be exposed to the public internet.
 */
import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { homedir, hostname, platform } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import { RpcSession } from "./rpc-session.mjs";

const VERSION = "0.1.0";
const PROTOCOL = 1;
const DEFAULT_PORT = 7390;
const DEFAULT_TOKEN_FILE = join(homedir(), ".omp-mobile", "token");
const DEFAULT_REGISTRY_FILE = join(homedir(), ".omp-mobile", "sessions.json");
const MAX_BODY = 256 * 1024;

/** @typedef {{id: string, title: string, cwd: string, status: string, model?: string, createdAt: number, updatedAt: number, sessionFile?: string}} SessionSummary */

function parseArgs(argv) {
  const options = {
    host: "127.0.0.1",
    port: DEFAULT_PORT,
    cwd: process.cwd(),
    omp: "omp",
    tokenFile: DEFAULT_TOKEN_FILE,
    registryFile: DEFAULT_REGISTRY_FILE,
    token: "",
    sessionDir: "",
    autoApprove: true,
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
      case "--session-dir":
        options.sessionDir = resolve(value);
        i += 1;
        break;
      case "--no-auto-approve":
        options.autoApprove = false;
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

Usage: node src/server.mjs [options]

  --host <address>       Bind address (default 127.0.0.1; use the Tailscale IP for a phone)
  --port <port>          Port (default ${DEFAULT_PORT})
  --cwd <dir>            Default working directory for new sessions
  --omp <path>           omp executable (default "omp")
  --session-dir <dir>    OMP session directory for sessions this daemon creates
  --token <token>        Fixed bearer token (otherwise generated and stored)
  --token-file <path>    Token file (default ~/.omp-mobile/token)
  --registry-file <path> Session registry (default ~/.omp-mobile/sessions.json)
  --no-auto-approve      Do not pass --auto-approve to omp (approval requests may block)
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

function textOfContent(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object" && typeof part.text === "string") return part.text;
        return "";
      })
      .join("");
  }
  return "";
}

function titleOf(messages, state, cwd) {
  if (typeof state?.sessionName === "string" && state.sessionName.trim() !== "") {
    return state.sessionName.trim();
  }
  if (Array.isArray(messages)) {
    const user = messages.find((message) => message?.role === "user");
    const text = textOfContent(user?.content).trim().replace(/\s+/g, " ");
    if (text !== "") return text.slice(0, 80);
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
      if (event.type === "turn_end" || event.type === "agent_end") void this.refreshState();
      this.broadcast({ type: "event", event });
    });
    this.rpc.on("approval", (request) => {
      this.broadcast({ type: "approval", request });
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

  close() {
    this.closed = true;
    this.rpc.close();
    for (const client of this.clients) client.close(1001, "session closed");
  }
}

class Daemon {
  constructor(options, token) {
    this.options = options;
    this.token = token;
    /** @type {Map<string, SessionEntry>} */
    this.sessions = new Map();
    /** @type {Map<string, object>} */
    this.registry = loadRegistry(options.registryFile);
    this.server = createServer((req, res) => void this.handleHttp(req, res));
    this.wsServer = new WebSocketServer({ noServer: true });
    this.server.on("upgrade", (req, socket, head) => this.handleUpgrade(req, socket, head));
  }

  baseUrl() {
    return `http://${this.options.host}:${this.options.port}`;
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
      });
      return;
    }
    if (!tokenMatches(authOf(req, url), this.token)) {
      sendJson(res, 401, { error: "unauthorized" });
      return;
    }
    try {
      if (url.pathname === "/sessions" && req.method === "GET") {
        const live = [...this.sessions.values()].map((entry) => entry.summary());
        const liveIds = new Set(live.map((session) => session.id));
        const dormant = [...this.registry.values()]
          .filter((stored) => !liveIds.has(stored.id))
          .map((stored) => storedSummary(stored));
        sendJson(res, 200, { sessions: [...live, ...dormant] });
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
          this.sessions.get(id)?.close();
          this.sessions.delete(id);
          this.registry.delete(id);
          saveRegistry(this.options.registryFile, this.registry);
          sendJson(res, 200, { ok: true });
          return;
        }
      }
      sendJson(res, 404, { error: "not found" });
    } catch (error) {
      sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
    }
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

  /** Resume a session this daemon created earlier, once, on demand. */
  async ensureLive(id) {
    const live = this.sessions.get(id);
    if (live !== undefined) return live;
    const stored = this.registry.get(id);
    if (stored === undefined || typeof stored.sessionFile !== "string") throw new Error("unknown session");
    if (!existsSync(stored.sessionFile)) throw new Error("session file is gone");
    const rpc = new RpcSession({
      cwd: stored.cwd,
      ompBin: this.options.omp,
      sessionDir: this.options.sessionDir || undefined,
      resume: stored.sessionFile,
      autoApprove: this.options.autoApprove,
    });
    await rpc.start();
    const entry = new SessionEntry(stored.cwd, rpc);
    await entry.hydrate();
    entry.id = id;
    entry.onChange = (changed) => this.remember(changed);
    entry.bind();
    this.sessions.set(id, entry);
    this.remember(entry);
    return entry;
  }

  async createSession(cwd) {
    const rpc = new RpcSession({
      cwd,
      ompBin: this.options.omp,
      sessionDir: this.options.sessionDir || undefined,
      autoApprove: this.options.autoApprove,
    });
    await rpc.start();
    const entry = new SessionEntry(cwd, rpc);
    await entry.hydrate();
    if (entry.id === "") {
      rpc.close();
      throw new Error("omp returned no session id");
    }
    entry.onChange = (changed) => this.remember(changed);
    entry.bind();
    this.sessions.set(entry.id, entry);
    this.remember(entry);
    return entry;
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
    void this.ensureLive(decodeURIComponent(match[1]))
      .then((entry) => {
        this.wsServer.handleUpgrade(req, socket, head, (ws) => {
          entry.clients.add(ws);
          ws.send(JSON.stringify({ type: "snapshot", ...entry.snapshot() }));
          ws.on("message", (data) => void this.handleClientMessage(entry, ws, data.toString()));
          ws.on("close", () => entry.clients.delete(ws));
          ws.on("error", () => entry.clients.delete(ws));
        });
      })
      .catch((error) => {
        socket.write(`HTTP/1.1 404 Not Found\r\n\r\n`);
        socket.destroy();
        this.log?.(error);
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
          if (typeof message.text !== "string" || message.text.trim() === "") throw new Error("empty prompt");
          await entry.rpc.prompt(message.text);
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
        default:
          throw new Error(`unknown command ${String(message.type)}`);
      }
    } catch (error) {
      ws.send(JSON.stringify({ type: "error", error: error instanceof Error ? error.message : String(error) }));
    }
  }

  listen() {
    return new Promise((resolveListen) => {
      this.server.listen(this.options.port, this.options.host, () => resolveListen());
    });
  }

  async close() {
    for (const entry of this.sessions.values()) entry.close();
    this.sessions.clear();
    this.wsServer.close();
    await new Promise((resolveClose) => this.server.close(() => resolveClose()));
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const token = loadToken(options);
  const daemon = new Daemon(options, token);
  await daemon.listen();
  const url = daemon.baseUrl();
  const pair = `omp-mobile://pair?url=${encodeURIComponent(url)}&token=${encodeURIComponent(token)}`;
  console.log(`omp-mobile daemon ${VERSION}`);
  console.log(`  listening  ${url}`);
  console.log(`  cwd        ${options.cwd}`);
  console.log(`  token      ${token}`);
  console.log(`  pair       ${pair}`);
  const shutdown = async () => {
    await daemon.close();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}

const isMain = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

export { Daemon, SessionEntry, VERSION, PROTOCOL, parseArgs };
