/**
 * Whether the phone reaches a machine over its one link, Tailscale, and the
 * one-line words its row and sheet say about it (`summaryOf`).
 *
 * Only type imports here: node:test loads this file directly.
 */
import { fetchSessions } from "./sessionsFetch.ts";
import type { Machine, SessionSummary } from "./types";
import { t } from "./i18n/index.ts";

/** Why the daemon could not be used. */
export type Reason = "timeout" | "unauthorized" | "not-omp" | "network";

export type Probe =
  | {
      state: "online";
      /** Round trip of `GET /hello`. */
      latencyMs: number;
      sessionCount: number;
      /** Sessions whose status is "streaming". */
      running: number;
      name: string;
      version: string;
    }
  | { state: "unreachable"; reason: Reason };

/** A state dot's tone: working, not working, or not known yet. */
export type Dot = "online" | "down" | "checking";

export const PROBE_TIMEOUT_MS = 6_000;

export interface ProbeOptions {
  /** Per-request timeout; defaults to 6 s. */
  timeoutMs?: number;
  /** Clock for the latency; defaults to `Date.now`. */
  now?: () => number;
}

/** Thrown inside the probe to classify a failure. */
class ProbeFailure extends Error {
  readonly reason: Reason;

  constructor(reason: Reason) {
    super(reason);
    this.reason = reason;
  }
}

async function get(url: string, timeoutMs: number, headers?: Record<string, string>): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, headers === undefined ? { signal: controller.signal } : { headers, signal: controller.signal });
  } catch (cause) {
    const aborted =
      controller.signal.aborted || (cause instanceof Error && (cause.name === "AbortError" || cause.name === "TimeoutError"));
    throw new ProbeFailure(aborted ? "timeout" : "network");
  } finally {
    clearTimeout(timer);
  }
}

/** A shared request, given up on (not aborted: another caller may still want it) after `timeoutMs`. */
async function within<T>(request: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new ProbeFailure("timeout")), timeoutMs);
  });
  try {
    return await Promise.race([request, timeout]);
  } catch (cause) {
    throw cause instanceof ProbeFailure ? cause : new ProbeFailure("network");
  } finally {
    clearTimeout(timer);
  }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ProbeFailure("not-omp");
  }
}

async function json(response: Response): Promise<unknown> {
  try {
    return (await response.json()) as unknown;
  } catch {
    throw new ProbeFailure("not-omp");
  }
}

function isHello(value: unknown): value is { name: string; version: string; protocol: 1 } {
  if (value === null || typeof value !== "object") return false;
  const hello = value as Record<string, unknown>;
  return hello.protocol === 1 && typeof hello.name === "string" && typeof hello.version === "string";
}

function sessionsOf(value: unknown): SessionSummary[] | null {
  if (value === null || typeof value !== "object") return null;
  const sessions = (value as { sessions?: unknown }).sessions;
  return Array.isArray(sessions) ? (sessions as SessionSummary[]) : null;
}

/**
 * Probe one machine: `GET /hello` (public), then `GET /sessions` with its token.
 * Never throws; every failure is an unreachable probe with its reason.
 */
export async function probeMachine(
  machine: Pick<Machine, "url" | "token">,
  options: ProbeOptions = {},
): Promise<Probe> {
  const timeoutMs = options.timeoutMs ?? PROBE_TIMEOUT_MS;
  const now = options.now ?? Date.now;
  try {
    const started = now();
    const helloResponse = await get(`${machine.url}/hello`, timeoutMs);
    const latencyMs = Math.max(0, Math.round(now() - started));
    if (helloResponse.status !== 200) throw new ProbeFailure("not-omp");
    const hello = await json(helloResponse);
    if (!isHello(hello)) throw new ProbeFailure("not-omp");

    // Shared with the home's own list request when both ask at once.
    const sessionsAnswer = await within(fetchSessions(machine.url, machine.token), timeoutMs);
    if (sessionsAnswer.status === 401 || sessionsAnswer.status === 403) throw new ProbeFailure("unauthorized");
    if (!sessionsAnswer.ok) throw new ProbeFailure("not-omp");
    const sessions = sessionsOf(parseJson(sessionsAnswer.text));
    if (sessions === null) throw new ProbeFailure("not-omp");

    return {
      state: "online",
      latencyMs,
      sessionCount: sessions.length,
      running: sessions.filter((session) => session?.status === "streaming").length,
      name: hello.name,
      version: hello.version,
    };
  } catch (cause) {
    return { state: "unreachable", reason: cause instanceof ProbeFailure ? cause.reason : "network" };
  }
}

/** Why a machine is unreachable, in a word or two. */
export function reasonText(reason: Reason): string {
  switch (reason) {
    case "timeout":
      return t("probe.timeout");
    case "unauthorized":
      return t("probe.unauthorized");
    case "not-omp":
      return t("probe.notOmp");
    case "network":
      return t("probe.network");
  }
}

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** How long ago, in words: "just now", "5 min ago", "3 h ago", "2 d ago". */
export function agoText(time: number, now: number): string {
  const elapsed = Math.max(0, now - time);
  if (elapsed < MINUTE_MS) return t("ago.now");
  if (elapsed < HOUR_MS) return t("ago.minutes", { count: Math.floor(elapsed / MINUTE_MS) });
  if (elapsed < 2 * DAY_MS) return t("ago.hours", { count: Math.floor(elapsed / HOUR_MS) });
  return t("ago.days", { count: Math.floor(elapsed / DAY_MS) });
}

/** @returns the dot of a probe; undefined is a machine not probed yet. */
export function dotOf(probe: Probe | undefined): Dot {
  if (probe === undefined) return "checking";
  return probe.state === "online" ? "online" : "down";
}

function sessionsText(probe: Extract<Probe, { state: "online" }>): string {
  if (probe.running > 0) return t("common.running", { count: probe.running });
  if (probe.sessionCount === 0) return t("probe.noSessions");
  return t("probe.sessions", { count: probe.sessionCount });
}

/**
 * A machine row's dot and one line: the link and its sessions when online,
 * "Checking…" before the first probe, else why it is unreachable and when it
 * was last seen.
 */
export function summaryOf(
  probe: Probe | undefined,
  lastSeen: number | undefined,
  now: number,
): { dot: Dot; text: string } {
  if (probe === undefined) return { dot: "checking", text: t("probe.checking") };
  if (probe.state === "online") return { dot: "online", text: `Tailscale · ${sessionsText(probe)}` };
  const reason = reasonText(probe.reason);
  return {
    dot: "down",
    text: lastSeen === undefined ? reason : t("probe.seen", { reason, ago: agoText(lastSeen, now) }),
  };
}

/** The sheet's link line: "Online · 34 ms", "Unreachable: No reply", or "Checking…". */
export function linkText(probe: Probe | undefined): string {
  if (probe === undefined) return t("probe.checking");
  if (probe.state === "online") return t("probe.online", { ms: probe.latencyMs });
  return t("probe.unreachable", { reason: reasonText(probe.reason) });
}
