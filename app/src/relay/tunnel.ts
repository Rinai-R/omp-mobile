/**
 * The daemon's HTTP API and WebSockets, through a relay connection: what
 * `fetch` and `WebSocket` are for a tailnet machine. The daemon side is
 * `daemon/src/relay.mjs`.
 */
import type { RelayTransport } from "../link";
import type { RelayLink } from "../types";
import type { TunnelData } from "./connection";
import { onRelayClose, relayConnection } from "./hosts";

/** The part of `Response` the app reads. */
export interface TunnelResponse {
  status: number;
  ok: boolean;
  text(): Promise<string>;
  json(): Promise<unknown>;
  /** A binary body as base64 (images from `/blobs`). */
  base64: string;
  contentType: string;
}

export interface TunnelInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
}

/** One HTTP request to the daemon behind `link`, read whole. */
export async function relayFetch(link: RelayLink, path: string, init: TunnelInit = {}): Promise<TunnelResponse> {
  const connection = await relayConnection(link);
  const text: string[] = [];
  const binary: string[] = [];
  // Not Promise.withResolvers: React Native's Promise polyfill lacks it.
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const finished = new Promise<void>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  const handle = connection.open((data: TunnelData) => {
    if (data.text !== undefined) text.push(data.text);
    if (data.data !== undefined) binary.push(data.data);
    if (data.done === true) {
      if (data.error === undefined) resolve();
      else reject(new Error(`The computer ended the answer (${data.error}).`));
    }
  });
  const unsubscribe = onRelayClose(link, () => reject(new Error("The relay connection closed.")));
  const abort = () => {
    reject(init.signal?.reason ?? new Error("Aborted."));
    void connection.call("omp.close", { id: handle.id }).catch(() => undefined);
  };
  init.signal?.addEventListener("abort", abort, { once: true });
  try {
    const head = await connection.call<{ status: number; headers: { "content-type"?: string } }>("omp.http.open", {
      id: handle.id,
      method: init.method ?? "GET",
      path,
      headers: init.headers ?? {},
      ...(init.body === undefined ? {} : { body: init.body }),
    });
    await finished;
    const body = text.join("");
    return {
      status: head.status,
      ok: head.status >= 200 && head.status < 300,
      text: async () => body,
      json: async () => JSON.parse(body) as unknown,
      base64: binary.join(""),
      contentType: head.headers["content-type"] ?? "",
    };
  } finally {
    init.signal?.removeEventListener("abort", abort);
    unsubscribe();
    handle.release();
  }
}

/**
 * A long-lived text response (the daemon's `/events` stream), part by part;
 * resolves when it ends, rejects when it fails. `stopped` ends it early.
 */
export async function relayStream(
  link: RelayLink,
  path: string,
  handlers: { onOpen(): void; onText(part: string): void },
  stopped: AbortSignal,
): Promise<void> {
  const connection = await relayConnection(link);
  // Not Promise.withResolvers: React Native's Promise polyfill lacks it.
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const finished = new Promise<void>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  const handle = connection.open((data: TunnelData) => {
    if (data.text !== undefined) handlers.onText(data.text);
    if (data.done === true) {
      if (data.error === undefined) resolve();
      else reject(new Error(data.error));
    }
  });
  const unsubscribe = onRelayClose(link, () => reject(new Error("The relay connection closed.")));
  const stop = () => {
    resolve();
    void connection.call("omp.close", { id: handle.id }).catch(() => undefined);
  };
  stopped.addEventListener("abort", stop, { once: true });
  try {
    const head = await connection.call<{ status: number }>("omp.http.open", { id: handle.id, method: "GET", path, headers: { accept: "text/event-stream" } });
    if (head.status !== 200) throw new Error(`HTTP ${head.status}`);
    handlers.onOpen();
    await finished;
  } finally {
    stopped.removeEventListener("abort", stop);
    unsubscribe();
    handle.release();
  }
}

/**
 * A WebSocket to the daemon behind `link`, with the members `SessionSocket`
 * uses of the platform's (`readyState` takes the same values).
 */
export class RelaySocket {
  readyState: number = WebSocket.CONNECTING;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  private readonly link: RelayLink;
  private release: (() => void) | undefined;
  private unsubscribe: (() => void) | undefined;
  private send_: ((text: string) => Promise<unknown>) | undefined;
  private closeHandle: (() => void) | undefined;
  /** A message split into parts by the tunnel, so far. */
  private parts = "";
  /** Messages that arrived before the open answer did: delivered right after `onopen`. */
  private early: string[] = [];

  constructor(link: RelayLink, path: string) {
    this.link = link;
    void this.start(path);
  }

  private async start(path: string): Promise<void> {
    try {
      const connection = await relayConnection(this.link);
      if (this.readyState !== WebSocket.CONNECTING) return;
      const handle = connection.open((data) => this.receive(data));
      this.release = handle.release;
      this.unsubscribe = onRelayClose(this.link, () => this.finish());
      this.send_ = (text) => connection.call("omp.ws.send", { id: handle.id, text });
      this.closeHandle = () => void connection.call("omp.close", { id: handle.id }).catch(() => undefined);
      await connection.call("omp.ws.open", { id: handle.id, path });
      if (this.readyState !== WebSocket.CONNECTING) {
        this.closeHandle();
        return;
      }
      this.readyState = WebSocket.OPEN;
      this.onopen?.();
      for (const message of this.early.splice(0)) this.onmessage?.({ data: message });
    } catch {
      this.onerror?.();
      this.finish();
    }
  }

  private receive(data: TunnelData): void {
    if (data.text !== undefined) {
      this.parts += data.text;
      if (data.more !== true) {
        const message = this.parts;
        this.parts = "";
        if (this.readyState === WebSocket.OPEN) this.onmessage?.({ data: message });
        else if (this.readyState === WebSocket.CONNECTING) this.early.push(message);
      }
    }
    if (data.done === true) this.finish();
  }

  send(text: string): void {
    if (this.readyState !== WebSocket.OPEN || this.send_ === undefined) throw new Error("The socket is not open.");
    void this.send_(text).catch(() => this.finish());
  }

  close(): void {
    if (this.readyState === WebSocket.CLOSING || this.readyState === WebSocket.CLOSED) return;
    this.readyState = WebSocket.CLOSING;
    this.closeHandle?.();
    this.finish();
  }

  private finish(): void {
    if (this.readyState === WebSocket.CLOSED) return;
    this.readyState = WebSocket.CLOSED;
    this.release?.();
    this.unsubscribe?.();
    this.onclose?.();
  }
}

/** The relay half of `link.ts`, installed at startup. */
export const relayTransport: RelayTransport = {
  fetch: relayFetch,
  socket: (link, path) => new RelaySocket(link, path),
  async image(link, path) {
    const response = await relayFetch(link, path);
    if (!response.ok || response.base64 === "") return undefined;
    return `data:${response.contentType.split(";")[0] || "image/png"};base64,${response.base64}`;
  },
};
