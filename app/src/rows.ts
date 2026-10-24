import type { ChatItem, MessageItem, NoticeItem, ToolItem } from "./types";
import { listSeparator, t, type Key } from "./i18n/index.ts";

/**
 * The transcript as the chat screen lays it out. A turn is the user's message
 * and everything OMP does in reply: one header line, then its prose, and each
 * stretch of tool calls folded into one activity card. Thinking that only
 * leads into tool calls belongs to that stretch; thinking before an answer
 * stays with the answer.
 */
export type Row =
  | { kind: "user"; id: string; item: MessageItem }
  | { kind: "turn"; id: string }
  | { kind: "reply"; id: string; item: MessageItem }
  | { kind: "activity"; id: string; steps: Step[]; running: boolean; failed: number }
  | { kind: "notice"; id: string; item: NoticeItem };

/** One line inside an activity card: a tool call, or a thought between calls. */
export type Step = { kind: "tool"; tool: ToolItem } | { kind: "thought"; item: MessageItem };

function thinkingOnly(item: MessageItem): boolean {
  return item.role === "assistant" && item.text.trim() === "" && (item.images?.length ?? 0) === 0;
}

/**
 * Lay out `items` (in transcript order) as rows. Ids are stable while a
 * transcript grows: an activity keeps the id of its first step.
 */
export function layoutRows(items: readonly ChatItem[]): Row[] {
  const rows: Row[] = [];
  /** Whether the current turn already has its header. */
  let headed = false;
  let activity: Extract<Row, { kind: "activity" }> | undefined;

  const head = (anchor: string) => {
    if (headed) return;
    headed = true;
    rows.push({ kind: "turn", id: `turn:${anchor}` });
  };
  const close = () => {
    activity = undefined;
  };
  const step = (value: Step, id: string) => {
    if (activity === undefined) {
      head(id);
      activity = { kind: "activity", id: `act:${id}`, steps: [], running: false, failed: 0 };
      rows.push(activity);
    }
    activity.steps.push(value);
    if (value.kind === "tool") {
      if (value.tool.status === "running") activity.running = true;
      if (value.tool.status === "error") activity.failed += 1;
    } else if (value.item.streaming === true) {
      activity.running = true;
    }
  };

  items.forEach((item, index) => {
    if (item.kind === "notice") {
      close();
      rows.push({ kind: "notice", id: item.id, item });
      return;
    }
    if (item.kind === "tool") {
      step({ kind: "tool", tool: item }, item.id);
      return;
    }
    if (item.role === "user") {
      close();
      headed = false;
      rows.push({ kind: "user", id: item.id, item });
      return;
    }
    if (item.role === "system") {
      close();
      rows.push({ kind: "notice", id: item.id, item: { kind: "notice", id: item.id, level: "info", text: item.text } });
      return;
    }
    // Thinking with nothing to say, followed by a tool call, is part of the work, not the answer.
    if (thinkingOnly(item) && items[index + 1]?.kind === "tool") {
      step({ kind: "thought", item }, item.id);
      return;
    }
    close();
    head(item.id);
    rows.push({ kind: "reply", id: item.id, item });
  });
  return rows;
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

/** Per kind: the summary's lead (counted) and the shorter form for the kinds after it. */
const SUMMARY: Record<ToolKind, [first: Key, later: Key]> = {
  read: ["summary.read", "summary.read.more"],
  edit: ["summary.edit", "summary.edit.more"],
  write: ["summary.write", "summary.write.more"],
  run: ["summary.run", "summary.run.more"],
  search: ["summary.search", "summary.search.more"],
  web: ["summary.web", "summary.web.more"],
  plan: ["summary.plan", "summary.plan.more"],
  agent: ["summary.agent", "summary.agent.more"],
  ask: ["summary.ask", "summary.ask.more"],
  other: ["summary.other", "summary.other.more"],
};

const ORDER: ToolKind[] = ["edit", "write", "run", "read", "search", "web", "agent", "ask", "plan", "other"];

/**
 * A finished stretch in one line, most consequential work first:
 * "Edited 2 files, ran 3, read 4". Edited files count once per path.
 */
export function activitySummary(steps: readonly Step[]): string {
  const counts = new Map<ToolKind, number>();
  const edited = new Map<ToolKind, Set<string>>();
  for (const value of steps) {
    if (value.kind !== "tool") continue;
    const kind = toolKind(value.tool.name);
    const path = str(record(value.tool.args)?.path);
    if ((kind === "edit" || kind === "write" || kind === "read") && path !== undefined) {
      const seen = edited.get(kind) ?? new Set<string>();
      seen.add(path);
      edited.set(kind, seen);
      counts.set(kind, seen.size);
    } else {
      counts.set(kind, (counts.get(kind) ?? 0) + 1);
    }
  }
  const parts = ORDER.filter((kind) => (counts.get(kind) ?? 0) > 0).map((kind, index) => {
    const n = counts.get(kind) ?? 0;
    const [first, later] = SUMMARY[kind];
    return t(index === 0 ? first : later, { count: n });
  });
  if (parts.length === 0) return t("summary.thought");
  return parts.slice(0, 3).join(listSeparator());
}

/** The step a running card shows on its head: the last tool still running, else the last step. */
export function liveStep(steps: readonly Step[]): Step | undefined {
  for (let at = steps.length - 1; at >= 0; at -= 1) {
    const value = steps[at];
    if (value?.kind === "tool" && value.tool.status === "running") return value;
  }
  return steps.at(-1);
}

export function toolCount(steps: readonly Step[]): number {
  return steps.filter((value) => value.kind === "tool").length;
}
