/**
 * The relay side of the phone's machine list: the credentials each relay
 * server issued this phone at pairing, and one shared end-to-end connection
 * per computer (its omp-mobile daemon).
 *
 * Credentials (this phone's X25519 key and its device tokens) are kept in the
 * app's storage beside the daemon tokens a tailnet machine already keeps there.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { t } from "../i18n/index.ts";
import type { Machine, RelayLink } from "../types";
import { RelayConnection } from "./connection";
import type { PairingCredentials, PairingTokens, PhoneIdentity } from "./pairing";
import { RemoteServerApi, RemoteServerError, type RemoteHostListing } from "./server";

const KEY = "omp.relay.v1";

/** What one server knows this phone as. */
interface ServerCredentials {
  phone: PhoneIdentity;
  account: string;
  tokens: PairingTokens;
}

type Store = Record<string, ServerCredentials>;

let store: Promise<Store> | undefined;

function loadStore(): Promise<Store> {
  store ??= AsyncStorage.getItem(KEY)
    .then((raw) => (raw === null ? {} : (JSON.parse(raw) as Store)))
    .catch(() => ({}));
  return store;
}

async function update(change: (current: Store) => void): Promise<void> {
  const current = await loadStore();
  change(current);
  await AsyncStorage.setItem(KEY, JSON.stringify(current));
}

/** This phone's identity on `serverUrl`: the one it paired with before, else a new one to pair with. */
export async function phoneFor(serverUrl: string, create: () => PhoneIdentity): Promise<PhoneIdentity> {
  return (await loadStore())[serverUrl]?.phone ?? create();
}

/** Keep what a completed pairing issued: this phone's tokens on that server. */
export async function saveCredentials(serverUrl: string, phone: PhoneIdentity, credentials: PairingCredentials): Promise<void> {
  await update((current) => {
    current[serverUrl] = { phone, account: credentials.account, tokens: credentials.tokens };
  });
  apis.delete(serverUrl);
}

const apis = new Map<string, RemoteServerApi>();

async function apiFor(serverUrl: string): Promise<{ api: RemoteServerApi; phone: PhoneIdentity }> {
  const credentials = (await loadStore())[serverUrl];
  if (credentials === undefined) throw new RemoteServerError(401, t("relay.notPaired"));
  let api = apis.get(serverUrl);
  if (api === undefined) {
    api = new RemoteServerApi(serverUrl, credentials.phone.deviceId, credentials.tokens, (tokens) =>
      update((current) => {
        const entry = current[serverUrl];
        if (entry !== undefined) entry.tokens = tokens;
      }),
    );
    apis.set(serverUrl, api);
  }
  return { api, phone: credentials.phone };
}

/** The computer behind a link as the server lists it now (online state); undefined once unpaired. */
export async function relayHost(link: RelayLink): Promise<RemoteHostListing | undefined> {
  const { api } = await apiFor(link.serverUrl);
  return (await api.hosts()).find((host) => host.deviceId === link.hostDeviceId);
}

const connections = new Map<string, Promise<RelayConnection>>();
const closeListeners = new Map<string, Set<() => void>>();

function keyOf(link: RelayLink): string {
  return `${link.serverUrl}#${link.hostDeviceId}`;
}

/**
 * The computer's connection, opened on first use and shared by every screen;
 * a closed or failed one is dropped so the next call opens anew.
 */
export function relayConnection(link: RelayLink): Promise<RelayConnection> {
  const key = keyOf(link);
  const existing = connections.get(key);
  if (existing !== undefined) return existing;
  const opening = (async () => {
    const { api, phone } = await apiFor(link.serverUrl);
    return RelayConnection.open(api, phone, await api.host(link.hostDeviceId), () => {
      if (connections.get(key) === opening) connections.delete(key);
      for (const listener of closeListeners.get(key) ?? []) listener();
    });
  })();
  connections.set(key, opening);
  opening.catch(() => {
    if (connections.get(key) === opening) connections.delete(key);
  });
  return opening;
}

/** Called when the computer's shared connection closes; returns the unsubscribe. */
export function onRelayClose(link: RelayLink, listener: () => void): () => void {
  const key = keyOf(link);
  let set = closeListeners.get(key);
  if (set === undefined) {
    set = new Set();
    closeListeners.set(key, set);
  }
  set.add(listener);
  return () => set.delete(listener);
}

/**
 * The machine was removed from this phone: end its pairing on the server (so
 * the computer no longer lists this phone), close its connection, and forget
 * the server's credentials once no other machine uses them.
 */
export async function forgetRelay(link: RelayLink, remaining: readonly Machine[]): Promise<void> {
  const key = keyOf(link);
  const existing = connections.get(key);
  connections.delete(key);
  void existing?.then((connection) => connection.close()).catch(() => undefined);
  const { api } = await apiFor(link.serverUrl);
  await api.revoke(link.hostDeviceId).catch(() => undefined);
  if (remaining.some((machine) => machine.relay?.serverUrl === link.serverUrl)) return;
  apis.delete(link.serverUrl);
  await update((current) => {
    delete current[link.serverUrl];
  });
}
