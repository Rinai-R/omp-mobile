/**
 * The DSH Remote side of the phone's machine list: the credentials each
 * server issued this phone at pairing, the Hosts it reaches through them, and
 * one shared end-to-end connection per Host.
 *
 * Credentials (this phone's X25519 key and its device tokens) are kept in the
 * app's storage beside the daemon tokens a tailnet machine already keeps there.
 */
import { t } from "../i18n/index.ts";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { PairingCredentials, PairingDevice, PairingTokens, PhoneIdentity } from "./pairing";
import { RemoteServerApi, RemoteServerError, type RemoteHostListing } from "./server";
import { RemoteHostConnection } from "./connection";
import type { Machine } from "../types";

const KEY = "omp.dsh.v1";

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

/**
 * Keep what a completed pairing issued and build the machine for its Host.
 * The machine's `url` names server and Host, so the same Host is one machine.
 */
export async function savePairing(serverUrl: string, phone: PhoneIdentity, host: PairingDevice, credentials: PairingCredentials): Promise<Machine> {
  await update((current) => {
    current[serverUrl] = { phone, account: credentials.account, tokens: credentials.tokens };
  });
  apis.delete(serverUrl);
  const url = `${serverUrl}#${host.deviceId}`;
  return {
    id: `dsh:${url}`,
    url,
    token: "",
    name: host.name,
    os: host.platform,
    version: host.harnessVersion ?? host.clientVersion ?? "",
    cwd: "",
    lastSeen: Date.now(),
    remote: { serverUrl, hostDeviceId: host.deviceId },
  };
}

/** Forget a server's credentials once no machine uses them. */
export async function forgetServer(serverUrl: string, machines: readonly Machine[]): Promise<void> {
  if (machines.some((machine) => machine.remote?.serverUrl === serverUrl)) return;
  apis.delete(serverUrl);
  await update((current) => {
    delete current[serverUrl];
  });
}

const apis = new Map<string, RemoteServerApi>();

async function apiFor(serverUrl: string): Promise<{ api: RemoteServerApi; phone: PhoneIdentity }> {
  const credentials = (await loadStore())[serverUrl];
  if (credentials === undefined) throw new RemoteServerError(401, t("remote.notPaired"));
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

/** The Host behind a machine as the server lists it now: online state, name, versions. */
export async function remoteHost(machine: Machine): Promise<RemoteHostListing | undefined> {
  const link = machine.remote;
  if (link === undefined) return undefined;
  const { api } = await apiFor(link.serverUrl);
  return (await api.hosts()).find((host) => host.deviceId === link.hostDeviceId);
}

const connections = new Map<string, Promise<RemoteHostConnection>>();

/**
 * The machine's Host connection, opened on first use and shared by every
 * screen; a closed or failed one is dropped so the next call opens anew.
 */
export function remoteConnection(machine: Machine): Promise<RemoteHostConnection> {
  const link = machine.remote;
  if (link === undefined) return Promise.reject(new Error("Not a DSH Remote machine."));
  const existing = connections.get(machine.id);
  if (existing !== undefined) return existing;
  const opening = (async () => {
    const { api, phone } = await apiFor(link.serverUrl);
    // The phone has no WebRTC module: Host traffic goes through the server's relay, still end-to-end encrypted.
    return RemoteHostConnection.open(api, phone, await api.host(link.hostDeviceId), {
      forceRelay: true,
      onClose: () => {
        if (connections.get(machine.id) === opening) connections.delete(machine.id);
        for (const listener of closeListeners.get(machine.id) ?? []) listener();
      },
    });
  })();
  connections.set(machine.id, opening);
  opening.catch(() => {
    if (connections.get(machine.id) === opening) connections.delete(machine.id);
  });
  return opening;
}

const closeListeners = new Map<string, Set<() => void>>();

/** Called when the machine's shared connection closes; returns the unsubscribe. */
export function onRemoteClose(machine: Machine, listener: () => void): () => void {
  let set = closeListeners.get(machine.id);
  if (set === undefined) {
    set = new Set();
    closeListeners.set(machine.id, set);
  }
  set.add(listener);
  return () => set.delete(listener);
}

/** Close and forget the machine's connection (it was removed, or the user retried). */
export function dropRemote(machine: Machine): void {
  const existing = connections.get(machine.id);
  connections.delete(machine.id);
  void existing?.then((connection) => connection.close()).catch(() => undefined);
}
