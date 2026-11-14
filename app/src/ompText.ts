import { t, type Key } from "./i18n/index.ts";

/**
 * The fixed English OMP puts in front of the user, in the phone's language:
 * tool-approval prompts (`Allow tool: bash` then `Command: ls -la`), their
 * answers (`Approve`, `Deny`) and thinking levels (`high`). What a label
 * introduces (a command, a path, code) and anything OMP does not fix
 * (an agent's own question) is shown as sent.
 */

/** OMP's tool approval is a `select` whose title starts with this (the daemon's `TOOL_APPROVAL_PREFIX`). */
export const TOOL_APPROVAL_PREFIX = "Allow tool:";

/** The labels OMP's approval details start with, from `tools/approval.ts` and each tool's `formatApprovalDetails`. */
const DETAIL_LABELS: Record<string, Key> = {
  Command: "omp.detail.command",
  Path: "omp.detail.path",
  Paths: "omp.detail.paths",
  Pattern: "omp.detail.pattern",
  Language: "omp.detail.language",
  Code: "omp.detail.code",
  Content: "omp.detail.content",
  URL: "omp.detail.url",
  Reason: "omp.detail.reason",
  Origin: "omp.detail.origin",
};

/** Values OMP fixes too, not just their labels. */
const DETAIL_VALUES: Record<string, Key> = {
  "MCP server tool": "omp.detail.mcpTool",
};

export interface ApprovalDetail {
  /** The detail's kind in the phone's language; undefined for a line with no known label. */
  label?: string;
  /** `command` details read as a shell line. */
  command: boolean;
  value: string;
}

export interface ApprovalText {
  /** The tool being asked about (`bash`), or undefined when this is not a tool approval. */
  tool?: string;
  /** "Allow bash?" for a tool approval; otherwise the title's first line as OMP sent it. */
  heading: string;
  details: ApprovalDetail[];
}

function detailOf(line: string): ApprovalDetail {
  const match = /^([A-Za-z]+):\s*([\s\S]*)$/.exec(line);
  const key = match === null ? undefined : DETAIL_LABELS[match[1] ?? ""];
  if (match === null || key === undefined) return { command: false, value: line };
  const value = (match[2] ?? "").trim();
  const fixed = DETAIL_VALUES[value];
  return { label: t(key), command: match[1] === "Command", value: fixed === undefined ? value : t(fixed) };
}

/**
 * An OMP question's title and message, split into a heading and labelled details:
 * one detail per line, except that a label with nothing after it (`Content:`,
 * `Code:`) takes the lines that follow, up to the next known label.
 */
export function approvalText(title: string, message?: string): ApprovalText {
  const lines = [...title.split("\n"), ...(message === undefined ? [] : message.split("\n"))];
  const first = lines.shift() ?? "";
  const tool = first.startsWith(TOOL_APPROVAL_PREFIX) ? first.slice(TOOL_APPROVAL_PREFIX.length).trim() : undefined;
  const blocks: string[] = [];
  let open = false;
  for (const line of lines) {
    const match = /^([A-Za-z]+):(.*)$/.exec(line);
    const known = match !== null && DETAIL_LABELS[match[1] ?? ""] !== undefined;
    if (open && !known) {
      blocks[blocks.length - 1] += `\n${line}`;
      continue;
    }
    blocks.push(line);
    open = known && (match?.[2] ?? "").trim() === "";
  }
  return {
    tool,
    heading: tool === undefined ? first : t("omp.allowTool", { tool }),
    details: blocks.map((block) => detailOf(block.trim())).filter((detail) => detail.value !== ""),
  };
}

/** OMP's tool-approval answers. */
const OPTION_LABELS: Record<string, Key> = {
  Approve: "approval.option.approve",
  "Approve Once": "approval.option.approveOnce",
  "Always Approve": "approval.option.alwaysApprove",
  "Approve File": "approval.option.approveFile",
  "Always Approve File": "approval.option.alwaysApproveFile",
  Deny: "approval.option.deny",
};

/** An answer OMP offers, in the phone's language; the value sent back stays OMP's. */
export function optionLabel(option: string): string {
  const key = OPTION_LABELS[option];
  if (key !== undefined) return t(key);
  const session = /^Approve (\S+) for this session$/.exec(option);
  if (session !== null) return t("approval.option.approveForSession", { tool: session[1] ?? "" });
  const directory = /^(Always )?Approve Directory: (.+)$/.exec(option);
  if (directory !== null) {
    return t(directory[1] === undefined ? "approval.option.approveDirectory" : "approval.option.alwaysApproveDirectory", { path: directory[2] ?? "" });
  }
  return option;
}

const LEVELS: Record<string, Key> = {
  off: "level.off",
  minimal: "level.minimal",
  low: "level.low",
  medium: "level.medium",
  high: "level.high",
  xhigh: "level.xhigh",
  max: "level.max",
  inherit: "level.inherit",
};

/** A thinking level (`high`) in the phone's language; an unknown one as OMP named it. */
export function levelLabel(level: string): string {
  const key = LEVELS[level];
  return key === undefined ? level : t(key);
}
