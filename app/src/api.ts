import type { Hello, Machine, SessionOwner, SessionSummary, ServerMessage, Transcript } from "./types";
import { heldQuery, type Held } from "./cache.ts";
import { t } from "./i18n/index.ts";
import { ownerOf } from "./takeover.ts";

const JSON_HEADERS = { "content-type": "application/json" };
/** How long a session socket may go without a frame before it is treated as dead. */
const SILENCE_MS = 60_000;

async function request<T>(machine: Machine, path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${machine.url}${path}`, {
    ...init,
    headers: {
      ...(init.body === undefined ? {} : JSON_HEADERS),
      authorization: `Bearer ${machine.token}`,
      ...(init.headers ?? {}),
    },
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new HttpError(response.status, errorText(text) || `HTTP ${response.status}`, ownerOf(errorField(text, "owner")));
  }
  return (await response.json()) as T;
}

/** The daemon answered, with an error status: its reason and the status. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    /** For a 409: the omp process that holds the session. */
    readonly owner?: SessionOwner,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

/** Each machine's features as `/hello` last listed them, for code that cannot wait for another request. */
const featureMemo = new Map<string, string[]>();

/** The daemon's optional features from `/hello`; empty for daemons that predate them or cannot be reached. */
export async function daemonFeatures(machine: Machine): Promise<string[]> {
  try {
    const response = await fetch(`${machine.url}/hello`);
    if (!response.ok) return [];
    const data = (await response.json()) as Hello;
    const features = Array.isArray(data.features) ? data.features.filter((feature) => typeof feature === "string") : [];
    featureMemo.set(machine.url, features);
    return features;
  } catch {
    return [];
  }
}

/** The features this machine's daemon listed last time it was asked in this launch; empty until then. */
export function knownFeatures(machine: Machine): string[] {
  return featureMemo.get(machine.url) ?? [];
}

/**
 * A session's transcript without starting an omp (`transcript-sync`): only
 * the messages after `held` when the phone's copy lines up. `null` when the
 * daemon has none to give (a 404: the session's omp is not running and no
 * saved copy matches its file).
 */
export async function fetchTranscript(machine: Machine, id: string, held: Held | undefined): Promise<Transcript | null> {
  const query = heldQuery(held);
  try {
    return await request<Transcript>(machine, `/sessions/${encodeURIComponent(id)}/transcript${query === "" ? "" : `?${query}`}`);
  } catch (error) {
    if (error instanceof HttpError && error.status === 404) return null;
    throw error;
  }
}

/** One field of a JSON error answer. */
function errorField(body: string, field: string): unknown {
  try {
    return (JSON.parse(body) as Record<string, unknown>)[field];
  } catch {
    return undefined;
  }
}

/** The daemon answers errors as `{"error": "..."}`; anything else is shown as sent. */
function errorText(body: string): string {
  try {
    const parsed = JSON.parse(body) as { error?: unknown };
    if (typeof parsed.error === "string") return parsed.error;
  } catch {
    // Not JSON.
  }
  return body;
}

export async function hello(url: string, token: string): Promise<Hello> {
  const response = await fetch(`${url}/hello`);
  if (!response.ok) throw new Error(t("api.http", { status: response.status }));
  const data = (await response.json()) as Hello;
  if (data.protocol !== 1) throw new Error(t("api.protocol", { protocol: String(data.protocol) }));
  // /hello is public; this verifies the token before the machine is saved.
  await request<{ sessions: SessionSummary[] }>({ id: url, url, token, name: data.name, os: data.os, version: data.version, cwd: data.cwd }, "/sessions");
  return data;
}

/**
 * Check a daemon and build the machine to save: the one add path shared by the
 * manual sheet, the QR scanner and pairing links. Refuses a machine already in `machines`.
 */
export async function pairMachine(url: string, token: string, machines: readonly Machine[]): Promise<Machine> {
  const secret = token.trim();
  if (secret === "") throw new Error(t("api.enterToken"));
  if (machines.some((machine) => machine.url === url)) throw new Error(t("api.duplicate"));
  const info = await hello(url, secret);
  return {
    id: url,
    url,
    token: secret,
    name: info.name,
    os: info.os,
    version: info.version,
    cwd: info.cwd,
    lastSeen: Date.now(),
  };
}

export async function listSessions(machine: Machine): Promise<SessionSummary[]> {
  const data = await request<{ sessions: SessionSummary[] }>(machine, "/sessions");
  return data.sessions;
}

export async function createSession(machine: Machine, cwd?: string): Promise<SessionSummary> {
  const data = await request<{ session: SessionSummary }>(machine, "/sessions", {
    method: "POST",
    body: JSON.stringify(cwd === undefined || cwd.trim() === "" ? {} : { cwd: cwd.trim() }),
  });
  return data.session;
}

export async function deleteSession(machine: Machine, id: string): Promise<void> {
  await request<{ ok: true }>(machine, `/sessions/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function openSession(machine: Machine, id: string): Promise<void> {
  await request<unknown>(machine, `/sessions/${encodeURIComponent(id)}`);
}

/**
 * Ask the daemon to take a session over from the omp process that holds it
 * (it closes that process, gracefully), then open it. Resolves once the session is the daemon's.
 */
export async function takeOverSession(machine: Machine, id: string): Promise<void> {
  await request<unknown>(machine, `/sessions/${encodeURIComponent(id)}/takeover`, {
    method: "POST",
    body: JSON.stringify({ device: "OMP Mobile" }),
  });
}

/** Why a session socket gave up: the daemon's own answer, as `open_failed` carries it. */
export interface OpenFailure {
  status: number;
  error: string;
  /** For a 409 from a daemon that offers takeover: the process that holds the session. */
  owner?: SessionOwner;
}

/**
 * Live socket for one session. It reconnects with backoff while the link
 * drops, until the caller closes it, or until the daemon says the session
 * cannot open (`open_failed`): then it waits for `retry()`, since reconnecting
 * cannot fix that.
 */
export class SessionSocket {
  private socket: WebSocket | undefined;
  private closed = false;
  private failed = false;
  private retry = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  /** Connection attempts since the last open; the screen asks over HTTP why after a few. */
  private attempts = 0;
  /** When the last frame arrived; 0 until one does (or while a newer socket replaces this one). */
  private lastFrame = 0;
  private watchdog: ReturnType<typeof setInterval> | undefined;

  constructor(
    private readonly machine: Machine,
    private readonly sessionId: string,
    private readonly onMessage: (message: ServerMessage) => void,
    private readonly onOpen: () => void,
    private readonly onClose: (attempts: number) => void,
    private readonly onFailed: (failure: OpenFailure) => void = () => undefined,
    /** The socket upgraded: the link is up, the daemon may still be starting the session. */
    private readonly onLink: () => void = () => undefined,
    /**
     * What the phone holds of the transcript, asked at every connect: the
     * daemon then sends a snapshot of only what is new (`transcript-sync`).
     */
    private readonly held: () => Held | undefined = () => undefined,
  ) {}

  connect(): void {
    if (this.closed || this.failed) return;
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
    const base = this.machine.url.replace(/^http/i, "ws");
    const query = heldQuery(this.held());
    const url = `${base}/sessions/${encodeURIComponent(this.sessionId)}/ws?token=${encodeURIComponent(this.machine.token)}${query === "" ? "" : `&${query}`}`;
    const previous = this.socket;
    if (previous !== undefined) {
      previous.onclose = null;
      previous.onmessage = null;
      previous.close();
    }
    this.attempts += 1;
    const socket = new WebSocket(url);
    this.socket = socket;
    let opened = false;
    socket.onmessage = (event) => {
      this.lastFrame = Date.now();
      let message: ServerMessage;
      try {
        message = JSON.parse(String(event.data)) as ServerMessage;
      } catch {
        // A malformed frame must not kill the connection.
        return;
      }
      if (message.type === "open_failed") {
        this.failed = true;
        this.onFailed({ status: message.status, error: message.error, owner: ownerOf(message.owner) });
        return;
      }
      if (!opened && message.type === "snapshot") {
        // Open means the session answered, not just that the upgrade went through.
        opened = true;
        this.retry = 0;
        this.attempts = 0;
        this.onOpen();
      }
      this.onMessage(message);
    };
    socket.onopen = () => {
      this.lastFrame = Date.now();
      this.onLink();
    };
    socket.onerror = () => undefined;
    socket.onclose = () => {
      if (this.socket !== socket) return;
      this.socket = undefined;
      if (this.closed || this.failed) return;
      this.onClose(this.attempts);
      this.retry = Math.min(this.retry + 1, 5);
      this.timer = setTimeout(() => this.connect(), 500 * 2 ** (this.retry - 1));
    };
  }

  /** Stop reconnecting because the session cannot open; `reconnect()` resumes. */
  fail(): void {
    this.failed = true;
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
  }

  /** Try again after a failure, or now instead of at the end of the backoff. */
  reconnect(): void {
    if (this.closed) return;
    this.failed = false;
    this.retry = 0;
    if (this.socket?.readyState === WebSocket.OPEN) return;
    this.connect();
  }

  /** Open a new socket now, even over a working one: a snapshot that did not fit is asked for again. */
  restart(): void {
    if (this.closed) return;
    this.failed = false;
    this.retry = 0;
    this.connect();
  }

  get isOpen(): boolean {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  send(message: object): boolean {
    if (this.socket?.readyState !== WebSocket.OPEN) return false;
    this.socket.send(JSON.stringify(message));
    return true;
  }

  /**
   * Treat a link that sends nothing for a minute as gone: the daemon beats
   * every 20 s (`heartbeat` feature), so silence means the socket died under a
   * NAT or a doze, not that the session is quiet. The close handler reconnects.
   */
  watchSilence(): void {
    if (this.watchdog !== undefined) return;
    this.watchdog = setInterval(() => {
      if (this.closed || this.failed) return;
      if (this.socket?.readyState === WebSocket.OPEN && this.lastFrame > 0 && Date.now() - this.lastFrame > SILENCE_MS) {
        this.socket.close();
      }
    }, 10_000);
  }

  close(): void {
    this.closed = true;
    if (this.watchdog !== undefined) clearInterval(this.watchdog);
    this.watchdog = undefined;
    if (this.timer !== undefined) clearTimeout(this.timer);
    const socket = this.socket;
    this.socket = undefined;
    if (socket !== undefined) {
      socket.onclose = null;
      socket.close();
    }
  }
}
