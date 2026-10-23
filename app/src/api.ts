import type { Hello, Machine, SessionSummary, ServerMessage } from "./types";

const JSON_HEADERS = { "content-type": "application/json" };

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
    throw new Error(errorText(text) || `HTTP ${response.status}`);
  }
  return (await response.json()) as T;
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
  if (!response.ok) throw new Error(`The daemon answered HTTP ${response.status}`);
  const data = (await response.json()) as Hello;
  if (data.protocol !== 1) throw new Error(`Unsupported daemon protocol ${data.protocol}`);
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
  if (secret === "") throw new Error("Enter the daemon token");
  if (machines.some((machine) => machine.url === url)) throw new Error("This machine is already in the list");
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

/** Live socket for one session; reconnects until closed by the caller. */
export class SessionSocket {
  private socket: WebSocket | undefined;
  private closed = false;
  private retry = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly machine: Machine,
    private readonly sessionId: string,
    private readonly onMessage: (message: ServerMessage) => void,
    private readonly onOpen: () => void,
    private readonly onClose: () => void,
  ) {}

  connect(): void {
    if (this.closed) return;
    const base = this.machine.url.replace(/^http/i, "ws");
    const url = `${base}/sessions/${encodeURIComponent(this.sessionId)}/ws?token=${encodeURIComponent(this.machine.token)}`;
    const socket = new WebSocket(url);
    this.socket = socket;
    socket.onopen = () => {
      this.retry = 0;
      this.onOpen();
    };
    socket.onmessage = (event) => {
      try {
        this.onMessage(JSON.parse(String(event.data)) as ServerMessage);
      } catch {
        // A malformed frame must not kill the connection.
      }
    };
    socket.onerror = () => undefined;
    socket.onclose = () => {
      this.onClose();
      if (this.closed) return;
      this.retry = Math.min(this.retry + 1, 6);
      this.timer = setTimeout(() => this.connect(), 500 * 2 ** (this.retry - 1));
    };
  }

  send(message: object): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message));
  }

  close(): void {
    this.closed = true;
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.socket?.close();
    this.socket = undefined;
  }
}
