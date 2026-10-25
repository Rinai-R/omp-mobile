import type { ChatItem, MessageItem, NoticeItem, ToolItem } from "./types";
import { t, type Key } from "./i18n/index.ts";

/**
 * The transcript as the chat screen lays it out: one conversation column.
 * A turn is the user's message and everything OMP does in reply. It starts
 * with a one-line divider that says how the turn ended and how long it took;
 * then its work (each stretch of tool calls as one activity row, a reply's
 * thinking as one thinking row) and its prose follow as plain rows, and a
 * tail with copy and the time closes it. The work rows belong to their turn
 * (`turn`): collapsing the divider hides them and leaves the answer.
 *
 * Every row carries `gap`, the space above it, so the column keeps one
 * rhythm: tight between work rows, roomier around prose and between turns.
 */
export type Row =
  | { kind: "user"; id: string; gap: number; item: MessageItem }
  | {
      kind: "turn";
      id: string;
      gap: number;
      running: boolean;
      end: TurnEnd;
      startedAt?: number;
      endedAt?: number;
      /** While running: what OMP is doing now. */
      live?: Live;
      /** Whether the turn has work rows the divider can fold. */
      members: number;
    }
  | { kind: "thinking"; id: string; gap: number; turn: string; item: MessageItem }
  | { kind: "activity"; id: string; gap: number; turn: string; steps: Step[]; running: boolean; failed: number }
  | { kind: "reply"; id: string; gap: number; turn?: string; item: MessageItem }
  | { kind: "error"; id: string; gap: number; item: MessageItem }
  | { kind: "tail"; id: string; gap: number; text: string; at?: number }
  | { kind: "notice"; id: string; gap: number; item: NoticeItem };

/** How a finished turn ended. */
export type TurnEnd = "done" | "failed" | "stopped";

/** What a running turn is doing now, for the divider's live label. */
export type Live = { kind: "tool"; tool: ToolItem } | { kind: "thinking" } | { kind: "writing" } | { kind: "working" };

/** One line inside an activity row: a tool call, or a thought between calls. */
export type Step = { kind: "tool"; tool: ToolItem } | { kind: "thought"; item: MessageItem };

/** The rows that fold with their turn's divider. */
export type Member = Extract<Row, { kind: "thinking" | "activity" }>;

function thinkingOnly(item: MessageItem): boolean {
  return item.role === "assistant" && item.text.trim() === "" && (item.images?.length ?? 0) === 0;
}

function hasThinking(item: MessageItem): boolean {
  return item.thinking !== undefined && item.thinking.trim() !== "";
}

/** The space above a row, from the row before it. */
export function gapBefore(kind: Row["kind"], previous: Row["kind"] | undefined): number {
  if (previous === undefined) return 0;
  switch (kind) {
    case "user":
      return previous === "user" ? 12 : 28;
    case "turn":
      return previous === "user" ? 14 : 28;
    case "thinking":
    case "activity":
      return previous === "turn" ? 12 : 6;
    case "reply":
      return 14;
    case "tail":
      return 6;
    default:
      return 10;
  }
}

/** The latest moment an item shows: when it ended, else when it started. */
function lastTime(item: ChatItem): number | undefined {
  if (item.kind === "message") return item.endedAt ?? item.createdAt;
  if (item.kind === "tool") return item.endedAt ?? item.startedAt;
  return undefined;
}

/**
 * Lay out `items` (in transcript order) as rows. `streaming`: OMP is still
 * working on the last turn, also between its events. Ids are stable while a
 * transcript grows: an activity keeps the id of its first step, a turn the id
 * of its first item after the user's message.
 */
export function layoutRows(items: readonly ChatItem[], streaming = false): Row[] {
  const rows: Row[] = [];
  let turn: Extract<Row, { kind: "turn" }> | undefined;
  /** The current turn's user message time, and its items so far. */
  let asked: number | undefined;
  /** The current turn's user message id: the turn is named after it, so its divider can show before OMP answers. */
  let askedId: string | undefined;
  let turnItems: ChatItem[] = [];
  let activity: Extract<Row, { kind: "activity" }> | undefined;

  const push = <K extends Row["kind"]>(row: Omit<Extract<Row, { kind: K }>, "gap">): Extract<Row, { kind: K }> => {
    const value = { ...row, gap: gapBefore(row.kind, rows.at(-1)?.kind) } as Extract<Row, { kind: K }>;
    rows.push(value);
    return value;
  };
  const head = (anchor: string) => {
    if (turn !== undefined) return turn;
    const created = push<"turn">({ kind: "turn", id: `turn:${askedId ?? anchor}`, running: false, end: "done", startedAt: asked, members: 0 });
    turn = created;
    return created;
  };
  /** Finish the current turn: its times, how it ended, and its tail. */
  const finish = (last: boolean) => {
    const current = turn;
    if (current !== undefined) {
      const running = (last && streaming) || turnItems.some((item) => (item.kind === "tool" ? item.status === "running" : item.kind === "message" && item.streaming === true));
      current.running = running;
      const times = turnItems.map(lastTime).filter((time): time is number => time !== undefined);
      current.startedAt ??= turnItems.map((item) => (item.kind === "message" ? item.createdAt : item.kind === "tool" ? item.startedAt : undefined)).find((time) => time !== undefined);
      current.endedAt = times.length > 0 ? Math.max(...times) : undefined;
      const answers = turnItems.filter((item): item is MessageItem => item.kind === "message" && item.role === "assistant");
      const stop = answers.at(-1)?.stop;
      current.end = stop === "error" ? "failed" : stop === "aborted" ? "stopped" : "done";
      current.live = running ? liveOf(turnItems) : undefined;
      const text = answers
        .map((item) => item.text.trim())
        .filter((value) => value !== "")
        .join("\n\n");
      if (!running && text !== "") push<"tail">({ kind: "tail", id: `tail:${current.id}`, text, at: current.endedAt });
    }
    turn = undefined;
    turnItems = [];
    asked = undefined;
    askedId = undefined;
    activity = undefined;
  };
  const step = (value: Step, id: string) => {
    if (activity === undefined) {
      const owner = head(id);
      owner.members += 1;
      activity = push<"activity">({ kind: "activity", id: `act:${id}`, turn: owner.id, steps: [], running: false, failed: 0 });
    }
    const current = activity;
    current.steps.push(value);
    if (value.kind === "tool") {
      if (value.tool.status === "running") current.running = true;
      if (value.tool.status === "error") current.failed += 1;
    } else if (value.item.streaming === true) {
      current.running = true;
    }
  };

  items.forEach((item, index) => {
    if (item.kind === "notice") {
      activity = undefined;
      push<"notice">({ kind: "notice", id: item.id, item });
      return;
    }
    if (item.kind === "message" && item.role === "user") {
      finish(false);
      asked = item.createdAt;
      askedId = item.id;
      push<"user">({ kind: "user", id: item.id, item });
      return;
    }
    if (item.kind === "message" && item.role === "system") {
      activity = undefined;
      push<"notice">({ kind: "notice", id: item.id, item: { kind: "notice", id: item.id, level: "info", text: item.text } });
      return;
    }
    turnItems.push(item);
    if (item.kind === "tool") {
      step({ kind: "tool", tool: item }, item.id);
      return;
    }
    // Thinking with nothing to say, followed by a tool call, is part of the work, not the answer.
    if (thinkingOnly(item) && hasThinking(item) && items[index + 1]?.kind === "tool") {
      step({ kind: "thought", item }, item.id);
      return;
    }
    activity = undefined;
    const owner = head(item.id);
    if (hasThinking(item)) {
      owner.members += 1;
      push<"thinking">({ kind: "thinking", id: `think:${item.id}`, turn: owner.id, item });
    }
    if (item.text.trim() !== "" || (item.images?.length ?? 0) > 0) {
      push<"reply">({ kind: "reply", id: item.id, turn: owner.id, item });
    } else if (item.stop === "error" && item.error !== undefined) {
      push<"error">({ kind: "error", id: `err:${item.id}`, item });
    }
  });
  // A prompt OMP has not answered yet: its divider already says it is working.
  if (streaming && turn === undefined && askedId !== undefined) head(askedId);
  finish(true);
  return rows;
}

/** What a running turn is doing now: its running tool, else what its last message streams. */
function liveOf(items: readonly ChatItem[]): Live {
  for (let at = items.length - 1; at >= 0; at -= 1) {
    const item = items[at];
    if (item?.kind === "tool" && item.status === "running") return { kind: "tool", tool: item };
  }
  const last = items.at(-1);
  if (last?.kind === "message" && last.streaming === true) {
    return last.text.trim() !== "" ? { kind: "writing" } : hasThinking(last) ? { kind: "thinking" } : { kind: "working" };
  }
  return { kind: "working" };
}

/**
 * A turn's length in words: "48s", "3m 12s", "1h 05m" ("48秒", "3分12秒",
 * "1小时5分"). Under a second reads as a second.
 */
export function turnDuration(ms: number): string {
  const total = Math.max(1, Math.round(ms / 1_000));
  if (total < 60) return t("turn.seconds", { seconds: total });
  const minutes = Math.floor(total / 60);
  if (minutes < 60) return t("turn.minutes", { minutes, seconds: total % 60 });
  return t("turn.hours", { hours: Math.floor(minutes / 60), minutes: minutes % 60 });
}

/** The divider's line for a finished turn: "Done in 3m 12s", "Failed", "Stopped". */
export function turnLabel(row: Pick<Extract<Row, { kind: "turn" }>, "end" | "startedAt" | "endedAt">): string {
  if (row.end === "failed") return t("turn.failed");
  if (row.end === "stopped") return t("turn.stopped");
  if (row.startedAt === undefined || row.endedAt === undefined || row.endedAt < row.startedAt) return t("turn.done");
  return t("turn.doneIn", { duration: turnDuration(row.endedAt - row.startedAt) });
}

/** The divider's live line while a turn runs: OMP's intent for the running call, else what kind of work it is. */
export function liveLabel(live: Live | undefined): string {
  if (live === undefined || live.kind === "working") return t("turn.working");
  if (live.kind === "thinking") return t("turn.thinking");
  if (live.kind === "writing") return t("turn.writing");
  const intent = live.tool.intent?.trim();
  if (intent !== undefined && intent !== "") return oneLine(intent, 80);
  return t(`live.${toolKind(live.tool.name)}`);
}

/** What a tool does, for its icon and the activity summary. */
export type ToolKind = "read" | "edit" | "write" | "run" | "search" | "web" | "plan" | "agent" | "ask" | "other";

const KINDS: Record<string, ToolKind> = {
  read: "read",
  view: "read",
  ls: "read",
  edit: "edit",
  multi_edit: "edit",
  apply_patch: "edit",
  write: "write",
  bash: "run",
  shell: "run",
  eval: "run",
  exec: "run",
  grep: "search",
  glob: "search",
  find: "search",
  lsp: "search",
  web_search: "web",
  web_fetch: "web",
  fetch: "web",
  browser: "web",
  todo: "plan",
  goal: "plan",
  task: "agent",
  hub: "agent",
  wait: "agent",
  ask: "ask",
};

export function toolKind(name: string): ToolKind {
  const known = KINDS[name];
  if (known !== undefined) return known;
  if (name.startsWith("history_recall")) return "search";
  return "other";
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function basename(path: string): string {
  const trimmed = path.replace(/\/+$/, "");
  return trimmed.slice(trimmed.lastIndexOf("/") + 1) || trimmed;
}

/** A path shown relative to the session's directory when it lies inside it. */
export function shortPath(path: string, cwd: string | undefined): string {
  if (cwd !== undefined && cwd !== "" && path.startsWith(`${cwd.replace(/\/+$/, "")}/`)) {
    return path.slice(cwd.replace(/\/+$/, "").length + 1);
  }
  return path.replace(/^\/Users\/[^/]+\//, "~/");
}

function oneLine(text: string, max = 120): string {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

/** The step's title: OMP's own intent line, else a sentence from the arguments. */
export function stepTitle(tool: ToolItem): string {
  if (tool.intent !== undefined && tool.intent.trim() !== "") return oneLine(tool.intent);
  const args = record(tool.args);
  const path = str(args?.path) ?? str(args?.file_path);
  switch (toolKind(tool.name)) {
    case "read":
      return path !== undefined ? t("step.read", { name: basename(path) }) : t("step.readAny");
    case "edit":
      return path !== undefined ? t("step.edit", { name: basename(path) }) : t("step.editAny");
    case "write":
      return path !== undefined ? t("step.write", { name: basename(path) }) : t("step.writeAny");
    case "run":
      return str(args?.title) !== undefined
        ? oneLine(String(args?.title))
        : tool.name === "eval"
          ? t("step.runCode")
          : t("step.runCommand");
    case "search":
      return str(args?.pattern) !== undefined ? t("step.search", { pattern: oneLine(String(args?.pattern), 60) }) : t("step.searchAny");
    case "web":
      return str(args?.query) !== undefined ? t("step.web", { query: oneLine(String(args?.query), 60) }) : t("step.webAny");
    case "plan":
      return t("step.plan");
    case "agent":
      return tool.name === "task" ? t("step.delegate") : tool.name === "wait" ? t("step.wait") : t("step.jobs");
    case "ask":
      return t("step.ask");
    default:
      return tool.name;
  }
}

/** The mono line under a step's title: the path, command, pattern or query it acted on. */
export function stepTarget(tool: ToolItem, cwd?: string): string | undefined {
  const args = record(tool.args);
  if (args === undefined) return undefined;
  const command = str(args.command);
  if (command !== undefined) return `$ ${oneLine(command, 160)}`;
  const path = str(args.path) ?? str(args.file_path);
  const pattern = str(args.pattern);
  if (pattern !== undefined) return path !== undefined ? `${oneLine(pattern, 80)} · ${shortPath(path, cwd)}` : oneLine(pattern, 120);
  if (path !== undefined) return shortPath(path, cwd);
  const query = str(args.query) ?? str(args.url);
  if (query !== undefined) return oneLine(query, 120);
  const code = str(args.code);
  if (code !== undefined) return oneLine(code, 120);
  return undefined;
}

/** Lines added and removed by an edit: from OMP's result diff, else from the call's two sides. */
export function editCounts(tool: ToolItem): { added: number; removed: number } | undefined {
  const details = record(record(tool.result)?.details);
  const diff = str(details?.diff);
  if (diff !== undefined) {
    let added = 0;
    let removed = 0;
    for (const line of diff.split("\n")) {
      if (/^\+\s*\d+\|/.test(line)) added += 1;
      else if (/^-\s*\d+\|/.test(line)) removed += 1;
    }
    return { added, removed };
  }
  const args = record(tool.args);
  const before = str(args?.old_string) ?? (typeof args?.old_string === "string" ? "" : undefined);
  const after = typeof args?.new_string === "string" ? args.new_string : undefined;
  if (before === undefined || after === undefined) return undefined;
  const count = (text: string) => (text === "" ? 0 : text.split("\n").length);
  return { added: count(after), removed: count(before) };
}

/** The short result on a step's right: `+6 −2`, `142 lines`, `1.2s`, `failed`. */
export function stepStat(tool: ToolItem): string | undefined {
  if (tool.status === "running") return undefined;
  if (tool.status === "error") return t("step.failed");
  const details = record(record(tool.result)?.details);
  const kind = toolKind(tool.name);
  if (kind === "edit" || kind === "write") {
    if (kind === "write") {
      const content = str(record(tool.args)?.content);
      if (content !== undefined) return t("step.lines", { count: content.split("\n").length });
    }
    const counts = editCounts(tool);
    if (counts !== undefined) return `+${counts.added} −${counts.removed}`;
  }
  if (kind === "read" && typeof details?.totalLines === "number") {
    return t("step.lines", { count: details.totalLines });
  }
  if (kind === "run" && typeof details?.wallTimeMs === "number") return duration(details.wallTimeMs);
  return undefined;
}

/** `850ms`, `1.2s`, `14s`, `1m 03s`. */
export function duration(ms: number): string {
  if (ms < 1_000) return `${Math.max(0, Math.round(ms))}ms`;
  if (ms < 10_000) return `${(ms / 1_000).toFixed(1)}s`;
  const seconds = Math.round(ms / 1_000);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`;
}

/**
 * A thought's row: "Thought for 12s" when the phone timed it, else "Thought"
 * (a transcript loaded from the computer carries no duration).
 */
export function thoughtLabel(ms: number | undefined): string {
  if (ms === undefined) return t("transcript.thought");
  const seconds = Math.max(1, Math.round(ms / 1_000));
  if (seconds < 60) return t("transcript.thoughtFor", { seconds });
  return t("transcript.thoughtForLong", { minutes: Math.floor(seconds / 60), seconds: seconds % 60 });
}

/** The kinds of work an activity names, in the order it first did them. */
export function activityKinds(steps: readonly Step[]): ToolKind[] {
  const kinds: ToolKind[] = [];
  for (const value of steps) {
    if (value.kind !== "tool") continue;
    const kind = toolKind(value.tool.name);
    if (!kinds.includes(kind)) kinds.push(kind);
  }
  return kinds;
}

/** At most this many kinds are named; more end in "and more". */
const NAMED_KINDS = 3;

/**
 * An activity row's title: the kinds of work, not how many calls —
 * "Ran commands", "Read files, edited files, ran commands" ("执行了命令",
 * "读取了文件、修改了文件").
 */
export function activityLabel(steps: readonly Step[]): string {
  const kinds = activityKinds(steps);
  if (kinds.length === 0) return t("transcript.thought");
  const named = kinds.slice(0, NAMED_KINDS).map((kind, index) => t((index === 0 ? `activity.${kind}` : `activity.${kind}.more`) as Key));
  const line = named.join(t("activity.join"));
  return kinds.length > NAMED_KINDS ? t("activity.etc", { list: line }) : line;
}

/** A tool row's title: the kind of tool ("Run", "Read", "Edit"), or the tool's own name. */
export function toolTitle(tool: ToolItem): string {
  const kind = toolKind(tool.name);
  return kind === "other" ? tool.name : t(`tool.kind.${kind}`);
}

/** A tool row's summary after its title: the command, path, pattern or query, else OMP's intent. */
export function toolSummaryLine(tool: ToolItem, cwd?: string): string | undefined {
  const target = stepTarget(tool, cwd);
  if (target !== undefined) return target.replace(/^\$ /, "");
  const intent = tool.intent?.trim();
  return intent !== undefined && intent !== "" ? oneLine(intent) : undefined;
}

/** The step a running activity shows: the last tool still running, else the last step. */
export function liveStep(steps: readonly Step[]): Step | undefined {
  for (let at = steps.length - 1; at >= 0; at -= 1) {
    const value = steps[at];
    if (value?.kind === "tool" && value.tool.status === "running") return value;
  }
  return steps.at(-1);
}

/** The time under a turn: "19:31" today, "10/25 19:31" on another day (local time). */
export function clockTime(at: number, now = Date.now()): string {
  const date = new Date(at);
  const today = new Date(now);
  const pad = (value: number) => String(value).padStart(2, "0");
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  const sameDay = date.getFullYear() === today.getFullYear() && date.getMonth() === today.getMonth() && date.getDate() === today.getDate();
  return sameDay ? time : `${date.getMonth() + 1}/${date.getDate()} ${time}`;
}
