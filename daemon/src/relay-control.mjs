/**
 * Relay pairing from this computer, against the running daemon's local
 * `/relay` API: shared by `omp-mobile relay ...` and `/mobile relay`.
 */
import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";
import { renderQr } from "./qr.mjs";
import { readState, tokenOf } from "./state.mjs";

/** The public relay of ds-harness-remote: it forwards only ciphertext. */
export const DEFAULT_RELAY = "https://dsh.r2049.cn";
const POLL_MS = 1_500;

/**
 * A host registration code as the relay wants it (`K7QM-4XPA`), from what a
 * person typed: either case, with or without the dash. Undefined when it is not one.
 */
export function hostCode(text) {
  const match = /^\s*([A-Za-z0-9]{4})-?([A-Za-z0-9]{4})\s*$/.exec(text);
  return match === null ? undefined : `${match[1]}-${match[2]}`.toUpperCase();
}

/** What a refused code means, for a person; other errors keep their own text. */
export function loginFailure(error) {
  const code = typeof error?.code === "string" ? error.code : "";
  if (code === "HOST_REGISTRATION_CODE_EXPIRED") return "the code expired. Make a new one on the phone (Add computer → Add a new computer).";
  if (code === "HOST_REGISTRATION_CODE_CONSUMED") return "the code was already used. Make a new one on the phone.";
  if (code === "HOST_REGISTRATION_CODE_NOT_FOUND") return "no such code. Check it against the phone, or make a new one there.";
  return error instanceof Error ? error.message : String(error);
}

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
  if (!response.ok) {
    const error = new Error(typeof answer.error === "string" ? answer.error : `HTTP ${response.status}`);
    // The relay's own refusal code (HOST_REGISTRATION_CODE_EXPIRED, ...), for `loginFailure`.
    if (typeof answer.code === "string") error.code = answer.code;
    throw error;
  }
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

/**
 * One line from the terminal. `hidden` suppresses the echo, so a password never
 * shows on screen and never passes through argv.
 */
async function ask(question, { hidden = false } = {}) {
  if (process.stdin.isTTY !== true) {
    throw new Error(`${question.trim()} cannot be asked without a terminal; run this from one`);
  }
  const output = new Writable({ write(_chunk, _encoding, done) { done(); } });
  const prompt = createInterface({ input: process.stdin, output: hidden ? output : process.stdout, terminal: true });
  process.stderr.write(question);
  try {
    return (await prompt.question("")).trim();
  } finally {
    prompt.close();
    if (hidden) {
      output.end();
      process.stderr.write("\n");
    }
  }
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
    if (command === "login" && args[1] !== undefined && hostCode(args[1]) !== undefined) {
      // A code from the phone (Add computer → Add a new computer): joins its account, no password.
      // A daemon started without the relay turns it on first; the code belongs to the phone's relay.
      // No relay named: the one the daemon serves, else the public one.
      const server = args[2] !== undefined && !args[2].startsWith("--") ? args[2] : undefined;
      if (server !== undefined || !state.relay) await relayCall(state, "POST", "/relay/enable", { server: server ?? DEFAULT_RELAY });
      try {
        const done = await relayCall(state, "POST", "/relay/login", { code: hostCode(args[1]) });
        console.log(`Joined the phone's account on ${done.server} · ${done.online ? "online" : "connecting"}. The phone adds this computer by itself.`);
      } catch (error) {
        throw new Error(loginFailure(error));
      }
      process.exit(0);
    }
    if (command === "login") {
      // The password is asked for here, in the terminal, and sent once: it never
      // goes into argv, so it cannot end up in shell history, a plist or `ps`.
      const account = args[1] ?? (await ask("Relay account email: "));
      if (account === undefined || account.trim() === "") throw new Error("usage: omp-mobile relay login <email>");
      const password = await ask("Relay account password: ", { hidden: true });
      if (password === undefined || password === "") throw new Error("a password is required");
      const done = await relayCall(state, "POST", "/relay/login", { account: account.trim(), password });
      console.log(`Signed in as ${done.account || account.trim()} · ${done.online ? "online" : "connecting"}`);
      process.exit(0);
    }
    if (command === "logout") {
      // No `GET /relay` first: it fetches the phone list, so it fails whenever the
      // relay is unreachable or has forgotten this device — exactly when the
      // tokens must still go. The daemon decides locally and answers 409 when
      // there was no account login to end.
      const done = await relayCall(state, "POST", "/relay/logout");
      console.log(`Signed out of ${done.account || "the relay account"}.`);
      console.log("Sign in again with: omp-mobile relay login <code from the phone> (or <email>), or pair a phone with: omp-mobile relay pair");
      process.exit(0);
    }
    if (command !== "pair") throw new Error(`unknown relay command "${command}" (pair, login, logout, status, revoke)`);
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
