/**
 * OMP sessions on a DSH Remote Host, behind the same calls and socket the app
 * uses for a daemon: list, create, and a live session socket that speaks the
 * daemon's frames (`ServerMessage`) while it drives ACP underneath.
 */
import type { AcpStream } from "@dsh-remote/client-core";
import type { ChatSocket, OpenFailure } from "../api";
import type { Held } from "../cache";
import type { Machine, ServerMessage, SessionState, SessionSummary } from "../types";
import { AcpTranslator, endsTurn, historyMessages, modelOptions, permissionRequest, type AcpOutput, type PendingApproval } from "./acp";
import type { RemoteHostConnection } from "./connection";
import { onRemoteClose, remoteConnection, remoteHost } from "./hosts";
import { RemoteServerError } from "./server";
import type { Probe } from "../probe";

/** Sessions per workspace asked for; the Host lists newest first. */
const PER_WORKSPACE = 50;

/** What a list last said about each session, for the snapshot a socket sends (ACP history carries no title). */
const summaries = new Map<string, SessionSummary>();

/**
 * Per Host connection and session: permission requests not yet answered. Watched
 * on the whole connection, not a chat's stream: the Host sends each request once,
 * by session, also while no chat follows it, and cancels them when the connection
 * goes (so they go with it).
 */
const approvals = new WeakMap<RemoteHostConnection, Map<string, Map<string, PendingApproval>>>();

function approvalsOf(connection: RemoteHostConnection, sessionId: string): Map<string, PendingApproval> {
  let sessions = approvals.get(connection);
  if (sessions === undefined) {
    const created = new Map<string, Map<string, PendingApproval>>();
    sessions = created;
    approvals.set(connection, created);
    connection.onFrame((id, method, params) => {
      const pending = created.get(id) ?? new Map<string, PendingApproval>();
      created.set(id, pending);
      if (method === "session/request_permission") {
        const request = permissionRequest(params);
        if (request !== undefined) pending.set(request.request.id, request);
        return;
      }
      // A turn that ended leaves nothing to approve.
      if (endsTurn(params)) pending.clear();
    });
  }
  let pending = sessions.get(sessionId);
  if (pending === undefined) {
    pending = new Map();
    sessions.set(sessionId, pending);
  }
  return pending;
}

function summaryKey(machine: Machine, id: string): string {
  return `${machine.id}\n${id}`;
}

function summaryOf(machine: Machine, id: string): SessionSummary {
  return summaries.get(summaryKey(machine, id)) ?? { id, title: "", cwd: "", status: "idle", createdAt: 0, updatedAt: 0, origin: "omp" };
}

/** Every OMP session the Host lists, across its workspaces, newest first. */
export async function listRemoteSessions(machine: Machine): Promise<SessionSummary[]> {
  const connection = await remoteConnection(machine);
  const workspaces = await connection.workspaces();
  const lists = await Promise.all(workspaces.map((workspace) => connection.sessions(workspace.path, PER_WORKSPACE).catch(() => [])));
  const sessions = lists
    .flat()
    .map((row): SessionSummary => ({ id: row.id, title: row.title, cwd: row.cwd, status: "idle", createdAt: row.updatedAt, updatedAt: row.updatedAt, origin: "omp" }))
    .sort((a, b) => b.updatedAt - a.updatedAt);
  for (const session of sessions) summaries.set(summaryKey(machine, session.id), session);
  return sessions;
}

export async function createRemoteSession(machine: Machine, cwd: string): Promise<SessionSummary> {
  const connection = await remoteConnection(machine);
  const id = await connection.createSession(cwd);
  const now = Date.now();
  const session: SessionSummary = { id, title: "", cwd, status: "idle", createdAt: now, updatedAt: now, origin: "omp" };
  summaries.set(summaryKey(machine, id), session);
  return session;
}

/** The directories the Host keeps OMP sessions in: where a new session may start. */
export async function remoteWorkspaces(machine: Machine): Promise<string[]> {
  return (await (await remoteConnection(machine)).workspaces()).map((workspace) => workspace.path);
}

/**
 * A Remote machine's probe: the server's word on whether the Host is online,
 * without opening a Host connection every 15 s. The counts are those of the
 * last session list this launch.
 */
export async function probeRemote(machine: Machine): Promise<Probe> {
  const started = Date.now();
  try {
    const host = await remoteHost(machine);
    if (host === undefined) return { state: "unreachable", reason: "unauthorized" };
    if (host.online !== true) return { state: "unreachable", reason: "network" };
    let sessionCount = 0;
    for (const key of summaries.keys()) if (key.startsWith(`${machine.id}\n`)) sessionCount += 1;
    return {
      state: "online",
      latencyMs: Date.now() - started,
      sessionCount,
      running: 0,
      name: host.name,
      version: host.harnessVersion ?? host.clientVersion ?? machine.version,
    };
  } catch (error) {
    const status = error instanceof RemoteServerError ? error.status : 0;
    return { state: "unreachable", reason: status === 401 || status === 403 ? "unauthorized" : "network" };
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * `SessionSocket` for a Remote Host: the same callbacks and frames. Opening
 * follows the session's ACP stream, then sends its history as a whole
 * snapshot; prompts, stops, approvals and model changes become ACP calls.
 */
export class RemoteSessionSocket implements ChatSocket {
  private readonly machine: Machine;
  private readonly sessionId: string;
  private readonly onMessage: (message: ServerMessage) => void;
  private readonly onOpen: () => void;
  private readonly onClose: (attempts: number) => void;
  private readonly onLink: () => void;
  private readonly held: () => Held | undefined;
  private connection: RemoteHostConnection | undefined;
  private stream: AcpStream | undefined;
  private translator = new AcpTranslator();
  private state: SessionState = { isStreaming: false };
  /** The model the Host runs the session on, as the selection calls need it. */
  private model: { provider: string; model: string; effort?: string } | undefined;
  private efforts: string[] = [];
  private closed = false;
  private failed = false;
  /** One connect at a time: a reconnect while one is under way waits for it. */
  private connecting = false;
  private attempts = 0;
  private retry = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private unsubscribe: (() => void) | undefined;

  constructor(
    machine: Machine,
    sessionId: string,
    onMessage: (message: ServerMessage) => void,
    onOpen: () => void,
    onClose: (attempts: number) => void,
    _onFailed: (failure: OpenFailure) => void = () => undefined,
    onLink: () => void = () => undefined,
    held: () => Held | undefined = () => undefined,
  ) {
    this.machine = machine;
    this.sessionId = sessionId;
    this.onMessage = onMessage;
    this.onOpen = onOpen;
    this.onClose = onClose;
    this.onLink = onLink;
    this.held = held;
  }

  connect(): void {
    if (this.closed || this.failed || this.connecting) return;
    clearTimeout(this.timer);
    this.timer = undefined;
    this.connecting = true;
    this.attempts += 1;
    // The Host sends the whole history: nothing the phone holds narrows it.
    this.held();
    void this.open()
      .catch(() => this.lost())
      .finally(() => {
        this.connecting = false;
      });
  }

  private async open(): Promise<void> {
    const connection = await remoteConnection(this.machine);
    if (this.closed) return;
    this.connection = connection;
    this.unsubscribe?.();
    this.unsubscribe = onRemoteClose(this.machine, () => this.lost());
    this.onLink();
    this.translator = new AcpTranslator(approvalsOf(connection, this.sessionId));
    const stream = await connection.follow(
      this.sessionId,
      (method, params) => this.emit(this.translator.frame(method, params)),
      () => {
        if (this.stream === stream) this.lost();
      },
    );
    if (this.closed) {
      void stream.close().catch(() => undefined);
      return;
    }
    this.stream = stream;
    const events = await connection.history(this.sessionId);
    if (this.closed) return;
    this.retry = 0;
    this.attempts = 0;
    const messages = historyMessages(events);
    this.onOpen();
    this.onMessage({ type: "snapshot", session: summaryOf(this.machine, this.sessionId), state: this.state, from: 0, total: messages.length, messages });
    // An approval asked before this reopen: the turn is still waiting on it.
    const waiting = this.translator.waiting();
    if (waiting.length > 0) this.emit([{ type: "state", state: { isStreaming: true } }, ...waiting]);
    void this.loadModel();
  }

  /** The session's current model, for the chat's header and picker. */
  private async loadModel(): Promise<void> {
    const connection = this.connection;
    if (connection === undefined) return;
    try {
      const catalog = modelOptions(await connection.models(this.sessionId));
      this.model = catalog.current;
      const current = catalog.models.find((model) => model.provider === catalog.current?.provider && model.id === catalog.current?.model);
      this.efforts = current?.efforts ?? [];
      if (catalog.current !== undefined) {
        this.setState({
          model: { provider: catalog.current.provider, id: catalog.current.model, name: current?.name ?? catalog.current.model },
          thinkingLevel: catalog.current.effort,
        });
      }
      return;
    } catch {
      // A Host without model selection: the header just shows no model.
    }
  }

  private setState(change: Partial<SessionState>): void {
    this.state = { ...this.state, ...change };
    this.onMessage({ type: "state", state: this.state });
  }

  private emit(outputs: AcpOutput[]): void {
    for (const output of outputs) {
      switch (output.type) {
        case "event":
          this.onMessage({ type: "event", event: output.event as { type: string; [key: string]: unknown } });
          break;
        case "state":
          this.setState(output.state);
          break;
        case "approval":
          this.onMessage({ type: "approval", request: output.request });
          break;
        case "approval_resolved":
          this.onMessage({ type: "approval_resolved", id: output.id, reason: "closed" });
          break;
        case "title": {
          const key = summaryKey(this.machine, this.sessionId);
          summaries.set(key, { ...summaryOf(this.machine, this.sessionId), title: output.title });
          break;
        }
      }
    }
  }

  /** The link or the stream went away: tell the screen, then try again with backoff. */
  private lost(): void {
    const stream = this.stream;
    this.stream = undefined;
    this.connection = undefined;
    void stream?.close().catch(() => undefined);
    if (this.closed || this.failed) return;
    this.onClose(this.attempts);
    if (this.timer !== undefined) return;
    this.retry = Math.min(this.retry + 1, 5);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.connect();
    }, 500 * 2 ** (this.retry - 1));
  }

  fail(): void {
    this.failed = true;
    clearTimeout(this.timer);
    this.timer = undefined;
  }

  reconnect(): void {
    if (this.closed) return;
    this.failed = false;
    this.retry = 0;
    if (this.isOpen) return;
    this.connect();
  }

  restart(): void {
    if (this.closed) return;
    this.failed = false;
    this.retry = 0;
    const stream = this.stream;
    this.stream = undefined;
    void stream?.close().catch(() => undefined);
    this.connect();
  }

  get isOpen(): boolean {
    return this.stream !== undefined;
  }

  send(frame: object): boolean {
    const connection = this.connection;
    if (connection === undefined || this.stream === undefined) return false;
    const body = frame as Record<string, unknown>;
    const fail = (command: string) => (error: unknown) => this.onMessage({ type: "error", command, error: message(error) });
    switch (body.type) {
      case "prompt": {
        const text = typeof body.text === "string" ? body.text : "";
        const images = Array.isArray(body.images) ? (body.images as { data: string; mimeType?: string }[]) : [];
        this.emit(this.translator.prompted(text));
        this.onMessage({ type: "accepted", command: "prompt" });
        void connection
          .prompt(this.sessionId, text, images.map((image) => ({ data: image.data, mimeType: image.mimeType ?? "image/jpeg" })))
          .catch((error: unknown) => {
            this.emit(this.translator.ended(undefined, message(error)));
            fail("prompt")(error);
          });
        return true;
      }
      case "abort":
        void connection.cancel(this.sessionId).catch(fail("abort"));
        return true;
      case "approval": {
        const id = typeof body.id === "string" ? body.id : "";
        const answer = this.translator.answer(id, body as { value?: string; cancelled?: boolean });
        if (answer === undefined) return true;
        this.onMessage({ type: "approval_resolved", id, reason: "answered" });
        void connection.answer(answer.handle, answer.decision).catch(fail("approval"));
        return true;
      }
      case "models":
        void connection
          .models(this.sessionId)
          .then((catalog) => this.onMessage({ type: "models", models: modelOptions(catalog).models }))
          .catch(fail("models"));
        return true;
      case "thinking_levels":
        this.onMessage({ type: "thinking_levels", levels: this.efforts, current: this.model?.effort ?? null });
        return true;
      case "set_model": {
        const provider = typeof body.provider === "string" ? body.provider : "";
        const model = typeof body.modelId === "string" ? body.modelId : "";
        void connection
          .selectModel(this.sessionId, provider, model)
          .then(() => this.loadModel())
          .catch(fail("set_model"));
        return true;
      }
      case "set_thinking_level": {
        const current = this.model;
        const level = typeof body.level === "string" ? body.level : undefined;
        if (current === undefined || level === undefined) return true;
        void connection
          .selectModel(this.sessionId, current.provider, current.model, level)
          .then(() => this.loadModel())
          .catch(fail("set_thinking_level"));
        return true;
      }
      default:
        return false;
    }
  }

  /** The Host connection keeps its own heartbeat: a dead link closes it, and `lost` runs. */
  watchSilence(): void {}

  close(): void {
    this.closed = true;
    clearTimeout(this.timer);
    this.timer = undefined;
    this.unsubscribe?.();
    const stream = this.stream;
    this.stream = undefined;
    void stream?.close().catch(() => undefined);
  }
}
