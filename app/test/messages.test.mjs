import assert from "node:assert/strict";
import { test } from "node:test";
import { applyEvent, snapshotItems, toolSummary } from "../src/messages.ts";

const user = { role: "user", content: [{ type: "text", text: "List the files" }] };
const toolTurn = { role: "assistant", content: [{ type: "toolCall", id: "c1", name: "read" }] };
const answer = { role: "assistant", content: [{ type: "text", text: "Directory is empty. Done." }] };

/** The sequence `omp --mode rpc` emits for one prompt that calls a tool; its messages carry no id. */
const turn = [
  { type: "agent_start" },
  { type: "message_start", message: user },
  { type: "message_end", message: user },
  { type: "message_start", message: { role: "assistant", content: [] } },
  { type: "message_end", message: toolTurn },
  { type: "tool_execution_start", toolCallId: "c1", toolName: "read", args: { path: "." } },
  {
    type: "tool_execution_end",
    toolCallId: "c1",
    toolName: "read",
    result: { content: [{ type: "text", text: "(empty directory)" }], details: { isDirectory: true } },
  },
  { type: "message_start", message: { role: "assistant", content: [] } },
  { type: "message_update", message: { role: "assistant" }, assistantMessageEvent: { type: "text_delta", delta: "Directory is " } },
  { type: "message_update", message: { role: "assistant" }, assistantMessageEvent: { type: "text_delta", delta: "empty." } },
  { type: "message_end", message: answer },
  { type: "turn_end" },
];

test("a tool-calling turn is one user bubble, one tool card and one answer", () => {
  const items = turn.reduce((current, event) => applyEvent(current, event), []);
  assert.deepEqual(
    items.map((item) => (item.kind === "message" ? `${item.role}:${item.text}` : `${item.kind}:${item.name}`)),
    ["user:List the files", "tool:read", "assistant:Directory is empty. Done."],
  );
  assert.ok(items.every((item) => item.kind !== "message" || (item.open === false && item.streaming === false)));
});

test("streamed text lands on the open answer before it ends", () => {
  const items = turn.slice(0, 10).reduce((current, event) => applyEvent(current, event), []);
  const last = items.at(-1);
  assert.equal(last.kind, "message");
  assert.equal(last.text, "Directory is empty.");
  assert.equal(last.streaming, true);
});

test("a tool card summarizes the result text, not its JSON", () => {
  const items = turn.reduce((current, event) => applyEvent(current, event), []);
  assert.equal(toolSummary(items.find((item) => item.kind === "tool")), "(empty directory)");
});

test("a snapshot drops tool-only assistant messages", () => {
  assert.deepEqual(
    snapshotItems([user, toolTurn, answer]).map((item) => item.kind === "message" && item.role),
    ["user", "assistant"],
  );
});
