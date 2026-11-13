import assert from "node:assert/strict";
import { test } from "node:test";
import { AcpTranslator, historyMessages } from "../src/dsh/acp.ts";
import { applyEvent, snapshotItems } from "../src/messages.ts";

const session = "s1";
const update = (body) => ["session/update", { sessionId: session, update: body }];

/** Frames as a DSH Remote Host's pi backend sent them for one bash call (recorded, trimmed). */
const frames = [
  update({ sessionUpdate: "available_commands_update", availableCommands: [] }),
  [
    "session/request_permission",
    {
      sessionId: session,
      requestHandle: "h1",
      toolCall: { toolCallId: "t1", title: "echo probe-ok", rawInput: { command: "echo probe-ok" } },
      options: [
        { optionId: "allow_once", name: "Allow once", kind: "allow_once" },
        { optionId: "allow_always", name: "Always allow", kind: "allow_always" },
        { optionId: "reject_once", name: "Reject", kind: "reject_once" },
      ],
    },
  ],
  update({ sessionUpdate: "tool_call", toolCallId: "t1", name: "bash", title: "$ echo probe-ok", status: "pending", rawInput: { command: "echo probe-ok" } }),
  update({ sessionUpdate: "tool_call_update", toolCallId: "t1", status: "in_progress", rawOutput: { content: [{ type: "text", text: "probe-ok\n" }] } }),
  update({ sessionUpdate: "tool_call_update", toolCallId: "t1", status: "completed", rawOutput: { content: [{ type: "text", text: "probe-ok\n" }] } }),
  update({ sessionUpdate: "agent_message_chunk", messageId: "m1", content: { type: "text", text: "It printed " } }),
  update({ sessionUpdate: "agent_message_chunk", messageId: "m1", content: { type: "text", text: "`probe-ok`." } }),
  update({ sessionUpdate: "prompt_completed", stopReason: "end_turn" }),
];

function replay(translator, outputs) {
  let items = [];
  const side = [];
  for (const output of outputs) {
    if (output.type === "event") items = applyEvent(items, output.event);
    else side.push(output);
  }
  return { items, side };
}

test("a live turn renders as the prompt, the tool card with its output, then the whole reply", () => {
  const translator = new AcpTranslator();
  const outputs = [...translator.prompted("run it")];
  for (const [method, params] of frames) outputs.push(...translator.frame(method, params));
  const { items, side } = replay(translator, outputs);
  assert.deepEqual(
    items.map((item) => [item.kind, item.role ?? item.name, item.text ?? item.status]),
    [
      ["message", "user", "run it"],
      ["tool", "bash", "done"],
      ["message", "assistant", "It printed `probe-ok`."],
    ],
  );
  assert.deepEqual(items[1].result, { content: [{ type: "text", text: "probe-ok\n" }] });
  assert.equal(items[2].open, false);
  assert.equal(side.at(-1).state.isStreaming, false);
});

test("a permission request offers only one-time choices and answers the Host's handle", () => {
  const translator = new AcpTranslator();
  const [approval] = translator.frame(...frames[1]);
  assert.equal(approval.type, "approval");
  assert.deepEqual(approval.request.options, ["Allow once", "Reject"]);
  // The title already is the command: it is not repeated under it.
  assert.equal(approval.request.title, "echo probe-ok");
  assert.equal(approval.request.message, undefined);
  assert.deepEqual(translator.answer(approval.request.id, { value: "Reject" }), { handle: "h1", decision: "reject-once" });
  // Answered once: a second answer for it is not sent.
  assert.equal(translator.answer(approval.request.id, { value: "Allow once" }), undefined);
});

test("a turn that ends leaves no approval open and marks a cancelled reply as stopped", () => {
  const translator = new AcpTranslator();
  const [approval] = translator.frame(...frames[1]);
  translator.frame(...update({ sessionUpdate: "agent_message_chunk", messageId: "m1", content: { type: "text", text: "Half" } }));
  const ended = translator.ended("cancelled");
  assert.ok(ended.some((output) => output.type === "approval_resolved" && output.id === approval.request.id));
  const end = ended.find((output) => output.type === "event" && output.event.type === "message_end");
  assert.equal(end.event.message.stopReason, "aborted");
  assert.equal(translator.answer(approval.request.id, { value: "Allow once" }), undefined);
});

test("stored history renders like the live turn, without the call's echoed title line", () => {
  const events = [
    { type: "event", event: { type: "turn/start", data: { turn: 1 } } },
    { type: "event", event: { type: "user/message", data: { id: "u", role: "user", content: [{ type: "text", text: "run it" }] } } },
    { type: "event", event: { type: "tool/call", data: { callId: "t1", name: "$ echo probe-ok", arguments: '{"command":"echo probe-ok","i":"Running echo"}' } } },
    {
      type: "event",
      event: {
        type: "tool/result",
        data: {
          message: {
            id: "r",
            content: [
              {
                type: "tool-result",
                toolCallId: "t1",
                content: [
                  { type: "text", text: "$ echo probe-ok" },
                  { type: "text", text: "probe-ok\n" },
                  { type: "text", text: "probe-ok" },
                ],
              },
            ],
          },
        },
      },
    },
    { type: "event", event: { type: "assistant/message", data: { message: { id: "a", content: [{ type: "text", text: "It printed `probe-ok`." }] } } } },
  ];
  const items = snapshotItems(historyMessages(events));
  assert.deepEqual(
    items.map((item) => [item.kind, item.role ?? item.name, item.text ?? item.status]),
    [
      ["message", "user", "run it"],
      ["tool", "$ echo probe-ok", "done"],
      ["message", "assistant", "It printed `probe-ok`."],
    ],
  );
  assert.equal(items[1].intent, "Running echo");
  assert.deepEqual(items[1].result, { content: [{ type: "text", text: "probe-ok\n" }] });
});

test("an approval unanswered when the chat closed is shown again on reopen, and answered only once", () => {
  const pending = new Map();
  const before = new AcpTranslator(pending);
  const [asked] = before.frame(...frames[1]);
  // The chat closed and reopened on the same Host connection: the Host does not send the request again.
  const after = new AcpTranslator(pending);
  const [again] = after.waiting();
  assert.deepEqual(again, asked);
  assert.deepEqual(after.answer(again.request.id, { value: "Allow once" }), { handle: "h1", decision: "allow-once" });
  assert.deepEqual(new AcpTranslator(pending).waiting(), []);
});
