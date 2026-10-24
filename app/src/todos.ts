/** OMP's todo list, as `get_state` carries it. */
import { t } from "./i18n/index.ts";

export type TodoStatus = "pending" | "in_progress" | "completed" | "abandoned" | "blocked";

export interface TodoTask {
  content: string;
  status: TodoStatus | string;
  blocker?: string;
}

export interface TodoPhase {
  name: string;
  tasks: TodoTask[];
}

function taskOf(value: unknown): TodoTask | undefined {
  if (value === null || typeof value !== "object") return undefined;
  if (!("content" in value) || typeof value.content !== "string") return undefined;
  const status = "status" in value && typeof value.status === "string" ? value.status : "pending";
  if ("blocker" in value && typeof value.blocker === "string") {
    return { content: value.content, status, blocker: value.blocker };
  }
  return { content: value.content, status };
}

/** The valid phases of a `todoPhases` value; anything malformed is skipped, not rendered as garbage. */
export function todoPhases(value: unknown): TodoPhase[] {
  if (!Array.isArray(value)) return [];
  const phases: TodoPhase[] = [];
  for (const entry of value) {
    if (entry === null || typeof entry !== "object") continue;
    const tasks: TodoTask[] = [];
    if ("tasks" in entry && Array.isArray(entry.tasks)) {
      for (const task of entry.tasks) {
        const parsed = taskOf(task);
        if (parsed !== undefined) tasks.push(parsed);
      }
    }
    if (tasks.length === 0) continue;
    const name = "name" in entry && typeof entry.name === "string" ? entry.name : t("todo.phase");
    phases.push({ name, tasks });
  }
  return phases;
}

export function todoProgress(phases: readonly TodoPhase[]): { done: number; total: number; current?: string } {
  let done = 0;
  let total = 0;
  let current: string | undefined;
  for (const phase of phases) {
    for (const task of phase.tasks) {
      total += 1;
      if (task.status === "completed") done += 1;
      if (current === undefined && task.status === "in_progress") current = task.content;
    }
  }
  return { done, total, current };
}
