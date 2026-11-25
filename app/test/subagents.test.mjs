import assert from "node:assert/strict";
import { test } from "node:test";
import { callSubagents, isAgentCall, mergeSubagent, subagentsOf, taskNames } from "../src/subagents.ts";

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

const call = (name, extra = {}) => ({ kind: "tool", id: `${name}-call`, name, args: {}, status: "done", ...extra });
const waitText = (ids) => ({ content: [{ type: "text", text: ids.map((id) => `### ${id} [task] — completed\n<task-result id="${id}" agent="task" status="completed">`).join("\n") }] });

test("a wait call shows the subagents it waited for, named in its result", () => {
  const list = [sub("Ticker"), sub("Ticker-2"), sub("Other"), sub("Ticker/Inner")];
  // The stored result is the text only; a live one also carries details.jobs.
  assert.deepEqual(callSubagents(list, null, call("wait", { result: waitText(["Ticker"]) })).map((entry) => entry.id), ["Ticker"]);
  const live = { content: [], details: { jobs: [{ id: "Other", type: "task" }, { id: "svc", type: "bash" }] } };
  assert.deepEqual(callSubagents(list, null, call("wait", { result: live })).map((entry) => entry.id), ["Other"]);
});

test("a running wait shows what is running at its level; a finished one without names shows nothing", () => {
  const list = [sub("Ticker", { status: "running" }), sub("Done"), sub("Ticker/Inner", { status: "running" })];
  assert.deepEqual(callSubagents(list, null, call("wait", { status: "running" })).map((entry) => entry.id), ["Ticker"]);
  assert.deepEqual(callSubagents(list, "Ticker", call("wait", { status: "running" })).map((entry) => entry.id), ["Ticker/Inner"]);
  assert.deepEqual(callSubagents(list, null, call("wait", { result: { content: [{ type: "text", text: "nothing to wait for" }] } })), []);
});

test("a task call keeps matching by its names; other tools have no subagents", () => {
  const list = [sub("Scout"), sub("Fixer", { status: "running", parentToolCallId: "task-call" })];
  assert.deepEqual(callSubagents(list, null, call("task", { args: { tasks: [{ name: "Scout" }] } })).map((entry) => entry.id), ["Scout", "Fixer"]);
  assert.deepEqual(callSubagents(list, null, call("bash", { args: { command: "ls" } })), []);
  assert.equal(isAgentCall("task"), true);
  assert.equal(isAgentCall("wait"), true);
  assert.equal(isAgentCall("bash"), false);
});

test("each stored wait text form names its subagents on its own", () => {
  const list = [sub("Pacer"), sub("Pacer-2"), sub("Other")];
  const text = (body) => call("wait", { result: { content: [{ type: "text", text: body }] } });
  assert.deepEqual(callSubagents(list, null, text("## Completed (1)\n\n### Pacer-2 [task] — completed\nLabel: Pacer-2")).map((entry) => entry.id), ["Pacer-2"]);
  assert.deepEqual(callSubagents(list, null, text('<task-result id="Pacer" agent="task" status="completed">done</task-result>')).map((entry) => entry.id), ["Pacer"]);
});

test("a wait job that is not a task is not a subagent, even when a subagent has its id", () => {
  const list = [sub("Ticker"), sub("Fixer")];
  const live = { content: [], details: { jobs: [{ id: "Ticker", type: "bash" }, { id: "Fixer", type: "task" }] } };
  assert.deepEqual(callSubagents(list, null, call("wait", { result: live })).map((entry) => entry.id), ["Fixer"]);
});
