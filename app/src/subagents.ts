/**
 * Which subagents a `task` call started, and how a subagent's transcript
 * grows as the phone polls it. Free of React Native so it runs under `node --test`.
 */
import type { Held } from "./cache.ts";
import type { AgentMessage, Subagent, SubagentTranscript, ToolItem } from "./types";

/** The names a `task` call asked for (`tasks[].name`): OMP keeps each, or adds `-2`, `-3` on a repeat. */
export function taskNames(args: unknown): string[] {
  if (args === null || typeof args !== "object" || !("tasks" in args) || !Array.isArray(args.tasks)) return [];
  const names: string[] = [];
  for (const task of args.tasks) {
    if (task !== null && typeof task === "object" && "name" in task && typeof task.name === "string" && task.name !== "") names.push(task.name);
  }
  return names;
}

/** Whether OMP's id is the name asked for: as asked, after a nested parent's `Parent.` prefix, or with a repeat's `-N`. */
function named(agentId: string, name: string): boolean {
  const own = agentId.slice(agentId.lastIndexOf(".") + 1);
  return own === name || (own.startsWith(`${name}-`) && /^\d+$/.test(own.slice(name.length + 1)));
}

/**
 * The subagents a `task` call started, among those under `parent` (null: the
 * session itself). A running one names its call; a finished one is matched by
 * name, so a later call that reused a name can list the earlier one's too.
 */
export function subagentsOf(list: readonly Subagent[], parent: string | null, toolCallId: string, names: readonly string[]): Subagent[] {
  return list.filter((subagent) => {
    if ((subagent.parent ?? null) !== parent) return false;
    if (subagent.parentToolCallId !== undefined) return subagent.parentToolCallId === toolCallId;
    return names.some((name) => named(subagent.agentId, name));
  });
}

/** The messages after an answer: the held ones and what came after them, or the answer's whole list. */
export function mergeSubagent(messages: readonly AgentMessage[], held: Held | undefined, answer: Pick<SubagentTranscript, "from" | "messages">): AgentMessage[] {
  const delta = Array.isArray(answer.messages) ? answer.messages : [];
  if (held !== undefined && answer.from > 0 && answer.from === held.since && messages.length === held.since) return [...messages, ...delta];
  return delta;
}

/** The tools whose rows list subagents. */
export function isAgentCall(name: string): boolean {
  return name === "task" || name === "wait";
}

/**
 * The subagent jobs a `wait` result names. A live result carries
 * `details.jobs`; a stored one only its text, where OMP writes each job as
 * `### <id> [task] — <status>` and `<task-result id="<id>" ...>`.
 */
export function waitedNames(result: unknown): string[] {
  const names = new Set<string>();
  if (result !== null && typeof result === "object") {
    const details = "details" in result ? result.details : undefined;
    if (details !== null && typeof details === "object" && "jobs" in details && Array.isArray(details.jobs)) {
      for (const job of details.jobs) {
        if (job !== null && typeof job === "object" && "id" in job && typeof job.id === "string" && "type" in job && job.type === "task") names.add(job.id);
      }
    }
  }
  const text = resultText(result);
  for (const match of text.matchAll(/^### (\S+) \[task\]/gm)) names.add(match[1]!);
  for (const match of text.matchAll(/<task-result id="([^"]+)"/g)) names.add(match[1]!);
  return [...names];
}

function resultText(result: unknown): string {
  if (typeof result === "string") return result;
  if (result === null || typeof result !== "object" || !("content" in result) || !Array.isArray(result.content)) return "";
  return result.content
    .map((part: unknown) => (part !== null && typeof part === "object" && "text" in part && typeof part.text === "string" ? part.text : ""))
    .join("\n");
}

/**
 * The subagents one tool call is about, among those under `parent` (null: the
 * session). `task` starts them (OMP may return at once and run them in the
 * background); `wait` is where the turn then sits while they work: while it
 * runs, the ones running at its level, after it, the ones its result names.
 */
export function callSubagents(list: readonly Subagent[], parent: string | null, tool: Pick<ToolItem, "id" | "name" | "args" | "result" | "status">): Subagent[] {
  if (tool.name === "task") return subagentsOf(list, parent, tool.id, taskNames(tool.args));
  if (tool.name !== "wait") return [];
  const here = list.filter((subagent) => (subagent.parent ?? null) === parent);
  const names = waitedNames(tool.result);
  // A job id is the agent id itself, no repeat suffix to allow for.
  if (names.length > 0) return here.filter((subagent) => names.includes(subagent.agentId));
  return tool.status === "running" ? here.filter((subagent) => subagent.status === "running") : [];
}
