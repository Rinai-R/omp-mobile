import assert from "node:assert/strict";
import { test } from "node:test";
import { todoPhases, todoProgress } from "../src/todos.ts";

test("OMP's todo phases parse, and malformed entries are skipped", () => {
  const phases = todoPhases([
    { name: "Build", tasks: [{ content: "map", status: "in_progress" }, { content: "port" }] },
    { name: "Empty", tasks: [] },
    { name: "Broken", tasks: [{ status: "pending" }, null] },
  ]);
  assert.deepEqual(phases, [
    { name: "Build", tasks: [{ content: "map", status: "in_progress" }, { content: "port", status: "pending" }] },
  ]);
  assert.deepEqual(todoProgress(phases), { done: 0, total: 2, current: "map" });
});

test("progress counts completed tasks and names the running one", () => {
  const phases = todoPhases([
    {
      name: "Todos",
      tasks: [
        { content: "one", status: "completed" },
        { content: "two", status: "in_progress", blocker: "waiting" },
        { content: "three", status: "pending" },
      ],
    },
  ]);
  assert.deepEqual(todoProgress(phases), { done: 1, total: 3, current: "two" });
});

test("anything that is not a phase list is no todos", () => {
  assert.deepEqual(todoPhases(undefined), []);
  assert.deepEqual(todoPhases({ name: "Todos" }), []);
  assert.deepEqual(todoProgress([]), { done: 0, total: 0, current: undefined });
});
