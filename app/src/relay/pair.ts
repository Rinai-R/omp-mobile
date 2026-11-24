/**
 * Pairing this phone with a computer's omp-mobile daemon through a relay:
 * the steps of `pairing.ts` in order, with the waits between them. The screen
 * shows the computer's name and key fingerprint, then the 8-digit code the
 * user enters on the computer (`/mobile relay` or `omp-mobile relay pair`);
 * once it approves, the daemon answers `/hello` through the relay and the
 * machine to save comes back.
 */
import { generateKeyPair } from "@dsh-remote/crypto";
import appConfig from "../../app.json";
import { t } from "../i18n/index.ts";
import type { Hello, Machine, RelayLink } from "../types";
import { accountOf } from "./account";
import { phoneFor, relayHosts, saveAccountToken, saveCredentials, saveLogin, savedRelayAccount } from "./hosts";
import { PairingError, authenticateRelayAccount, cancelPairing, claimPairing, keyFingerprint, pairingStatus, registerAccountPhone, resolvePairing, type PairingTicket, type PhoneIdentity } from "./pairing";
import { RemoteServerError, type RemoteHostListing } from "./server";
import { relayFetch } from "./tunnel";

const POLL_MS = 1_500;
const JOIN_POLL_MS = 2_500;

/** What the screen shows while the computer has the code to enter. */
export interface PairingCode {
  host: string;
  /** The Host key's fingerprint, grouped for reading: the computer shows the same. */
  fingerprint: string;
  code: string;
  expiresAt: number;
}

/** Cancels a pairing in flight: the computer's screen then says so too. */
export interface PairingRun {
  machine: Promise<Machine>;
  cancel(): void;
}

function newPhone(): PhoneIdentity {
  const seed = new Uint8Array(32);
  crypto.getRandomValues(seed);
  const keys = generateKeyPair(seed);
  return { deviceId: crypto.randomUUID(), name: "OMP Mobile", publicKey: keys.publicKey, privateKey: keys.privateKey };
}

/** The paired computer as a machine: its daemon answers `/hello` through the relay. */
async function relayMachine(relay: RelayLink): Promise<Machine> {
  let hello: Hello;
  try {
    const response = await relayFetch(relay, "/hello");
    hello = (await response.json()) as Hello;
  } catch {
    throw new PairingError("NOT_OMP", t("relay.notOmp"));
  }
  if (hello.protocol !== 1 || typeof hello.name !== "string") throw new PairingError("NOT_OMP", t("relay.notOmp"));
  const url = `${relay.serverUrl}#${relay.hostDeviceId}`;
  return { id: `relay:${url}`, url, token: "", name: hello.name, os: hello.os, version: hello.version, cwd: hello.cwd, lastSeen: Date.now(), relay };
}

/** Pair with the computer a scanned or pasted code names. */
export function pairRelay(ticket: PairingTicket, machines: readonly Machine[], onCode: (code: PairingCode) => void): PairingRun {
  let cancelled = false;
  let cancel: (() => Promise<void>) | undefined;
  const machine = (async () => {
    const phone = await phoneFor(ticket.serverUrl, newPhone);
    const session = await resolvePairing(ticket);
    if (machines.some((item) => item.url === `${ticket.serverUrl}#${session.host.deviceId}`)) throw new Error(t("api.duplicate"));
    if (cancelled) throw new PairingError("CANCELLED", t("relayPair.cancelled"));
    let claimed;
    try {
      claimed = await claimPairing(ticket.serverUrl, session, phone, appConfig.expo.version);
    } catch (error) {
      if (error instanceof PairingError) throw error;
      // The answer was lost: the same bytes again recover it (never a new claim).
      claimed = await claimPairing(ticket.serverUrl, session, phone, appConfig.expo.version);
    }
    cancel = () => cancelPairing(ticket.serverUrl, session, phone);
    const fingerprint = keyFingerprint(session.host.identityKey).match(/.{1,4}/g)?.join(" ") ?? "";
    onCode({ host: session.host.name, fingerprint, code: claimed.verificationCode, expiresAt: claimed.expiresAt });
    for (;;) {
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
      if (cancelled) throw new PairingError("CANCELLED", t("relayPair.cancelled"));
      const status = await pairingStatus(ticket.serverUrl, session, phone).catch((error: unknown) => {
        // A dropped poll is asked again; a refusal ends the pairing.
        if (error instanceof PairingError) throw error;
        return undefined;
      });
      if (status === undefined || status.state === "claimed" || status.state === "approved" || status.state === "created") continue;
      if (status.state === "completed" && status.credentials !== null) {
        await saveCredentials(ticket.serverUrl, phone, status.credentials);
        return relayMachine({ serverUrl: ticket.serverUrl, hostDeviceId: session.host.deviceId });
      }
      if (status.state === "expired") throw new PairingError("PAIRING_EXPIRED", t("relayPair.expired"));
      if (status.state === "cancelled") throw new PairingError("CANCELLED", t("relayPair.cancelledThere"));
      throw new PairingError("FAILED", status.failureReason === "verification_failed" ? t("relayPair.wrongCode") : t("relayPair.failed", { reason: status.failureReason ?? status.state }));
    }
  })();
  return {
    machine,
    cancel: () => {
      cancelled = true;
      void cancel?.().catch(() => undefined);
    },
  };
}

/** A computer on the account, as the add sheet lists it. */
export interface RelayCandidate {
  deviceId: string;
  name: string;
  platform: string;
  online: boolean;
  /** Already in the phone's list: shown dimmed, not offered again. */
  added: boolean;
}

/** What an account sign-in found: the computers to choose among. */
export interface RelayLoginResult {
  serverUrl: string;
  account: string;
  candidates: RelayCandidate[];
}

/**
 * Sign in to a self-hosted relay with an account and list its computers.
 *
 * The password is used once; this phone then keeps only its device token pair.
 * Every computer the account has is returned so the phone can offer the ones not
 * added yet — with one computer (`pickRelay`) connects straight away, with
 * several the user chooses.
 */
export async function loginRelay(serverUrl: string, email: string, password: string, machines: readonly Machine[]): Promise<RelayLoginResult> {
  return signInRelay(serverUrl, await authenticateRelayAccount(serverUrl, email, password), machines);
}

/** Sign in with the account token a browser sign-in (GitHub, Google, ...) handed over. */
export async function loginRelayWithToken(serverUrl: string, token: string, machines: readonly Machine[]): Promise<RelayLoginResult> {
  return signInRelay(serverUrl, { account: await accountOf(serverUrl, token), token }, machines);
}

/**
 * This phone on the account `login` names: its device registered (or the saved
 * one reused), the account token kept for making computer codes, and the
 * account's computers listed.
 */
async function signInRelay(serverUrl: string, login: { account: string; token: string }, machines: readonly Machine[]): Promise<RelayLoginResult> {
  let hosts: RemoteHostListing[] | undefined;
  if (await savedRelayAccount(serverUrl) === login.account) {
    try {
      hosts = await relayHosts(serverUrl);
    } catch (error) {
      if (!(error instanceof RemoteServerError) || (error.status !== 401 && error.status !== 403)) throw error;
    }
  }
  // Registering an existing device invalidates its live connection. Reuse valid credentials
  // when the user signs in again to discover another computer on the same account.
  if (hosts === undefined) {
    const phone = await phoneFor(serverUrl, newPhone);
    await saveLogin(serverUrl, phone, await registerAccountPhone(serverUrl, login, phone, appConfig.expo.version));
    hosts = await relayHosts(serverUrl);
  }
  await saveAccountToken(serverUrl, login.token);
  return accountComputers(serverUrl, login.account, hosts, machines);
}

/**
 * The computer that joined the account after a code was made: polls the
 * account's list until a computer not in `known` shows up. Undefined once
 * `isCancelled` says so.
 */
export async function waitForNewComputer(
  serverUrl: string,
  account: string,
  known: ReadonlySet<string>,
  machines: readonly Machine[],
  isCancelled: () => boolean,
  pollMs = JOIN_POLL_MS,
): Promise<{ result: RelayLoginResult; deviceId: string } | undefined> {
  for (;;) {
    await new Promise((resolve) => setTimeout(resolve, pollMs));
    if (isCancelled()) return undefined;
    // A dropped poll is asked again; a refused one (signed out) ends the wait.
    const result = await resumeRelay(serverUrl, account, machines).catch((error: unknown) => {
      if (error instanceof RemoteServerError && (error.status === 401 || error.status === 403)) throw error;
      return undefined;
    });
    if (isCancelled()) return undefined;
    const joined = result?.candidates.find((item) => !known.has(item.deviceId) && !item.added);
    if (result !== undefined && joined !== undefined) return { result, deviceId: joined.deviceId };
  }
}

/** Discover more computers using the phone's saved, refreshable device credentials. */
export async function resumeRelay(serverUrl: string, account: string, machines: readonly Machine[]): Promise<RelayLoginResult> {
  return accountComputers(serverUrl, account, await relayHosts(serverUrl), machines);
}

/**
 * The account's computers as the add sheet lists them. An account with none is
 * an answer, not an error: the sheet then offers to add one with a code.
 */
function accountComputers(serverUrl: string, account: string, hosts: RemoteHostListing[], machines: readonly Machine[]): RelayLoginResult {
  const added = new Set(machines.map((item) => item.url));
  return {
    serverUrl,
    account,
    candidates: hosts.map((host) => ({
      deviceId: host.deviceId,
      name: host.name,
      platform: host.platform,
      online: host.online === true,
      added: added.has(`${serverUrl}#${host.deviceId}`),
    })),
  };
}

/**
 * Save the chosen computer from the relay listing. Its sessions screen opens
 * the tunnel after selection, so adding it cannot replace an active connection.
 */
export async function pickRelay(result: RelayLoginResult, deviceId: string, machines: readonly Machine[]): Promise<Machine> {
  const url = `${result.serverUrl}#${deviceId}`;
  if (machines.some((item) => item.url === url)) throw new Error(t("api.duplicate"));
  const candidate = result.candidates.find((item) => item.deviceId === deviceId);
  if (candidate === undefined) throw new PairingError("NO_HOST", t("relayLogin.noHost"));
  return {
    id: `relay:${url}`,
    url,
    token: "",
    name: candidate.name,
    os: candidate.platform,
    version: "",
    cwd: "",
    relay: { serverUrl: result.serverUrl, hostDeviceId: deviceId, account: result.account },
  };
}
