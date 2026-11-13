/**
 * The daemon as a DSH Remote Host: it registers with a relay server (by
 * default the public https://dsh.r2049.cn of ds-harness-remote) through
 * account-less device pairing, and serves its own HTTP + WebSocket API to
 * paired phones through that relay, end-to-end encrypted (Noise IK, pinned
 * keys). The relay only forwards ciphertext; nothing of DSH runs here.
 *
 * Over the encrypted channel the phone speaks a small tunnel (`createTunnelRouter`):
 *   rpc `omp.http.open` {id, method, path, headers?, body? (text)} -> {status, headers}
 *   rpc `omp.ws.open`   {id, path}                            -> {}
 *   rpc `omp.ws.send`   {id, text}                            -> {}
 *   rpc `omp.close`     {id}                                  -> {}
 *   event `omp.data`    {id, text? (a text body or WebSocket message part), data? (base64 of a binary body),
 *                        more? (the WebSocket message continues), done?, error?}
 * Requests go to the daemon's loopback tunnel listener with its token added,
 * so a paired phone gets exactly what a phone on the tailnet gets.
 */
import { request as httpRequest } from "node:http";
import { StringDecoder } from "node:string_decoder";
import { WebSocket } from "ws";
import {
  ConnectionController,
  HostPairing,
  HostServerApi,
  HostServerConnection,
  IdentityStore,
  SafeLogger,
  ServerCredentialStore,
  createEvent,
  createRpcError,
  createRpcResponse,
} from "../vendor/dsh-remote-host.mjs";

/** Marks a request that came through the relay tunnel (set by the tunnel, never by the phone). */
export const RELAY_HEADER = "x-omp-mobile-relay";
/** Characters per text part and bytes per base64 part (a multiple of 3): well under the 4 MiB secure message cap. */
const TEXT_CHUNK_CHARS = 1024 * 1024;
const BINARY_PART_BYTES = 3 * 256 * 1024;
/** A binary answer (an image) is sent whole: at most this large. */
const MAX_BINARY_BODY = 32 * 1024 * 1024;
const MAX_HANDLES = 64;
const MAX_REQUEST_BODY = 16 * 1024 * 1024;
const ID = /^[A-Za-z0-9_-]{1,64}$/;
const METHODS = new Set(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"]);
/** Headers the phone may pass on; the token and the relay mark are the tunnel's own. */
const PASSED_HEADERS = new Set(["accept", "content-type", "x-omp-mobile-probe"]);

class TunnelError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/** A daemon path the phone may ask for: absolute, no scheme or host, and never the local `/relay` control. */
function tunnelPath(value) {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || value.length > 8192 || /[\s\\]/.test(value)) {
    throw new TunnelError("INVALID_MESSAGE", "Invalid path.");
  }
  const url = new URL(value, "http://tunnel");
  if (url.pathname === "/relay" || url.pathname.startsWith("/relay/")) throw new TunnelError("METHOD_NOT_ALLOWED", "Relay control is local only.");
  return url;
}

/**
 * One phone connection's tunnel to the daemon at 127.0.0.1:`port`.
 * @param {{port: number, token: string}} target
 * @param {(message: object) => Promise<void>} send Encrypted delivery to that phone.
 */
export function createTunnelRouter(target, send) {
  /** @type {Map<string, {close(): void, socket?: WebSocket}>} */
  const handles = new Map();
  let out = Promise.resolve();
  /** Events go out in order; a failed send (the phone left) ends the handle. */
  const emit = (data) => {
    out = out.then(() => send(createEvent("omp.data", data))).catch(() => handles.get(data.id)?.close());
    return out;
  };
  const claim = (id) => {
    if (typeof id !== "string" || !ID.test(id)) throw new TunnelError("INVALID_MESSAGE", "Invalid handle id.");
    if (handles.has(id)) throw new TunnelError("REQUEST_CONFLICT", "Handle already open.");
    if (handles.size >= MAX_HANDLES) throw new TunnelError("RATE_LIMITED", "Too many open requests.");
  };

  const openHttp = (params) => {
    claim(params.id);
    const { id } = params;
    const method = typeof params.method === "string" ? params.method.toUpperCase() : "GET";
    if (!METHODS.has(method)) throw new TunnelError("INVALID_MESSAGE", "Invalid method.");
    const url = tunnelPath(params.path);
    const headers = { authorization: `Bearer ${target.token}`, [RELAY_HEADER]: "1" };
    for (const [key, value] of Object.entries(params.headers ?? {})) {
      if (PASSED_HEADERS.has(key.toLowerCase()) && typeof value === "string") headers[key.toLowerCase()] = value;
    }
    const body = typeof params.body === "string" ? Buffer.from(params.body, "utf8") : undefined;
    if (body !== undefined && body.length > MAX_REQUEST_BODY) throw new TunnelError("FRAME_TOO_LARGE", "Request body too large.");
    if (body !== undefined) headers["content-length"] = String(body.length);
    return new Promise((resolveOpen, rejectOpen) => {
      let settled = false;
      const request = httpRequest({ host: "127.0.0.1", port: target.port, method, path: `${url.pathname}${url.search}`, headers, agent: false }, (response) => {
        settled = true;
        const type = String(response.headers["content-type"] ?? "");
        resolveOpen({ status: response.statusCode ?? 502, headers: { "content-type": type } });
        let ended = false;
        // Text (JSON, the `/events` stream) goes as text, whole characters only; anything
        // else (an image from `/blobs`) is collected and sent as base64 in 3-byte-aligned parts,
        // so the phone can join the parts without decoding them.
        const text = /^(text\/|application\/json)/.test(type) ? new StringDecoder("utf8") : undefined;
        const bytes = [];
        let total = 0;
        response.on("data", (chunk) => {
          if (text === undefined) {
            total += chunk.length;
            if (total > MAX_BINARY_BODY) request.destroy();
            else bytes.push(chunk);
            return;
          }
          const part = text.write(chunk);
          if (part === "") return;
          response.pause();
          let sent = Promise.resolve();
          for (let at = 0; at < part.length; at += TEXT_CHUNK_CHARS) sent = emit({ id, text: part.slice(at, at + TEXT_CHUNK_CHARS) });
          void sent.then(() => response.resume());
        });
        response.on("end", () => {
          ended = true;
          handles.delete(id);
          const rest = text?.end() ?? "";
          if (rest !== "") void emit({ id, text: rest });
          const all = Buffer.concat(bytes);
          for (let at = 0; at < all.length; at += BINARY_PART_BYTES) void emit({ id, data: all.subarray(at, at + BINARY_PART_BYTES).toString("base64") });
          void emit({ id, done: true });
        });
        response.on("close", () => {
          if (ended || !handles.has(id)) return;
          handles.delete(id);
          void emit({ id, done: true, error: "closed" });
        });
      });
      handles.set(id, { close: () => { handles.delete(id); request.destroy(); } });
      request.on("error", () => {
        handles.delete(id);
        if (!settled) rejectOpen(new TunnelError("HARNESS_UNAVAILABLE", "The daemon did not answer."));
      });
      request.end(body);
    });
  };

  const openWs = (params) => {
    claim(params.id);
    const { id } = params;
    const url = tunnelPath(params.path);
    url.searchParams.set("token", target.token);
    return new Promise((resolveOpen, rejectOpen) => {
      const socket = new WebSocket(`ws://127.0.0.1:${target.port}${url.pathname}${url.search}`, {
        headers: { [RELAY_HEADER]: "1" },
        perMessageDeflate: false,
        maxPayload: 256 * 1024 * 1024,
      });
      let opened = false;
      handles.set(id, { socket, close: () => { handles.delete(id); socket.terminate(); } });
      socket.on("open", () => {
        opened = true;
        resolveOpen({});
      });
      socket.on("message", (data, binary) => {
        if (binary) return;
        const text = data.toString("utf8");
        socket.pause();
        let sent = Promise.resolve();
        const parts = Math.max(1, Math.ceil(text.length / TEXT_CHUNK_CHARS));
        for (let index = 0; index < parts; index += 1) {
          sent = emit({ id, text: text.slice(index * TEXT_CHUNK_CHARS, (index + 1) * TEXT_CHUNK_CHARS), more: index < parts - 1 });
        }
        void sent.then(() => socket.resume());
      });
      socket.on("close", (code) => {
        const known = handles.delete(id);
        if (!opened) rejectOpen(new TunnelError("HARNESS_UNAVAILABLE", `The daemon refused the socket (${code}).`));
        else if (known) void emit({ id, done: true, code });
      });
      socket.on("error", () => undefined);
    });
  };

  const call = async (method, params) => {
    if (params === null || typeof params !== "object") throw new TunnelError("INVALID_MESSAGE", "Missing parameters.");
    switch (method) {
      case "omp.http.open":
        return openHttp(params);
      case "omp.ws.open":
        return openWs(params);
      case "omp.ws.send": {
        const socket = handles.get(params.id)?.socket;
        if (socket === undefined || typeof params.text !== "string") throw new TunnelError("CONNECTION_NOT_FOUND", "No such socket.");
        await new Promise((resolveSend, rejectSend) => socket.send(params.text, (error) => (error ? rejectSend(new TunnelError("CONNECTION_FAILED", "Socket closed.")) : resolveSend())));
        return {};
      }
      case "omp.close":
        handles.get(params.id)?.close();
        return {};
      default:
        throw new TunnelError("METHOD_NOT_FOUND", `Unknown method ${String(method)}.`);
    }
  };

  return {
    async handle(message) {
      if (message.type !== "rpc.request") return createRpcError(message.id, "INVALID_MESSAGE", "Only RPC requests are accepted.");
      const { method, params } = message.payload ?? {};
      try {
        return createRpcResponse(message.id, await call(method, params));
      } catch (error) {
        const code = error instanceof TunnelError ? error.code : "HARNESS_UNAVAILABLE";
        return createRpcError(message.id, code, error instanceof Error ? error.message : String(error));
      }
    },
    closePeerStreams() {
      for (const handle of [...handles.values()]) handle.close();
    },
  };
}

/**
 * This daemon's Host identity, pairing and relay connection on one server.
 * State (identity key, device tokens, pinned phones, a pairing in progress)
 * lives in `dir`, owner-only.
 */
export class RelayHost {
  /**
   * @param {{serverUrl: string, dir: string, name: string, version: string, port: () => number, token: string, log: (line: string) => void}} options
   */
  constructor(options) {
    this.options = options;
    this.serverUrl = options.serverUrl.replace(/\/+$/, "");
    this.pairing = undefined;
    this.connection = undefined;
  }

  async start() {
    const { dir, name, log } = this.options;
    this.identities = new IdentityStore({ directory: dir });
    this.identity = await this.identities.loadOrCreate(name);
    this.api = new HostServerApi(this.serverUrl, new ServerCredentialStore(this.identities.directory));
    this.api.bindIdentity(this.identity);
    const write = (level) => (line) => log(`relay ${level}: ${line}`);
    this.logger = new SafeLogger({ debug() {}, info: write("info"), warn: write("warn"), error: write("error") });
    this.connections = new ConnectionController(
      this.identities,
      (_context, send) => createTunnelRouter({ port: this.options.port(), token: this.options.token }, send),
      this.logger,
    );
    if (await this.api.hasStoredAuthorization()) this.connect();
  }

  /** Go (back) online with the device tokens a pairing left. */
  connect() {
    if (this.connection !== undefined) {
      this.connection.reconnect();
      return;
    }
    const config = {
      serverUrl: this.serverUrl,
      // No WebRTC on the computer: phone traffic always goes through the relay, still end-to-end encrypted.
      forceRelay: true,
      rotatePinnedPeerKey: false,
      reconnect: { enabled: true, initialDelayMs: 2_000, maxDelayMs: 30_000, jitter: 0.2 },
    };
    this.connection = new HostServerConnection(config, this.identity, this.identities, this.api, this.connections, this.logger);
    this.connection.start();
  }

  /** The pairing workflow; its state survives restarts in `dir`. */
  hostPairing() {
    this.pairing ??= new HostPairing(
      this.serverUrl,
      this.identities.directory,
      this.identity,
      {
        deviceId: this.identity.deviceId,
        name: this.identity.name,
        role: "host",
        platform: process.platform,
        identityKey: this.identity.publicKey,
        clientVersion: `omp-mobile/${this.options.version}`,
      },
      async (credentials) => {
        await this.api.adoptPairing(credentials);
        this.connect();
      },
    );
    return this.pairing;
  }

  /** Start a pairing: the view carries `qrPayload`, the link the phone scans. */
  async pairStart() {
    // A finished pairing is left on disk, and asking the server about it again can fail
    // (MEMBERSHIP_REQUIRED once its phone was revoked): drop it; an open one `start` cancels itself.
    const previous = await this.hostPairing()
      .status()
      .catch(() => undefined);
    if (previous === undefined || !["created", "claimed", "approved"].includes(previous.state)) {
      await this.pairing.discard();
      this.pairing = undefined;
    }
    return this.hostPairing().start();
  }

  /** Where the pairing stands (a phone claimed it: `mobile` names it); undefined when none. */
  pairStatus() {
    return this.hostPairing().status();
  }

  /** Approve the phone with the 8-digit code it shows. One attempt: a wrong code ends the pairing. */
  pairConfirm(sessionId, code) {
    return this.hostPairing().confirm(sessionId, code);
  }

  pairCancel(sessionId) {
    return this.hostPairing().cancel(sessionId);
  }

  /** Paired phones, as the server lists them, and whether each is connected now. */
  async phones() {
    if (!(await this.api.hasStoredAuthorization())) return [];
    const connected = new Set(this.connections.peerDeviceIds());
    // `/devices` is for client devices; a host lists its phones through its memberships.
    const { accessToken } = await this.api.authenticate();
    const response = await fetch(`${this.serverUrl}/api/v1/device-memberships?limit=100`, { headers: { authorization: `Bearer ${accessToken}` } });
    if (!response.ok) throw new Error(`The relay refused the phone list (HTTP ${response.status}).`);
    const { items } = await response.json();
    return (Array.isArray(items) ? items : []).map(({ peer }) => ({
      deviceId: peer.deviceId,
      name: peer.name,
      platform: peer.platform,
      connected: connected.has(peer.deviceId),
    }));
  }

  /** Revoke one phone: the server ends its membership; its connection closes now. */
  async revoke(deviceId) {
    const { accessToken } = await this.api.authenticate();
    const response = await fetch(`${this.serverUrl}/api/v1/device-memberships/${encodeURIComponent(deviceId)}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok && response.status !== 403) throw new Error(`The relay refused the revoke (HTTP ${response.status}).`);
    await this.connections.revoke(deviceId);
  }

  async status() {
    // Before `start` finished there is no identity yet: not paired, not online.
    return {
      server: this.serverUrl,
      deviceId: this.identity?.deviceId ?? null,
      paired: (await this.api?.hasStoredAuthorization()) ?? false,
      online: this.connection?.isOnline() ?? false,
      connected: this.connections?.connectionCount() ?? 0,
    };
  }

  async close() {
    await this.connection?.stop().catch(() => undefined);
    await this.connections?.close().catch(() => undefined);
    this.pairing?.close();
    this.api?.close();
  }
}
