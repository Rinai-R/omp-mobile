/**
 * DSH Remote device pairing v1, phone side (the flow DSH Go uses): scan the
 * computer's code, confirm, show the 8-digit code for the computer to enter,
 * then receive this phone's own device credentials. No account login.
 *
 * Protocol: ds-harness-remote `docs/device-pairing-v1.md`. Every mobile POST
 * carries `X-DSH-Pairing-Proof`, an HMAC over the exact JSON bytes sent.
 */
import { x25519 } from "@noble/curves/ed25519";
import { hkdf } from "@noble/hashes/hkdf";
import { hmac } from "@noble/hashes/hmac";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";
import { fromBase64Url, toBase64Url } from "@dsh-remote/crypto";
import { z } from "zod";

const encoder = new TextEncoder();
const key = z.string().regex(/^[A-Za-z0-9_-]{43}$/);

const deviceSchema = z.object({
  deviceId: z.string().min(1).max(128),
  name: z.string().max(128),
  role: z.enum(["host", "client"]),
  platform: z.string().max(32),
  identityKey: key,
  clientVersion: z.string().nullable().optional(),
  harnessVersion: z.string().nullable().optional(),
});

const sessionSchema = z.object({
  v: z.literal(1),
  sessionId: z.string().uuid(),
  expiresAt: z.number().int().positive(),
  serverPublicKey: key,
  scanSecret: key,
  host: deviceSchema,
});

const tokensSchema = z.object({
  accessToken: z.string().min(16),
  accessTokenExpiresAt: z.number().int().positive(),
  refreshToken: z.string().min(16),
  refreshTokenExpiresAt: z.number().int().positive(),
});

const credentialsSchema = z.object({
  account: z.string().min(1).max(254),
  accountKind: z.enum(["standard", "device_only"]),
  device: deviceSchema,
  inboundOnly: z.boolean(),
  pairingRestricted: z.boolean(),
  tokens: tokensSchema,
});

const claimedSchema = z.object({
  state: z.literal("claimed"),
  verificationCode: z.string().regex(/^\d{8}$/),
  expiresAt: z.number().int().positive(),
});

const statusSchema = z.object({
  state: z.enum(["created", "claimed", "approved", "completed", "failed", "cancelled", "expired"]),
  host: deviceSchema.optional(),
  credentials: credentialsSchema.nullable().optional(),
  failureReason: z.string().nullable().optional(),
});

const errorSchema = z.object({ error: z.object({ code: z.string(), message: z.string().optional() }) });

export type PairingDevice = z.infer<typeof deviceSchema>;
export type PairingSession = z.infer<typeof sessionSchema>;
export type PairingCredentials = z.infer<typeof credentialsSchema>;
export type PairingTokens = z.infer<typeof tokensSchema>;
export type PairingState = z.infer<typeof statusSchema>["state"];

/** What a scanned code names: the server to ask and the ticket it issued. */
export interface PairingTicket {
  serverUrl: string;
  ticket: string;
}

export interface PairingStatus {
  state: PairingState;
  credentials: PairingCredentials | null;
  failureReason: string | null;
}

/** This phone's identity on one server: an X25519 key pair (base64url). */
export interface PhoneIdentity {
  deviceId: string;
  name: string;
  publicKey: string;
  privateKey: string;
}

const TICKET = /^v1\.([A-Za-z0-9_-]{43})$/;

/**
 * Read `https://<server>/pair#v1.<ticket>` strictly: an https origin (http only
 * for loopback and LAN development), path exactly `/pair`, no user info or query.
 * Undefined for anything else, so another code is never mistaken for one.
 */
export function parsePairingTicket(text: string): PairingTicket | undefined {
  if (text.length > 2048) return undefined;
  let url: URL;
  try {
    url = new URL(text.trim());
  } catch {
    return undefined;
  }
  const local = /^(localhost|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+)$/.test(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) return undefined;
  if (url.username !== "" || url.password !== "" || url.search !== "" || url.pathname !== "/pair") return undefined;
  const match = TICKET.exec(url.hash.slice(1));
  if (match === null) return undefined;
  const ticket = match[1]!;
  // Canonical base64url of exactly 32 bytes.
  let bytes: Uint8Array;
  try {
    bytes = fromBase64Url(ticket);
  } catch {
    return undefined;
  }
  if (bytes.length !== 32 || toBase64Url(bytes) !== ticket) return undefined;
  return { serverUrl: url.origin, ticket };
}

/**
 * `X-DSH-Pairing-Proof` for one mobile POST: HMAC-SHA256 under a key the
 * phone and server both derive from X25519 and the session id, over the method,
 * path and SHA-256 of the exact body text.
 */
export function pairingProof(phonePrivateKey: string, serverPublicKey: string, sessionId: string, path: string, body: string): string {
  const shared = x25519.getSharedSecret(fromBase64Url(phonePrivateKey), fromBase64Url(serverPublicKey));
  const proofKey = hkdf(sha256, shared, encoder.encode(sessionId), encoder.encode("dsh-pairing-v1/mobile"), 32);
  const message = encoder.encode(`POST\n${path}\n${bytesToHex(sha256(encoder.encode(body)))}`);
  return toBase64Url(hmac(sha256, proofKey, message));
}

/** The fingerprint both screens show for an identity key: lowercase hex SHA-256. */
export function keyFingerprint(identityKey: string): string {
  return bytesToHex(sha256(fromBase64Url(identityKey)));
}

export class PairingError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "PairingError";
    this.code = code;
  }
}

async function post(serverUrl: string, path: string, body: string, proof?: string): Promise<unknown> {
  const response = await fetch(`${serverUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(proof === undefined ? {} : { "x-dsh-pairing-proof": proof }) },
    body,
  });
  const text = await response.text();
  let json: unknown = undefined;
  try {
    json = text === "" ? {} : JSON.parse(text);
  } catch {
    // Not JSON; reported below.
  }
  if (!response.ok) {
    const error = errorSchema.safeParse(json);
    throw new PairingError(
      error.success ? error.data.error.code : `HTTP_${response.status}`,
      error.success ? (error.data.error.message ?? error.data.error.code) : text || `HTTP ${response.status}`,
    );
  }
  return json;
}

function parse<T>(schema: z.ZodType<T>, value: unknown, what: string): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new PairingError("INVALID_RESPONSE", `The server sent an invalid ${what}.`);
  return result.data;
}

/** Look the ticket up. Read-only on the server; safe to repeat. */
export async function resolvePairing(ticket: PairingTicket): Promise<PairingSession> {
  const session = parse(sessionSchema, await post(ticket.serverUrl, "/api/v1/device-pairing/resolve", JSON.stringify({ ticket: ticket.ticket })), "pairing session");
  if (session.scanSecret !== ticket.ticket || session.host.role !== "host") {
    throw new PairingError("INVALID_RESPONSE", "The server answered with a different pairing session.");
  }
  if (session.expiresAt <= Date.now()) throw new PairingError("PAIRING_EXPIRED", "This pairing code has expired. Show a new one on the computer.");
  return session;
}

/**
 * Claim the session for this phone. Returns the 8-digit code the computer must
 * enter, and the request body: a lost response is recovered by sending exactly
 * the same bytes again.
 */
export async function claimPairing(
  serverUrl: string,
  session: PairingSession,
  phone: PhoneIdentity,
  clientVersion: string,
  body?: string,
): Promise<{ verificationCode: string; expiresAt: number; body: string }> {
  const path = `/api/v1/device-pairing/sessions/${session.sessionId}/claim`;
  const raw =
    body ??
    JSON.stringify({
      scanSecret: session.scanSecret,
      device: { deviceId: phone.deviceId, name: phone.name, role: "client", platform: "android", identityKey: phone.publicKey, clientVersion },
    });
  const proof = pairingProof(phone.privateKey, session.serverPublicKey, session.sessionId, path, raw);
  const claimed = parse(claimedSchema, await post(serverUrl, path, raw, proof), "claim answer");
  return { verificationCode: claimed.verificationCode, expiresAt: claimed.expiresAt, body: raw };
}

/** Ask where the pairing stands. Credentials arrive with `completed`. */
export async function pairingStatus(serverUrl: string, session: PairingSession, phone: PhoneIdentity): Promise<PairingStatus> {
  const path = `/api/v1/device-pairing/sessions/${session.sessionId}/mobile/status`;
  const proof = pairingProof(phone.privateKey, session.serverPublicKey, session.sessionId, path, "{}");
  const status = parse(statusSchema, await post(serverUrl, path, "{}", proof), "pairing status");
  // The host must stay the one the code named: a swapped key fails closed.
  if (status.host !== undefined && (status.host.deviceId !== session.host.deviceId || status.host.identityKey !== session.host.identityKey)) {
    throw new PairingError("HOST_CHANGED", "The computer's identity changed during pairing.");
  }
  const credentials = status.state === "completed" ? (status.credentials ?? null) : null;
  if (status.state === "completed" && (credentials === null || credentials.device.deviceId !== phone.deviceId || credentials.device.identityKey !== phone.publicKey)) {
    throw new PairingError("INVALID_RESPONSE", "The pairing completed without credentials for this phone.");
  }
  return { state: status.state, credentials, failureReason: status.failureReason ?? null };
}

export async function cancelPairing(serverUrl: string, session: PairingSession, phone: PhoneIdentity): Promise<void> {
  const path = `/api/v1/device-pairing/sessions/${session.sessionId}/mobile/cancel`;
  await post(serverUrl, path, "{}", pairingProof(phone.privateKey, session.serverPublicKey, session.sessionId, path, "{}"));
}
