import assert from "node:assert/strict";
import { test } from "node:test";
import { mergeSubagent, subagentsOf, taskNames } from "../src/subagents.ts";

const sub = (id, extra = {}) => {
  const parts = id.split("/");
  return { id, agentId: parts.at(-1), parent: parts.length > 1 ? parts.slice(0, -1).join("/") : null, status: "completed", messageCount: 0, updatedAt: 0, ...extra };
};

test("a task call's names come from its tasks, malformed ones skipped", () => {
  assert.deepEqual(taskNames({ tasks: [{ name: "Scout" }, { name: "" }, null, { task: "x" }, { name: "Fixer" }] }), ["Scout", "Fixer"]);
  assert.deepEqual(taskNames({}), []);
  assert.deepEqual(taskNames(null), []);
});

test("a task call's subagents: its own running ones, finished ones by name, at its level", () => {
  const list = [
    sub("Scout"),
    sub("Scout-2"),
    sub("Scoutish"),
    sub("Fixer", { status: "running", parentToolCallId: "other-call" }),
    sub("Fixer-2", { status: "running", parentToolCallId: "call-1" }),
    sub("Scout/Helper"),
    sub("Scout/Scout.Helper-3"),
  ];
  assert.deepEqual(
    subagentsOf(list, null, "call-1", ["Scout", "Fixer"]).map((entry) => entry.id),
    ["Scout", "Scout-2", "Fixer-2"],
  );
  assert.deepEqual(
    subagentsOf(list, "Scout", "call-9", ["Helper"]).map((entry) => entry.id),
    ["Scout/Helper", "Scout/Scout.Helper-3"],
  );
  assert.deepEqual(subagentsOf(list, null, "call-1", []).map((entry) => entry.id), ["Fixer-2"]);
});

test("a subagent's messages grow by a delta that lines up, else are replaced", () => {
  const held = [{ role: "user", timestamp: 1 }, { role: "assistant", timestamp: 2 }];
  const at = { since: 2, last: "assistant:2:" };
  assert.deepEqual(mergeSubagent(held, at, { from: 2, messages: [{ role: "assistant", timestamp: 3 }] }).length, 3);
  assert.deepEqual(mergeSubagent(held, at, { from: 0, messages: [{ role: "user", timestamp: 9 }] }), [{ role: "user", timestamp: 9 }]);
  assert.deepEqual(mergeSubagent([], undefined, { from: 0, messages: held }), held);
});
