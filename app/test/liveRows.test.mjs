import assert from "node:assert/strict";
import { test } from "node:test";
import { keepLive, prependHistory } from "../src/liveRows.ts";
import { applyEvent, snapshotItems } from "../src/messages.ts";

/** A cached copy and its tail, as a long chat opens on them. */
function cachedTailRows() {
  const head = [];
  for (let turn = 0; turn < 30; turn += 1) {
    head.push({ role: "user", content: `question ${turn}`, timestamp: turn * 10 });
    head.push({ role: "assistant", content: [{ type: "toolCall", id: `call-${turn}`, name: "read", arguments: {} }], timestamp: turn * 10 + 1 });
    head.push({ role: "toolResult", toolCallId: `call-${turn}`, content: [{ type: "text", text: "ok" }], timestamp: turn * 10 + 2 });
    head.push({ role: "assistant", content: [{ type: "text", text: `answer ${turn}` }], timestamp: turn * 10 + 3 });
  }
  const offset = 80;
  return { head, tail: head.slice(offset), offset };
}

test("the whole copy attached under the tail keeps a streaming reply, a just-sent prompt and a running tool", () => {
  const { head, tail, offset } = cachedTailRows();
  let items = snapshotItems(tail, offset);
  // Live events land before the copy is read.
  items = applyEvent(items, { type: "message_start", message: { role: "user", content: [{ type: "text", text: "and now?" }] } });
  items = applyEvent(items, { type: "message_end", message: { role: "user", content: [{ type: "text", text: "and now?" }], timestamp: 99 } });
  items = applyEvent(items, { type: "tool_execution_start", toolCallId: "live-tool", toolName: "bash", args: { command: "ls" } });
  items = applyEvent(items, { type: "tool_execution_update", toolCallId: "live-tool", partialResult: "a.txt" });
  items = applyEvent(items, { type: "message_start", message: { role: "assistant", content: [] } });
  items = applyEvent(items, { type: "message_update", message: { role: "assistant" }, assistantMessageEvent: { type: "text_delta", delta: "Half a sent" } });
  const before = items;

  const attached = prependHistory(items, snapshotItems(head.slice(0, offset), 0));
  assert.deepEqual(attached.slice(attached.length - before.length), before, "every row on screen is still there, as it was");
  assert.equal(attached.length, snapshotItems(head, 0).length - snapshotItems(tail, offset).length + before.length);
  // Later deltas still find the open reply.
  const next = applyEvent(attached, { type: "message_update", message: { role: "assistant" }, assistantMessageEvent: { type: "text_delta", delta: "ence." } });
  assert.equal(next.at(-1).text, "Half a sentence.");
  assert.equal(next.find((item) => item.id === "live-tool").partial, "a.txt");
});

test("older rows with an id already on screen are not shown twice", () => {
  const row = { kind: "message", id: "m-3", role: "user", text: "x" };
  assert.deepEqual(prependHistory([row], [{ ...row }, { kind: "message", id: "m-2", role: "user", text: "y" }]).map((item) => item.id), ["m-2", "m-3"]);
});

test("a snapshot mid-turn keeps the open reply and a running tool's output; after the turn it is the whole truth", () => {
  const stored = [
    { role: "user", content: "go", timestamp: 1 },
    { role: "assistant", content: [{ type: "toolCall", id: "t1", name: "bash", arguments: {} }], timestamp: 2 },
  ];
  let items = snapshotItems(stored);
  items = applyEvent(items, { type: "tool_execution_start", toolCallId: "t1", toolName: "bash", args: {} });
  items = applyEvent(items, { type: "tool_execution_update", toolCallId: "t1", partialResult: "line 1" });
  items = applyEvent(items, { type: "message_start", message: { role: "assistant", content: [] } });
  items = applyEvent(items, { type: "message_update", message: { role: "assistant" }, assistantMessageEvent: { type: "text_delta", delta: "Working" } });

  const rebuilt = snapshotItems(stored);
  const kept = keepLive(rebuilt, items, true);
  assert.equal(kept.find((item) => item.id === "t1").partial, "line 1");
  assert.equal(kept.at(-1).text, "Working");
  assert.equal(kept.at(-1).open, true);
  assert.equal(kept.filter((item) => item.id === "t1").length, 1);

  assert.deepEqual(keepLive(rebuilt, items, false), rebuilt, "not streaming: nothing stays open");
  const ended = applyEvent(items, { type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "Done" }] } });
  assert.equal(keepLive(rebuilt, ended, true).some((item) => item.kind === "message" && item.text === "Done"), false, "an ended message is the snapshot's to bring");
});
