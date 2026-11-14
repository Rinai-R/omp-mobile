/**
 * Which subagents a `task` call started, and how a subagent's transcript
 * grows as the phone polls it. Free of React Native so it runs under `node --test`.
 */
import type { Held } from "./cache.ts";
import type { AgentMessage, Subagent, SubagentTranscript } from "./types";

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
