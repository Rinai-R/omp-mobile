/**
 * One end-to-end encrypted connection from this phone to a computer's
 * omp-mobile daemon through a ds-harness-remote relay server.
 *
 * Transport, RPC framing and the Noise IK channel come from ds-harness-remote's
 * MIT packages; only the handshake glue here is ours (adapted from its Android
 * `secure-transport.ts`). Everything is encrypted on this phone and decrypted
 * only by the computer whose pinned key the handshake proves; the server
 * relays ciphertext. Over it runs the daemon's tunnel (`daemon/src/relay.mjs`),
 * which `tunnel.ts` turns back into HTTP requests and WebSockets.
 */
import { RemoteClientCore } from "@dsh-remote/client-core";
import { NoiseIkSession, createNoisePrologue } from "@dsh-remote/crypto";
import { SecureMessageCodec } from "@dsh-remote/protocol";
import { AdaptiveTransport, type RemoteTransport, type SecureHandshakeTransport } from "@dsh-remote/webrtc";
import { z } from "zod";
import type { PhoneIdentity } from "./pairing";
import type { RemoteHost, RemoteServerApi } from "./server";

const HANDSHAKE_MS = 10_000;
/** Tunnel calls answer once the daemon's response starts; silence past this is a dead channel. */
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

/** One `omp.data` event: a part of a handle's body (base64) or WebSocket message, or its end. */
const dataSchema = z.object({
  id: z.string(),
  data: z.string().optional(),
  text: z.string().optional(),
  more: z.boolean().optional(),
  done: z.boolean().optional(),
  error: z.string().optional(),
  code: z.number().optional(),
});

export type TunnelData = z.infer<typeof dataSchema>;

/** A computer's daemon reached through the relay: tunnel calls and the data they stream back. */
export class RelayConnection {
  readonly host: RemoteHost;
  private readonly core: RemoteClientCore;
  private readonly listeners = new Map<string, (data: TunnelData) => void>();
  private counter = 0;

  private constructor(host: RemoteHost, core: RemoteClientCore) {
    this.host = host;
    this.core = core;
    core.onEvent((event) => {
      // The daemon's own event, outside the protocol's list of names.
      const name: string = event.event;
      if (name !== "omp.data") return;
      const parsed = dataSchema.safeParse(event.data);
      if (parsed.success) this.listeners.get(parsed.data.id)?.(parsed.data);
    });
  }

  /**
   * Connect through the server's relay (the phone has no WebRTC module) and
   * prove the computer's pinned key.
   */
  static async open(api: RemoteServerApi, phone: PhoneIdentity, host: RemoteHost, onClose?: () => void): Promise<RelayConnection> {
    // String-built: React Native's URL has no setters.
    const url = `${api.serverUrl.replace(/^http/i, "ws")}/ws/v1/connect`;
    const transport = new AdaptiveTransport(url, {
      role: "client",
      deviceId: phone.deviceId,
      accessToken: await api.accessToken(),
      refreshAccessToken: async () => (await api.refresh()).accessToken,
      targetDeviceId: host.deviceId,
      forceRelay: true,
      preferredTransports: ["relay"],
      negotiateTimeoutMs: 6_000,
    });
    const core = new RemoteClientCore(new SecureTransport(transport, phone, host), RPC_TIMEOUT_MS);
    const connection = new RelayConnection(host, core);
    if (onClose !== undefined) core.onClose(onClose);
    await core.connect();
    return connection;
  }

  /** A fresh handle id with its data listener; `release` removes the listener. */
  open(listener: (data: TunnelData) => void): { id: string; release: () => void } {
    this.counter += 1;
    const id = `${Date.now().toString(36)}-${this.counter}`;
    this.listeners.set(id, listener);
    return { id, release: () => this.listeners.delete(id) };
  }

  call<T>(method: string, params: object): Promise<T> {
    return this.core.rpc<T>(method, params);
  }

  close(): Promise<void> {
    return this.core.close();
  }
}
