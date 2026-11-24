/**
 * Account sign-in on a ds-harness-remote relay, beyond the password: the OAuth
 * providers the server offers (signed in through the browser, collected by
 * polling), and the one-time code a signed-in phone makes so a computer can
 * join the same account without a password of its own.
 *
 * Protocol: ds-harness-remote `docs/plugin-integration.md` §3.2 (OAuth, QR
 * session) and §5.2 (host registration codes).
 */
import { z } from "zod";

/** The public relay of ds-harness-remote, which the computer side also defaults to. */
export const DEFAULT_RELAY = "https://dsh.r2049.cn";

export class RelayAccountError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "RelayAccountError";
    this.status = status;
    this.code = code;
  }
}

/** Whether the server has no such endpoint (an older or a minimal self-hosted relay). */
export function unsupported(error: unknown): boolean {
  return error instanceof RelayAccountError && (error.status === 404 || error.status === 405 || error.status === 501);
}

/** Whether the account token is missing, expired or refused: signing in again fixes it. */
export function signInNeeded(error: unknown): boolean {
  return error instanceof RelayAccountError && (error.status === 401 || error.status === 403);
}

const envelope = z.object({ error: z.object({ code: z.string(), message: z.string().optional() }) });

async function call(serverUrl: string, path: string, init: { method?: string; token?: string; body?: unknown } = {}): Promise<unknown> {
  const response = await fetch(`${serverUrl}${path}`, {
    method: init.method ?? "GET",
    headers: {
      accept: "application/json",
      ...(init.body === undefined ? {} : { "content-type": "application/json" }),
      ...(init.token === undefined ? {} : { authorization: `Bearer ${init.token}` }),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const text = await response.text();
  let json: unknown;
  try {
    json = text === "" ? {} : JSON.parse(text);
  } catch {
    json = undefined;
  }
  if (!response.ok) {
    const error = envelope.safeParse(json);
    throw new RelayAccountError(
      response.status,
      error.success ? error.data.error.code : `HTTP_${response.status}`,
      error.success ? (error.data.error.message ?? error.data.error.code) : `HTTP ${response.status}`,
    );
  }
  if (json === undefined) throw new RelayAccountError(response.status, "INVALID_RESPONSE", `${path}: not JSON`);
  return json;
}

function parse<T>(schema: z.ZodType<T>, value: unknown, what: string): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new RelayAccountError(200, "INVALID_RESPONSE", `The relay sent an invalid ${what}.`);
  return result.data;
}

/**
 * An entry path the server hands out: under its own `/api/v1/auth/`, nothing
 * that leaves the server (no scheme, no `//`, no `..`, no control characters).
 */
export function isAuthPath(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.startsWith("/api/v1/auth/") &&
    !value.includes("//") &&
    !value.split(/[/?#]/).includes("..") &&
    !/[\u0000-\u001f\u007f\\]/.test(value)
  );
}

/** A sign-in the relay offers through the browser (GitHub, Google, ...): its own id and name. */
export interface OAuthProvider {
  id: string;
  name: string;
  /** Where a browser-collected sign-in starts (`POST`), relative to the server. */
  start: string;
}

const providersSchema = z.object({ items: z.array(z.unknown()) });

/**
 * The browser sign-ins `serverUrl` offers, in its order. Only those it can
 * hand over by polling (a `qrStartUrl`): the phone opens the page and collects
 * the result itself. Empty on a relay without any (a minimal self-hosted one).
 */
export async function oauthProviders(serverUrl: string): Promise<OAuthProvider[]> {
  let body: unknown;
  try {
    body = await call(serverUrl, "/api/v1/auth/oauth/providers");
  } catch (error) {
    if (unsupported(error)) return [];
    throw error;
  }
  const seen = new Set<string>();
  return parse(providersSchema, body, "list of sign-ins").items.flatMap((item) => {
    if (item === null || typeof item !== "object") return [];
    const { id, displayName, qrStartUrl } = item as Record<string, unknown>;
    if (typeof id !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(id) || seen.has(id)) return [];
    if (typeof displayName !== "string" || displayName.trim() === "" || displayName.length > 128 || /[\u0000-\u001f\u007f]/.test(displayName)) return [];
    if (!isAuthPath(qrStartUrl)) return [];
    seen.add(id);
    return [{ id, name: displayName.trim(), start: qrStartUrl }];
  });
}

/** A browser sign-in under way: the page to open and the session to collect from. */
export interface OAuthSession {
  id: string;
  /** The sign-in page, on the relay's own origin. */
  page: string;
  expiresAt: number;
}

const sessionSchema = z.object({ qrId: z.string().min(20), scanUrl: z.string(), expiresIn: z.number().int().positive() });

/** The page must be the relay's own: a sign-in never sends the phone anywhere else first. */
export function sameOriginPage(serverUrl: string, page: string): string | undefined {
  try {
    const url = new URL(page, serverUrl);
    return url.origin === new URL(serverUrl).origin && (url.protocol === "https:" || url.protocol === "http:") ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

export async function startOAuth(serverUrl: string, provider: OAuthProvider): Promise<OAuthSession> {
  const session = parse(sessionSchema, await call(serverUrl, provider.start, { method: "POST", body: {} }), "sign-in session");
  const page = sameOriginPage(serverUrl, session.scanUrl);
  if (page === undefined) throw new RelayAccountError(200, "INVALID_RESPONSE", "The relay sent a sign-in page on another site.");
  return { id: session.qrId, page, expiresAt: Date.now() + session.expiresIn * 1000 };
}

const resultSchema = z.union([
  z.object({ status: z.enum(["pending", "expired"]) }),
  z.object({ status: z.literal("complete"), token: z.string().min(16) }),
]);

/** Where a browser sign-in stands; `complete` carries the account token, handed out once. */
export async function oauthResult(serverUrl: string, session: OAuthSession): Promise<{ status: "pending" | "expired" } | { status: "complete"; token: string }> {
  const result = parse(resultSchema, await call(serverUrl, `/api/v1/auth/oauth/qr/${encodeURIComponent(session.id)}`), "sign-in status");
  if (result.status === "pending" && Date.now() > session.expiresAt) return { status: "expired" };
  return result;
}

const meSchema = z.object({ account: z.string().min(1).max(254) });

/** The account an account token belongs to. */
export async function accountOf(serverUrl: string, token: string): Promise<string> {
  return parse(meSchema, await call(serverUrl, "/api/v1/auth/me", { token }), "account").account;
}

const codeSchema = z.object({ code: z.string().regex(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/), expiresAt: z.number().int().positive() });

/**
 * A one-time code (`ABCD-EFGH`, ten minutes, one use) for a computer to join
 * this account: `/mobile login <code>` on it registers it with no password.
 * Making a new one voids the previous.
 */
export async function hostRegistrationCode(serverUrl: string, accountToken: string): Promise<{ code: string; expiresAt: number }> {
  return parse(codeSchema, await call(serverUrl, "/api/v1/account/host-registration-codes", { method: "POST", token: accountToken, body: {} }), "computer code");
}

/**
 * A self-hosted relay's address as typed: `https://` unless it says otherwise,
 * except a bare IP or localhost (a relay on the local network), which gets `http://`.
 * Only the origin is kept.
 */
export function relayUrl(input: string): string {
  let value = input.trim();
  if (!/^https?:\/\//i.test(value)) {
    const host = value.split(/[/:]/)[0] ?? "";
    value = `${/^(\d{1,3}\.){3}\d{1,3}$|^localhost$|^\[/i.test(host) ? "http" : "https"}://${value}`;
  }
  const url = new URL(value);
  return `${url.protocol}//${url.host}`;
}

/** The server's sign-ins with the one this reader most likely has first: 知乎 in Chinese, GitHub otherwise. */
export function preferredFirst(providers: readonly OAuthProvider[], language: "en" | "zh-CN"): OAuthProvider[] {
  const preferred = language === "zh-CN" ? "zhihu" : "github";
  return [...providers].sort((a, b) => Number(b.id === preferred) - Number(a.id === preferred));
}

/** What to type on the computer for `code`: the relay is named only when it is not the public one. */
export function joinCommands(serverUrl: string, code: string): { omp: string; terminal: string } {
  const relay = serverUrl === DEFAULT_RELAY ? "" : ` ${serverUrl}`;
  return { omp: `/mobile login ${code}${relay}`, terminal: `omp-mobile relay login ${code}${relay}` };
}
