/**
 * How the app reaches a machine's daemon: over its tailnet address, or
 * through its relay. Everything that talks to a daemon goes through these
 * two, so both paths serve the same API.
 *
 * The relay transport (`relay/tunnel.ts`) is installed at startup rather than
 * imported, so this file (and what node:test loads through it) needs nothing
 * of React Native.
 */
import type { Machine, RelayLink } from "./types";

/** The part of `Response` the app reads. */
export interface MachineResponse {
  status: number;
  ok: boolean;
  text(): Promise<string>;
  json(): Promise<unknown>;
}

/** What reaching a machine takes: its tailnet address and token, or its relay link. */
export type MachineAddress = Pick<Machine, "url" | "token" | "relay">;

export interface MachineInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
}

/** The members of `WebSocket` the session socket uses. */
export interface MachineSocket {
  readonly readyState: number;
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: (() => void) | null;
  onerror: (() => void) | null;
  send(text: string): void;
  close(): void;
}

export interface RelayTransport {
  fetch(link: RelayLink, path: string, init: MachineInit): Promise<MachineResponse>;
  socket(link: RelayLink, path: string): MachineSocket;
  /** An image the daemon serves (`/blobs`), as a data URI. */
  image(link: RelayLink, path: string): Promise<string | undefined>;
}

let relay: RelayTransport | undefined;

export function installRelayTransport(transport: RelayTransport): void {
  relay = transport;
}

function relayOf(): RelayTransport {
  if (relay === undefined) throw new Error("The relay transport is not installed.");
  return relay;
}

/** One request to the machine's daemon, with its token (through a relay, the computer adds it). */
export async function machineFetch(machine: MachineAddress, path: string, init: MachineInit = {}): Promise<MachineResponse> {
  if (machine.relay !== undefined) return relayOf().fetch(machine.relay, path, init);
  return fetch(`${machine.url}${path}`, {
    method: init.method ?? "GET",
    headers: { authorization: `Bearer ${machine.token}`, ...init.headers },
    body: init.body,
    signal: init.signal,
  });
}

/** A WebSocket to `path` (with its query) on the machine's daemon. */
export function machineSocket(machine: MachineAddress, path: string): MachineSocket {
  if (machine.relay !== undefined) return relayOf().socket(machine.relay, path);
  const separator = path.includes("?") ? "&" : "?";
  const socket = new WebSocket(`${machine.url.replace(/^http/i, "ws")}${path}${separator}token=${encodeURIComponent(machine.token)}`);
  // The platform's handlers take an event argument; the session socket reads only `data` of a message.
  return socket as unknown as MachineSocket;
}

/** An image on a relay machine as a data URI: `<Image>` cannot load through the tunnel itself. */
export function relayImage(link: RelayLink, path: string): Promise<string | undefined> {
  return relayOf().image(link, path);
}
