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
  /** Another omp process (a terminal) has it open; the daemon will not open it until that one exits. */
  openElsewhere?: boolean;
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
  args: unknown;
  partial?: unknown;
  result?: unknown;
  isError?: boolean;
  status: "running" | "done" | "error";
}

export interface MessageItem {
  kind: "message";
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
  thinking?: string;
  streaming?: boolean;
  /** The message OMP is still emitting: updates and the final message land on it. */
  open?: boolean;
  createdAt?: number;
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
}

export interface Snapshot {
  type: "snapshot";
  session: SessionSummary;
  state: SessionState;
  messages: AgentMessage[];
}

export interface ServerEvent {
  type: "event";
  event: { type: string; [key: string]: unknown };
}

export type ServerMessage =
  | Snapshot
  | ServerEvent
  | { type: "state"; state: SessionState }
  | { type: "approval"; request: ApprovalRequest }
  /** A dialog was answered (by any client) or closed by OMP itself. */
  | { type: "approval_resolved"; id: string; reason: "answered" | "cancelled" | "closed" }
  | { type: "notice"; level: "info" | "warning" | "error"; message: string }
  | { type: "closed"; reason: string; stderr?: string }
  | { type: "accepted"; command: string }
  | { type: "error"; error: string }
  | { type: "protocol-error"; line: string };
