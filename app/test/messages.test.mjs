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

test("a reopened chat renders the same cards as the live turn, with each result on its call", () => {
  const toolCall = { role: "assistant", content: [{ type: "toolCall", id: "c1", name: "read", arguments: { path: "." } }] };
  const toolResult = {
    role: "toolResult",
    toolCallId: "c1",
    toolName: "read",
    isError: false,
    content: [{ type: "text", text: "(empty directory)" }],
  };
  const items = snapshotItems([user, toolCall, toolResult, answer]);
  assert.deepEqual(
    items.map((item) => (item.kind === "message" ? `${item.role}:${item.text}` : `${item.kind}:${item.name}`)),
    ["user:List the files", "tool:read", "assistant:Directory is empty. Done."],
  );
  const tool = items[1];
  assert.deepEqual(tool.args, { path: "." });
  assert.equal(tool.status, "done");
  assert.equal(toolSummary(tool), "(empty directory)");
});

test("a failed result marks its call failed; a result whose call is missing keeps its own card", () => {
  const toolCall = { role: "assistant", content: [{ type: "toolCall", id: "c1", name: "bash", arguments: { command: "false" } }] };
  const failed = { role: "toolResult", toolCallId: "c1", toolName: "bash", isError: true, content: [{ type: "text", text: "exit 1" }] };
  const orphan = { role: "toolResult", toolCallId: "gone", toolName: "grep", content: [{ type: "text", text: "3 matches" }] };
  const items = snapshotItems([toolCall, failed, orphan]);
  assert.deepEqual(
    items.map((item) => `${item.name}:${item.status}`),
    ["bash:error", "grep:done"],
  );
});

const image = { type: "image", data: "blob:sha256:" + "a".repeat(64), mimeType: "image/webp" };

test("images on a user message and on a tool result reach their items", () => {
  const userWithImage = { role: "user", content: [{ type: "text", text: "look" }, image] };
  const toolCall = {
    role: "assistant",
    content: [{ type: "toolCall", id: "c1", name: "read", intent: "Reading shot.png", arguments: { path: "shot.png" } }],
  };
  const toolResult = {
    role: "toolResult",
    toolCallId: "c1",
    toolName: "read",
    content: [{ type: "text", text: "shot.png" }, image],
  };
  const items = snapshotItems([userWithImage, toolCall, toolResult]);
  assert.equal(items[0].kind, "message");
  assert.equal(items[0].images.length, 1);
  assert.equal(items[0].images[0].mimeType, "image/webp");
  assert.equal(items[1].intent, "Reading shot.png");
  assert.equal(items[1].images.length, 1);
});

test("a live tool card takes its intent and its result images from the events", () => {
  let items = applyEvent([], {
    type: "tool_execution_start",
    toolCallId: "c1",
    toolName: "read",
    args: { path: "shot.png" },
    intent: "Reading shot.png",
  });
  items = applyEvent(items, {
    type: "tool_execution_end",
    toolCallId: "c1",
    toolName: "read",
    isError: false,
    result: { content: [{ type: "text", text: "opened" }, image] },
  });
  assert.equal(items[0].intent, "Reading shot.png");
  assert.equal(items[0].images.length, 1);
  assert.equal(items[0].status, "done");
});

test("an image-only message survives message_end", () => {
  const items = applyEvent([], { type: "message_start", message: { role: "user", content: [image] } });
  const ended = applyEvent(items, { type: "message_end", message: { role: "user", content: [image] } });
  assert.equal(ended.length, 1);
  assert.equal(ended[0].text, "");
  assert.equal(ended[0].images.length, 1);
});

test("compaction and retry events explain themselves in the transcript", () => {
  let items = applyEvent([], { type: "auto_retry_start", attempt: 2, maxAttempts: 4, errorMessage: "rate limited" });
  items = applyEvent(items, { type: "auto_retry_end", success: false, finalError: "rate limited" });
  items = applyEvent(items, { type: "auto_compaction_start" });
  items = applyEvent(items, { type: "auto_compaction_end", errorMessage: "too large" });
  assert.deepEqual(
    items.map((item) => `${item.level}:${item.text}`),
    ["warning:Retrying (attempt 2/4): rate limited", "error:Retry stopped: rate limited", "info:Compacting the conversation…", "warning:Compaction failed: too large"],
  );
});

test("a read result that names a stored media path shows that image", () => {
  const hash = "c".repeat(64);
  const details = { mediaPath: `/Users/x/.omp/agent/blobs/${hash}.png`, fileSize: 1 };
  const toolResult = {
    role: "toolResult",
    toolCallId: "c1",
    toolName: "read",
    content: [{ type: "text", text: "Image metadata" }],
    details,
  };
  const items = snapshotItems([toolResult]);
  assert.equal(items[0].images.length, 1);
  assert.equal(items[0].images[0].data, `blob:sha256:${hash}`);

  const started = applyEvent([], { type: "tool_execution_start", toolCallId: "c1", toolName: "read", args: {} });
  const live = applyEvent(started, {
    type: "tool_execution_end",
    toolCallId: "c1",
    toolName: "read",
    result: { content: [{ type: "text", text: "Image metadata" }], details },
  });
  assert.equal(live[0].images[0].data, `blob:sha256:${hash}`);

  const otherStart = applyEvent([], { type: "tool_execution_start", toolCallId: "c2", toolName: "read", args: {} });
  const outside = applyEvent(otherStart, {
    type: "tool_execution_end",
    toolCallId: "c2",
    toolName: "read",
    result: { content: [], details: { mediaPath: "/tmp/shot.png" } },
  });
  assert.equal(outside[0].images, undefined);
});

test("image placeholders OMP leaves in place of dropped bytes are not images", () => {
  const items = snapshotItems([
    {
      role: "user",
      content: [
        { type: "text", text: "see" },
        { type: "image", data: "<76 bytes>", mimeType: "image/webp" },
        { type: "image", data: `blob:sha256:${"a".repeat(64)}`, mimeType: "image/png" },
        { type: "image", data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB", mimeType: "image/png" },
      ],
    },
  ]);
  assert.deepEqual(
    items[0].images.map((image) => image.data.slice(0, 12)),
    ["blob:sha256:", "iVBORw0KGgoA"],
  );
});

/** A turn whose model thinks first, as OMP stores it: thinking parts carry `thinking`, not `text`. */
const thinkingTurn = [
  { type: "message_start", message: { role: "assistant", content: [] } },
  { type: "message_update", message: { role: "assistant" }, assistantMessageEvent: { type: "thinking_delta", delta: "Look at " } },
  { type: "message_update", message: { role: "assistant" }, assistantMessageEvent: { type: "thinking_delta", delta: "the files." } },
  {
    type: "message_end",
    message: {
      role: "assistant",
      content: [
        { type: "thinking", thinking: "Look at the files.", thinkingSignature: "sig" },
        { type: "toolCall", id: "t1", name: "read", arguments: { path: "a.txt" } },
      ],
    },
  },
  { type: "tool_execution_start", toolCallId: "t1", toolName: "read", args: { path: "a.txt" } },
  { type: "tool_execution_end", toolCallId: "t1", toolName: "read", result: { content: [{ type: "text", text: "hi" }] } },
  { type: "message_start", message: { role: "assistant", content: [] } },
  { type: "message_update", message: { role: "assistant" }, assistantMessageEvent: { type: "thinking_delta", delta: "Answer now." } },
  { type: "message_update", message: { role: "assistant" }, assistantMessageEvent: { type: "text_delta", delta: "It says hi." } },
  {
    type: "message_end",
    message: {
      role: "assistant",
      content: [
        { type: "thinking", thinking: "Answer now." },
        { type: "text", text: "It says hi." },
      ],
    },
  },
  { type: "turn_end" },
  { type: "agent_end" },
];

test("thinking survives the end of its message and of the turn", () => {
  const items = thinkingTurn.reduce(applyEvent, []);
  assert.deepEqual(
    items.map((item) => [item.kind, item.kind === "message" ? item.thinking : item.status, item.kind === "message" ? item.text : undefined]),
    [
      ["message", "Look at the files.", ""],
      ["tool", "done", undefined],
      ["message", "Answer now.", "It says hi."],
    ],
  );
  for (const item of items) {
    if (item.kind !== "message") continue;
    assert.equal(item.streaming, false);
    assert.equal(typeof item.thinkingMs, "number");
  }
});

test("a reopened chat keeps the thinking of stored messages", () => {
  const items = snapshotItems([
    { role: "assistant", content: [{ type: "thinking", thinking: "Plan it." }, { type: "toolCall", id: "t1", name: "read", arguments: {} }] },
    { role: "toolResult", toolCallId: "t1", content: [{ type: "text", text: "ok" }] },
    { role: "assistant", content: [{ type: "thinking", thinking: "Wrap up." }, { type: "text", text: "Done." }] },
  ]);
  assert.deepEqual(
    items.map((item) => (item.kind === "message" ? [item.thinking, item.text] : item.kind)),
    [["Plan it.", ""], "tool", ["Wrap up.", "Done."]],
  );
});
