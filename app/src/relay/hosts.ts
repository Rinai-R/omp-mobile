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
  authorizationMethod?: "account";
  /**
   * The account's own token from the last sign-in, kept only to make the code
   * a new computer joins with; it has no refresh, so a refused one means
   * signing in again. The device tokens above do not depend on it.
   */
  accountToken?: string;
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

/** Keep what an account login issued: same shape as a pairing's credentials. */
export async function saveLogin(serverUrl: string, phone: PhoneIdentity, credentials: { account: string; tokens: PairingTokens }): Promise<void> {
  await update((current) => {
    current[serverUrl] = { phone, account: credentials.account, tokens: credentials.tokens, authorizationMethod: "account" };
  });
  apis.delete(serverUrl);
}

/** Keep the account token of a sign-in on `serverUrl` (undefined: forget it, it was refused). */
export async function saveAccountToken(serverUrl: string, token: string | undefined): Promise<void> {
  await update((current) => {
    const entry = current[serverUrl];
    if (entry === undefined) return;
    if (token === undefined) delete entry.accountToken;
    else entry.accountToken = token;
  });
}

export async function savedAccountToken(serverUrl: string): Promise<string | undefined> {
  return (await loadStore())[serverUrl]?.accountToken;
}

export async function savedRelayAccount(serverUrl: string): Promise<string | undefined> {
  return (await loadStore())[serverUrl]?.account;
}

/** Account entries only. Older builds can be identified by their saved machine account label. */
export async function savedAccountRelays(machines: readonly Machine[]): Promise<{ serverUrl: string; account: string }[]> {
  const current = await loadStore();
  const migrated = machines.filter((machine) => machine.relay?.account !== undefined)
    .map((machine) => machine.relay!);
  let changed = false;
  for (const link of migrated) {
    const entry = current[link.serverUrl];
    if (entry !== undefined && entry.account === link.account && entry.authorizationMethod === undefined) {
      entry.authorizationMethod = "account";
      changed = true;
    }
  }
  if (changed) await AsyncStorage.setItem(KEY, JSON.stringify(current));
  return Object.entries(current)
    .filter(([, entry]) => entry.authorizationMethod === "account")
    .map(([serverUrl, entry]) => ({ serverUrl, account: entry.account }));
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

/** List hosts using the saved credentials and the shared token refresh path. */
export async function relayHosts(serverUrl: string): Promise<RemoteHostListing[]> {
  const { api } = await apiFor(serverUrl);
  return api.hosts();
}

const hostLists = new Map<string, Promise<RemoteHostListing[]>>();

/** Share one relay presence request across the computers in a refresh round. */
export async function relayHost(link: RelayLink): Promise<RemoteHostListing | undefined> {
  let listing = hostLists.get(link.serverUrl);
  if (listing === undefined) {
    listing = relayHosts(link.serverUrl).finally(() => hostLists.delete(link.serverUrl));
    hostLists.set(link.serverUrl, listing);
  }
  return (await listing).find((host) => host.deviceId === link.hostDeviceId);
}

const connections = new Map<string, Promise<RelayConnection>>();
const closeListeners = new Map<string, Set<() => void>>();

function keyOf(link: RelayLink): string {
  return `${link.serverUrl}#${link.hostDeviceId}`;
}

let selectedAccountHost: string | undefined;
let accountSelectionVersion = 0;
let closingAccountHost = Promise.resolve();

/** Deselect synchronously so old streams and retry timers cannot open the old host again. */
export function selectAccountRelay(link: RelayLink | undefined): void {
  const next = link?.account === undefined ? undefined : keyOf(link);
  const previous = selectedAccountHost;
  if (previous === next) return;
  selectedAccountHost = next;
  accountSelectionVersion += 1;
  if (previous === undefined) return;
  const opening = connections.get(previous);
  if (opening === undefined) return;
  connections.delete(previous);
  closingAccountHost = closingAccountHost.then(async () => {
    const connection = await opening.catch(() => undefined);
    await connection?.close();
  }).catch(() => undefined);
}

/**
 * The computer's connection, opened on first use and shared by every screen;
 * a closed or failed one is dropped so the next call opens anew.
 */
export function relayConnection(link: RelayLink): Promise<RelayConnection> {
  const key = keyOf(link);
  const accountRelay = link.account !== undefined;
  if (accountRelay && selectedAccountHost !== key) return Promise.reject(new Error(t("relay.selectComputer")));
  const existing = connections.get(key);
  if (existing !== undefined) return existing;
  const selectionVersion = accountSelectionVersion;
  const opening = (async () => {
    if (accountRelay) await closingAccountHost;
    const { api, phone } = await apiFor(link.serverUrl);
    const host = await api.host(link.hostDeviceId);
    if (accountRelay && (accountSelectionVersion !== selectionVersion)) {
      throw new Error(t("relay.selectComputer"));
    }
    return RelayConnection.open(api, phone, host, () => {
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
  if (link.account !== undefined && selectedAccountHost === key) {
    selectAccountRelay(undefined);
  } else {
    const existing = connections.get(key);
    connections.delete(key);
    void existing?.then((connection) => connection.close()).catch(() => undefined);
  }
  const { api } = await apiFor(link.serverUrl);
  await api.revoke(link.hostDeviceId).catch(() => undefined);
  if (remaining.some((machine) => machine.relay?.serverUrl === link.serverUrl)) return;
  apis.delete(link.serverUrl);
  await update((current) => {
    delete current[link.serverUrl];
  });
}
