/** Shared shapes between the daemon and the native app. */

export interface Machine {
  /** Loopback/Tailnet base URL, without a trailing slash. */
  id: string;
  url: string;
  token: string;
  name: string;
  os: string;
  version: string;
  /** Working directory the daemon starts sessions in. */
  cwd: string;
  /** When a probe last reached the daemon (epoch ms); absent until one has. */
  lastSeen?: number;
  /** The user's own name for this computer on this phone; the host name when absent. */
  label?: string;
}

export interface SessionSummary {
  id: string;
  title: string;
  cwd: string;
  status: "idle" | "streaming";
  model?: string;
  createdAt: number;
  updatedAt: number;
  sessionFile?: string;
  /** `daemon`: started from this app; `omp`: an OMP session from a terminal on the computer. */
  origin: "daemon" | "omp";
  /** Another omp process (a terminal) has it open; the daemon will not open it until that one exits or is taken over. */
  openElsewhere?: boolean;
  /** That process, from daemons that offer the `takeover` feature. */
  owner?: SessionOwner;
  /** OMP questions and tool approvals waiting for an answer (live sessions, newer daemons). */
  waiting?: number;
}

/** The omp process on the computer that holds a session (issue #28). */
export interface SessionOwner {
  pid: number;
  /** It is in the middle of a turn. */
  busy: boolean;
  /** It runs in a terminal. */
  terminal: boolean;
}

export interface SessionState {
  model?: { provider?: string; id?: string; name?: string };
  thinkingLevel?: string;
  isStreaming?: boolean;
  isCompacting?: boolean;
  sessionId?: string;
  sessionName?: string;
  contextUsage?: { tokens?: number; contextWindow?: number; percent?: number };
  tokensPerSecond?: number | null;
  messageCount?: number;
  todoPhases?: unknown[];
  /** Queued user input while a turn runs, as OMP's queue chips. */
  queuedMessages?: { steering?: string[]; followUp?: string[] };
  goal?: unknown;
}

/** One entry of OMP's model catalog, as the daemon projects it. */
export interface ModelOption {
  provider: string;
  id: string;
  name: string;
  reasoning: boolean;
  input: string[];
  contextWindow?: number;
  cost?: { input?: number; output?: number };
  efforts?: string[];
}

/** An image OMP attached to a message or tool result: base64, or `blob:sha256:<hex>` in the computer's store. */
export interface ImagePart {
  mimeType?: string;
  data: string;
}

export interface AgentMessage {
  id?: string;
  role?: string;
  content?: unknown;
  timestamp?: number;
  [key: string]: unknown;
}

export interface ToolItem {
  kind: "tool";
  id: string;
  name: string;
  /** OMP's one-line statement of what the call is for ("Reading hello.txt"). */
  intent?: string;
  args: unknown;
  partial?: unknown;
  result?: unknown;
  isError?: boolean;
  status: "running" | "done" | "error";
  /** Images a result carried, e.g. a screenshot or a picture the read tool opened. */
  images?: ImagePart[];
  /** When the call started and ended (epoch ms): as the phone saw it live; a stored call has only its result's time as the end. */
  startedAt?: number;
  endedAt?: number;
}

export interface MessageItem {
  kind: "message";
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
  thinking?: string;
  /** When the phone saw the first thinking arrive (epoch ms); absent for messages loaded from a snapshot. */
  thinkingStartedAt?: number;
  /** How long the thinking ran, until the answer's first text (or the message's end). */
  thinkingMs?: number;
  /** Images the user attached, in content order. */
  images?: ImagePart[];
  streaming?: boolean;
  /** The message OMP is still emitting: updates and the final message land on it. */
  open?: boolean;
  /** When the message started (epoch ms): OMP's timestamp, else when the phone saw it start. */
  createdAt?: number;
  /** When the phone saw the message end; absent for stored messages. */
  endedAt?: number;
  /** How an assistant message ended, when it did not end normally: an error, or stopped by the user. */
  stop?: "error" | "aborted";
  /** The error an assistant message ended on. */
  error?: string;
  /** What the deltas of an open message added up to so far, apart from what its events' message content said. */
  streamed?: { text: string; thinking: string };
}

export interface NoticeItem {
  kind: "notice";
  id: string;
  level: "info" | "warning" | "error";
  text: string;
}

export type ChatItem = MessageItem | ToolItem | NoticeItem;

export interface ApprovalRequest {
  id: string;
  method: "select" | "confirm" | "input" | "editor";
  title: string;
  message?: string;
  options?: string[];
  optionDetails?: { description?: string }[];
  placeholder?: string;
  prefill?: string;
}

export interface Hello {
  name: string;
  os: string;
  version: string;
  protocol: number;
  sessionCount: number;
  cwd: string;
  /** What this daemon supports beyond protocol 1, e.g. `"prompt-images"`; absent on older daemons. */
  features?: string[];
}

/**
 * A session's transcript as the daemon sends it: a socket's `snapshot` frame
 * and `GET /sessions/:id/transcript` (`transcript-sync` feature). `from` is the
 * index of the first message carried (0 or absent: the whole transcript),
 * `total` how many the daemon holds; both are absent on older daemons.
 */
export interface Transcript {
  session: SessionSummary;
  state: SessionState;
  from?: number;
  total?: number;
  /**
   * A whole answer (`from` 0) from a session past the daemon's message cap:
   * the index in the session of its first message. Absent (0) otherwise.
   */
  base?: number;
  messages: AgentMessage[];
}

export interface Snapshot extends Transcript {
  type: "snapshot";
}

export interface ServerEvent {
  type: "event";
  event: { type: string; [key: string]: unknown };
}

export type ServerMessage =
  | Snapshot
  | ServerEvent
  | { type: "state"; state: SessionState }
  | { type: "models"; models: ModelOption[] }
  | { type: "thinking_levels"; levels: string[]; current?: string | null }
  | { type: "approval"; request: ApprovalRequest }
  /** A dialog was answered (by any client) or closed by OMP itself. */
  | { type: "approval_resolved"; id: string; reason: "answered" | "cancelled" | "closed" }
  | { type: "notice"; level: "info" | "warning" | "error"; message: string }
  | { type: "closed"; reason: string; stderr?: string }
  /** The session could not open (unknown, file gone, held by another omp, OMP failed to load it); the socket closes next. */
  | { type: "open_failed"; status: number; error: string; owner?: SessionOwner }
  | { type: "accepted"; command: string }
  /** `command`: the frame that failed (daemons before 0.3 leave it out). */
  | { type: "error"; error: string; command?: string }
  | { type: "protocol-error"; line: string };
