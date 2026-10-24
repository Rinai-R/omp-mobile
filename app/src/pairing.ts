/**
 * The daemon's pairing URI, `omp-mobile://pair?url=<base url>&token=<token>`,
 * as printed (and drawn as a QR code) when it starts. A scanned or tapped code
 * is untrusted input: it is parsed by hand rather than by a URL parser, so no
 * normalization can turn it into a different address, and its address must be
 * on the tailnet, since that is the only network the daemon is meant to serve.
 */
import { t } from "./i18n/index.ts";

export interface Pairing {
  /** The daemon base URL: scheme, lowercased host and optional port, no slash. */
  url: string;
  token: string;
}

export type PairingProblem = "not-pairing" | "bad-address" | "not-tailnet" | "missing-token";

export type PairingResult = ({ ok: true } & Pairing) | { ok: false; problem: PairingProblem; host?: string };

const PREFIX = /^omp-mobile:\/\/pair\/?\?/i;
/** `http(s)://host[:port]`, an optional trailing slash and nothing else. */
const ADDRESS = /^(https?):\/\/([a-z0-9.-]+)(?::([0-9]{1,5}))?\/?$/i;
const TS_NET = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+ts\.net$/i;

/** Whether the text is meant as a pairing link, valid or not. */
export function isPairingLink(input: string): boolean {
  return PREFIX.test(input.trim());
}

/**
 * Whether a host is on a tailnet: a Tailscale CGNAT IPv4 address in
 * 100.64.0.0/10 (100.64.0.0 to 100.127.255.255) or a MagicDNS `*.ts.net` name.
 */
export function isTailnetHost(host: string): boolean {
  const octets = host.split(".");
  if (octets.length === 4 && octets.every((part) => /^[0-9]+$/.test(part))) {
    // Plain dotted decimal only: no leading zeros, every octet a byte.
    if (octets.some((part) => !/^(?:0|[1-9][0-9]{0,2})$/.test(part) || Number(part) > 255)) return false;
    const second = Number(octets[1]);
    return octets[0] === "100" && second >= 64 && second <= 127;
  }
  return TS_NET.test(host);
}

function decode(value: string): string | null {
  try {
    return decodeURIComponent(value.replace(/\+/g, " "));
  } catch {
    return null;
  }
}

/** Parse a pairing URI, saying why it is refused when it is. */
export function readPairing(input: string): PairingResult {
  const value = input.trim();
  const prefix = PREFIX.exec(value);
  if (prefix === null) return { ok: false, problem: "not-pairing" };
  const params = new Map<string, string>();
  for (const part of value.slice(prefix[0].length).split(/[&#]/)) {
    if (part === "") continue;
    const equals = part.indexOf("=");
    const key = decode(equals === -1 ? part : part.slice(0, equals));
    const text = decode(equals === -1 ? "" : part.slice(equals + 1));
    if (key === null || text === null) return { ok: false, problem: "not-pairing" };
    // A repeated key is ambiguous: which address would the phone trust?
    if (params.has(key)) return { ok: false, problem: "not-pairing" };
    params.set(key, text);
  }
  const base = params.get("url") ?? "";
  const address = ADDRESS.exec(base);
  if (address === null) return { ok: false, problem: "bad-address" };
  const [, scheme = "", rawHost = "", portText] = address;
  const host = rawHost.toLowerCase();
  if (portText !== undefined) {
    const port = Number(portText);
    if (port < 1 || port > 65535) return { ok: false, problem: "bad-address" };
  }
  if (!isTailnetHost(host)) return { ok: false, problem: "not-tailnet", host };
  const token = (params.get("token") ?? "").trim();
  if (token === "") return { ok: false, problem: "missing-token" };
  const port = portText === undefined ? "" : `:${Number(portText)}`;
  return { ok: true, url: `${scheme.toLowerCase()}://${host}${port}`, token };
}

/** A valid pairing URI's address and token, or null. */
export function parsePairing(input: string): Pairing | null {
  const result = readPairing(input);
  return result.ok ? { url: result.url, token: result.token } : null;
}

/** What to tell the user about a refused pairing code. */
export function pairingMessage(problem: PairingProblem, host?: string): string {
  switch (problem) {
    case "not-pairing":
      return t("pairing.notPairing");
    case "bad-address":
      return t("pairing.badAddress");
    case "not-tailnet":
      return t("pairing.notTailnet", { host: host ?? t("pairing.thisAddress") });
    case "missing-token":
      return t("pairing.missingToken");
  }
}

/** Normalize what a user typed into a daemon base URL. */
export function normalizeUrl(input: string): string {
  let value = input.trim();
  if (value === "") throw new Error(t("pairing.enterAddress"));
  if (!/^https?:\/\//i.test(value)) value = `http://${value}`;
  const url = new URL(value);
  if (url.pathname !== "/" && url.pathname !== "") throw new Error(t("pairing.baseOnly"));
  return `${url.protocol}//${url.host}`;
}
