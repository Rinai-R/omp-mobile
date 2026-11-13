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
import { phoneFor, saveCredentials } from "./hosts";
import { PairingError, cancelPairing, claimPairing, keyFingerprint, pairingStatus, resolvePairing, type PairingTicket, type PhoneIdentity } from "./pairing";
import { relayFetch } from "./tunnel";

const POLL_MS = 1_500;

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
