/**
 * Relay pairing from this computer, against the running daemon's local
 * `/relay` API: shared by `omp-mobile relay ...` and `/mobile relay`.
 */
import { createInterface } from "node:readline/promises";
import { renderQr } from "./qr.mjs";
import { readState, tokenOf } from "./state.mjs";

/** The public relay of ds-harness-remote: it forwards only ciphertext. */
export const DEFAULT_RELAY = "https://dsh.r2049.cn";
const POLL_MS = 1_500;

/** One `/relay` call to the daemon `state` describes; throws its error text. */
export async function relayCall(state, method, path, body) {
  const response = await fetch(`${state.url}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${tokenOf(state.pair)}`,
      "x-omp-mobile-probe": "1",
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  const answer = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof answer.error === "string" ? answer.error : `HTTP ${response.status}`);
  return answer;
}

/** The pairing once a phone claimed it, or it ended; polls until then. */
export async function waitForPhone(state, sessionId, isCancelled = () => false) {
  for (;;) {
    if (isCancelled()) return undefined;
    const { pairing } = await relayCall(state, "GET", "/relay/pair");
    if (pairing === null || pairing.sessionId !== sessionId || pairing.state !== "created") return pairing ?? undefined;
    await new Promise((resolveWait) => setTimeout(resolveWait, POLL_MS));
  }
}

/** What a finished confirm means, in a line. */
export function pairingOutcome(view) {
  if (view.state === "completed") return "Paired. The phone lists this computer and connects through the relay.";
  if (view.failureReason === "verification_failed") return "The code did not match; this pairing is over. Start a new one.";
  return `Pairing ended (${view.state}${view.failureReason ? `: ${view.failureReason}` : ""}).`;
}

/** The phone's fingerprint grouped like the app shows the computer's. */
export function grouped(fingerprint) {
  return fingerprint.match(/.{1,4}/g)?.join(" ") ?? fingerprint;
}

function stateFileOf(args) {
  const at = args.indexOf("--state-file");
  return at === -1 ? undefined : args[at + 1];
}

/** `omp-mobile relay <pair|status|revoke>`: exits the process. */
export async function runRelayCli(args) {
  const command = args[0] ?? "status";
  const state = readState(stateFileOf(args));
  if (state === undefined) {
    console.error("omp-mobile: the daemon is not running. Start it with --relay (or /mobile relay in OMP).");
    process.exit(1);
  }
  try {
    if (command === "status") {
      const relay = await relayCall(state, "GET", "/relay");
      console.log(`relay   ${relay.server} · ${relay.paired ? (relay.online ? "online" : "offline") : "not paired yet"}`);
      for (const phone of relay.phones) console.log(`phone   ${phone.name} (${phone.platform}) ${phone.deviceId}${phone.connected ? " · connected" : ""}`);
      if (relay.phones.length === 0) console.log("phones  none; pair one with: omp-mobile relay pair");
      process.exit(0);
    }
    if (command === "revoke") {
      if (args[1] === undefined) throw new Error("usage: omp-mobile relay revoke <phone device id>");
      await relayCall(state, "DELETE", `/relay/phones/${encodeURIComponent(args[1])}`);
      console.log("Revoked: that phone can no longer reach this computer.");
      process.exit(0);
    }
    if (command !== "pair") throw new Error(`unknown relay command "${command}" (pair, status, revoke)`);
    const view = await relayCall(state, "POST", "/relay/pair");
    let cancelled = false;
    process.on("SIGINT", () => {
      cancelled = true;
      void relayCall(state, "POST", "/relay/pair/cancel", { sessionId: view.sessionId }).finally(() => process.exit(130));
    });
    console.log("Scan with OMP on your phone (Machines > Scan to pair), or paste the link into Enter address:\n");
    console.log(renderQr(view.qrPayload));
    console.log(`  ${view.qrPayload}`);
    console.log(`  computer key ${grouped(view.hostFingerprint)}`);
    console.log(`  expires ${new Date(view.expiresAt).toLocaleTimeString()}\n`);
    const claimed = await waitForPhone(state, view.sessionId, () => cancelled);
    if (claimed === undefined || claimed.state !== "claimed") throw new Error(claimed === undefined ? "Pairing ended." : pairingOutcome(claimed));
    console.log(`Phone: ${claimed.mobile?.name ?? "unknown"} · key ${grouped(claimed.mobile?.fingerprint ?? "")}`);
    const prompt = createInterface({ input: process.stdin, output: process.stdout });
    const code = (await prompt.question("Enter the 8-digit code the phone shows (one try): ")).replace(/\D/g, "");
    prompt.close();
    const done = await relayCall(state, "POST", "/relay/pair/confirm", { sessionId: view.sessionId, code });
    console.log(pairingOutcome(done));
    process.exit(done.state === "completed" ? 0 : 1);
  } catch (error) {
    console.error(`omp-mobile: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
