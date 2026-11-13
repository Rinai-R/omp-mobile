/**
 * One end-to-end encrypted connection from this phone to a DSH Remote Host,
 * and the Agent ACP calls omp-mobile makes over it.
 *
 * Transport (LAN → P2P → TURN → relay), RPC framing and the Noise IK channel
 * come from ds-harness-remote's MIT packages; only the handshake glue here is
 * ours (adapted from its Android `secure-transport.ts`). Prompts, replies and
 * tool output are encrypted on this phone and decrypted only by the Host whose
 * pinned key the handshake proves; the server relays ciphertext.
 */
import { t } from "../i18n/index.ts";
import { AgentAcpClient, RemoteClientCore, probeRemoteHostFeatures, remoteWorkspaceTypeAvailable, type AcpStream } from "@dsh-remote/client-core";
import { NoiseIkSession, createNoisePrologue } from "@dsh-remote/crypto";
import { SecureMessageCodec } from "@dsh-remote/protocol";
import { AdaptiveTransport, type RemoteTransport, type SecureHandshakeTransport } from "@dsh-remote/webrtc";
import type { PhoneIdentity } from "./pairing";
import type { RemoteHost, RemoteServerApi } from "./server";
import { z } from "zod";

const HANDSHAKE_MS = 10_000;
/** Host calls are capped at 30 s; silence past that is a dead channel. */
const RPC_TIMEOUT_MS = 35_000;

/** Noise IK over the Host carrier: initiator with this phone's key, responder pinned to the Host's. */
class SecureTransport implements RemoteTransport {
  private readonly inner: SecureHandshakeTransport;
  private readonly phone: PhoneIdentity;
  private readonly host: RemoteHost;
  private noise: NoiseIkSession | undefined;
  private unsubscribeInner: (() => void) | undefined;
  private readonly incoming = new SecureMessageCodec();
  private readonly outgoing = new SecureMessageCodec();
  private closed = false;
  /** The Noise and codec counters are not re-entrant: sends go one at a time. */
  private sendTail: Promise<void> = Promise.resolve();

  constructor(inner: SecureHandshakeTransport, phone: PhoneIdentity, host: RemoteHost) {
    this.inner = inner;
    this.phone = phone;
    this.host = host;
  }

  async connect(): Promise<void> {
    this.closed = false;
    this.incoming.reset();
    this.outgoing.reset();
    await this.inner.connect();
    const info = this.inner.connectionInfo();
    if (info.localDeviceId !== this.phone.deviceId || info.remoteDeviceId !== this.host.deviceId) {
      await this.inner.close();
      throw new Error("The server connected this phone to a different device.");
    }
    const noise = new NoiseIkSession({
      role: "initiator",
      localPrivateKey: this.phone.privateKey,
      localPublicKey: this.phone.publicKey,
      remotePublicKey: this.host.identityKey,
      prologue: createNoisePrologue(info.connectionId, this.host.deviceId, this.phone.deviceId),
    });
    this.noise = noise;
    try {
      await handshake(this.inner, noise);
      this.inner.markSecureReady?.();
    } catch (error) {
      noise.destroy();
      this.noise = undefined;
      await this.inner.close();
      throw error;
    }
  }

  send(data: Uint8Array): Promise<void> {
    const run = this.sendTail.then(async () => {
      try {
        for (const frame of this.outgoing.encode(data)) await this.inner.send(this.ready().encrypt(frame));
      } catch (error) {
        await this.close().catch(() => undefined);
        throw error;
      }
    });
    this.sendTail = run.catch(() => undefined);
    return run;
  }

  onMessage(handler: (data: Uint8Array) => void): () => void {
    this.unsubscribeInner?.();
    this.unsubscribeInner = this.inner.onMessage((data) => {
      const noise = this.noise;
      if (noise === undefined || !noise.complete || this.closed) return;
      try {
        const message = this.incoming.decode(noise.decrypt(data));
        if (message !== undefined) handler(message);
      } catch {
        // A frame that does not decrypt or reassemble ends the channel; its content is never logged.
        void this.close();
      }
    });
    return () => {
      this.unsubscribeInner?.();
      this.unsubscribeInner = undefined;
    };
  }

  onClose(handler: () => void): () => void {
    return this.inner.onClose?.(handler) ?? (() => undefined);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.unsubscribeInner?.();
    this.unsubscribeInner = undefined;
    this.incoming.reset();
    this.outgoing.reset();
    this.noise?.destroy();
    this.noise = undefined;
    await this.inner.close();
  }

  getStats() {
    return this.inner.getStats();
  }

  private ready(): NoiseIkSession {
    if (this.noise === undefined || !this.noise.complete || this.closed) throw new Error("The encrypted channel is not connected.");
    return this.noise;
  }
}

function handshake(inner: SecureHandshakeTransport, noise: NoiseIkSession): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      unsubscribe();
      if (error === undefined) resolve();
      else reject(error);
    };
    const timer = setTimeout(() => finish(new Error("The computer did not complete the encrypted handshake.")), HANDSHAKE_MS);
    const unsubscribe = inner.onHandshake((step, data) => {
      try {
        if (step !== 2) throw new Error("The encrypted handshake arrived out of order.");
        noise.readHandshake(data);
        if (!noise.complete) throw new Error("The encrypted handshake did not complete.");
        finish();
      } catch (error) {
        finish(error instanceof Error ? error : new Error("The encrypted handshake failed."));
      }
    });
    inner.sendHandshake(1, noise.writeHandshake()).catch((error: unknown) => finish(error instanceof Error ? error : new Error("The encrypted handshake failed.")));
  });
}

/** An OMP session as the Host's Pi (ACP) backend lists it. */
export interface RemoteSessionRow {
  /** The ACP session id: OMP's own session id. */
  id: string;
  title: string;
  cwd: string;
  updatedAt: number;
}

/** An `agent.acp.frame` event's payload, as far as routing it by session needs. */
const frameSchema = z.object({ frame: z.object({ method: z.string(), params: z.object({ sessionId: z.string() }).passthrough() }) });

/** A Host connection carrying the OMP sessions behind its `pi` ACP backend. */
export class RemoteHostConnection {
  readonly host: RemoteHost;
  private readonly core: RemoteClientCore;
  private readonly acp: AgentAcpClient;

  private constructor(host: RemoteHost, core: RemoteClientCore, acp: AgentAcpClient) {
    this.host = host;
    this.core = core;
    this.acp = acp;
  }

  /**
   * Connect, prove the Host's pinned key, and check it serves OMP through its
   * `pi` backend. `forceRelay` skips WebRTC (and its native module) entirely.
   */
  static async open(api: RemoteServerApi, phone: PhoneIdentity, host: RemoteHost, options: { forceRelay?: boolean; onClose?: () => void } = {}): Promise<RemoteHostConnection> {
    // String-built: React Native's URL has no setters.
    const url = `${api.serverUrl.replace(/^http/i, "ws")}/ws/v1/connect`;
    const transport = new AdaptiveTransport(url, {
      role: "client",
      deviceId: phone.deviceId,
      accessToken: await api.accessToken(),
      refreshAccessToken: async () => (await api.refresh()).accessToken,
      targetDeviceId: host.deviceId,
      forceRelay: options.forceRelay === true,
      preferredTransports: options.forceRelay === true ? ["relay"] : ["lan", "p2p", "turn", "relay"],
      negotiateTimeoutMs: 6_000,
      iceServersTimeoutMs: 5_000,
      fetchIceServers: (connectionId) => api.iceServers(connectionId),
    });
    const core = new RemoteClientCore(new SecureTransport(transport, phone, host), RPC_TIMEOUT_MS);
    if (options.onClose !== undefined) core.onClose(options.onClose);
    await core.connect();
    const features = await probeRemoteHostFeatures(core, host.clientVersion ?? undefined);
    if (!remoteWorkspaceTypeAvailable(features.capabilities, features.workspaceTypes, "pi", "agent.acp.pi.v1")) {
      await core.close();
      throw new Error(t("remote.noPi"));
    }
    return new RemoteHostConnection(host, core, new AgentAcpClient(core, features.capabilities));
  }

  /** The directories the Host lists OMP sessions under. */
  async workspaces(): Promise<{ path: string; title?: string }[]> {
    return this.acp.listWorkspaces("pi");
  }

  async sessions(path: string, limit = 100): Promise<RemoteSessionRow[]> {
    const rows = await this.acp.listSessions(path, "pi", limit);
    return rows.map((row) => ({ id: row.conversationId, title: row.title, cwd: path, updatedAt: row.updatedAt }));
  }

  /** The session's history as the Host projects it: DSH session events. */
  history(sessionId: string): Promise<unknown[]> {
    return this.acp.loadSessionHistory(sessionId, "pi");
  }

  async createSession(cwd: string): Promise<string> {
    return (await this.acp.createSession(cwd, undefined, "pi")).sessionId;
  }

  /** Follow a session's live ACP notifications; close the stream when leaving it. */
  follow(sessionId: string, onFrame: (method: string, params: unknown) => void, onClosed?: (reason: string) => void): Promise<AcpStream> {
    return this.acp.openStream(
      sessionId,
      (data) => onFrame(data.frame.method, data.frame.params),
      (closed) => onClosed?.(closed.reason),
    );
  }

  /**
   * Every ACP frame the Host sends this phone, stream or not: the Host addresses
   * them by session, and sends a permission request only once.
   */
  onFrame(handler: (sessionId: string, method: string, params: unknown) => void): () => void {
    return this.core.onEvent((event) => {
      if (event.event !== "agent.acp.frame") return;
      const parsed = frameSchema.safeParse(event.data);
      if (!parsed.success) return;
      const { method, params } = parsed.data.frame;
      handler(params.sessionId, method, params);
    });
  }

  /** Send a prompt; resolves when OMP ends the turn (ACP `session/prompt`). */
  prompt(sessionId: string, text: string, images: { mimeType: string; data: string }[] = []): Promise<unknown> {
    return this.acp.prompt(sessionId, text, undefined, images.map((image) => ({ type: "image" as const, ...image })), "pi");
  }

  /** The models OMP can switch this session to, and the one it runs. */
  models(sessionId: string): Promise<unknown> {
    return this.acp.sessionModels(sessionId, "pi");
  }

  selectModel(sessionId: string, provider: string, model: string, reasoningEffort?: string): Promise<unknown> {
    return this.acp.selectModel(sessionId, "pi", reasoningEffort === undefined ? { provider, model } : { provider, model, reasoningEffort });
  }

  cancel(sessionId: string): Promise<unknown> {
    return this.acp.cancel(sessionId);
  }

  /** Answer a `session/request_permission` the stream delivered. */
  answer(requestHandle: string, decision: "allow-once" | "reject-once" | "cancel"): Promise<unknown> {
    return this.acp.respond(requestHandle, decision);
  }

  close(): Promise<void> {
    return this.core.close();
  }
}
