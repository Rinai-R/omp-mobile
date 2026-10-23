import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { AttentionTracker, isToolApproval } from "../src/attention.mjs";
import { Daemon, SessionEntry } from "../src/server.mjs";

const session = { id: "s1", title: "Fix the login test" };
const other = { id: "s2", title: "Docs" };
const toolApproval = {
  id: "r1",
  method: "select",
  title: "Allow tool: bash",
  message: "echo hi",
  options: ["Approve once", "Approve always", "Deny"],
};
const question = { id: "r2", method: "input", title: "Which branch?" };

function tracker() {
  let clock = 1_000;
  return new AttentionTracker({ machine: "box", now: () => (clock += 1) });
}

test("an `Allow tool:` select is an approval; anything else that asks is a question", () => {
  assert.equal(isToolApproval(toolApproval), true);
  assert.equal(isToolApproval({ method: "select", title: "Pick a model" }), false);
  assert.equal(isToolApproval({ method: "confirm", title: "Allow tool: bash" }), false);
  const attention = tracker();
  const [approval] = attention.observe(session, { type: "approval", request: toolApproval });
  assert.deepEqual(approval, {
    kind: "approval",
    key: "r1",
    sessionId: "s1",
    sessionTitle: "Fix the login test",
    machine: "box",
    text: "bash · echo hi",
    time: 1_001,
  });
  const [asked] = attention.observe(session, { type: "approval", request: question });
  assert.equal(asked.kind, "question");
  assert.equal(asked.text, "Which branch?");
  // As OMP 18 sends it: the tool on the first line, its details after.
  const [real] = attention.observe(other, {
    type: "approval",
    request: { id: "r9", method: "select", title: "Allow tool: bash\nCommand: echo hi", options: ["Approve", "Deny"] },
  });
  assert.equal(real.text, "bash · Command: echo hi");
  // Fire-and-forget UI (notify, status) never reaches the tracker as a request.
  assert.deepEqual(attention.observe(session, { type: "approval", request: { id: "x", method: "notify" } }), []);
  // The same request repeated (a reconnecting client) is not news twice.
  assert.deepEqual(attention.observe(session, { type: "approval", request: toolApproval }), []);
});

test("an answer or cancellation resolves the request by key, once", () => {
  const attention = tracker();
  attention.observe(session, { type: "approval", request: toolApproval });
  attention.observe(other, { type: "approval", request: { ...question, id: "r1" } });
  const [resolved] = attention.observe(session, { type: "approval_resolved", id: "r1", reason: "answered" });
  assert.equal(resolved.kind, "resolved");
  assert.equal(resolved.key, "r1");
  assert.equal(resolved.sessionId, "s1");
  assert.equal(resolved.text, "answered");
  assert.deepEqual(attention.observe(session, { type: "approval_resolved", id: "r1" }), []);
  // The same id in another session is a different request and is still open.
  assert.deepEqual(
    attention.pending().map((frame) => [frame.sessionId, frame.key]),
    [["s2", "r1"]],
  );
  // A session whose process exits resolves what it still had open.
  const closed = attention.observe(other, { type: "closed", reason: "exit 0" });
  assert.deepEqual(closed.map((frame) => [frame.kind, frame.key, frame.text]), [["resolved", "r1", "closed"]]);
  assert.deepEqual(attention.pending(), []);
});

test("agent_end is done with the final answer, or failed on error/aborted stops and error notices", () => {
  const attention = tracker();
  const run = (events) => events.flatMap((event) => attention.observe(session, { type: "event", event }));
  const done = run([
    { type: "agent_start" },
    { type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "All  tests\npass." }] } },
    { type: "turn_end" },
    { type: "agent_end", messages: [{ role: "assistant", stopReason: "stop", content: [{ type: "text", text: "All tests pass." }] }] },
  ]);
  assert.deepEqual(done.map((frame) => [frame.kind, frame.key, frame.text]), [["done", "run:1", "All tests pass."]]);

  const errored = run([
    { type: "agent_start" },
    { type: "agent_end", messages: [{ role: "assistant", stopReason: "error", errorMessage: "rate limited", content: [] }] },
  ]);
  assert.deepEqual(errored.map((frame) => [frame.kind, frame.key, frame.text]), [["failed", "run:2", "rate limited"]]);

  // No messages on agent_end: the last assistant message_end decides.
  const aborted = run([
    { type: "agent_start" },
    { type: "message_end", message: { role: "assistant", stopReason: "aborted", content: [] } },
    { type: "agent_end", messages: [] },
  ]);
  assert.deepEqual(aborted.map((frame) => [frame.kind, frame.text]), [["failed", "Aborted"]]);

  run([{ type: "agent_start" }]);
  attention.observe(session, { type: "notice", level: "error", message: "provider down" });
  const noticed = run([{ type: "agent_end", messages: [{ role: "assistant", stopReason: "stop", content: "ok" }] }]);
  assert.deepEqual(noticed.map((frame) => [frame.kind, frame.text]), [["failed", "provider down"]]);

  // The next run starts clean.
  const clean = run([{ type: "agent_start" }, { type: "agent_end", messages: [{ role: "assistant", content: "fine" }] }]);
  assert.deepEqual(clean.map((frame) => [frame.kind, frame.text]), [["done", "fine"]]);
  // Turns inside a run, tool events and streaming are not news.
  assert.deepEqual(run([{ type: "turn_end" }, { type: "tool_execution_start" }, { type: "message_update" }]), []);
});

test("subscribers hear frames as they are folded", () => {
  const attention = tracker();
  const heard = [];
  const off = attention.subscribe((frame) => heard.push(frame.kind));
  attention.observe(session, { type: "approval", request: toolApproval });
  off();
  attention.observe(session, { type: "approval_resolved", id: "r1" });
  assert.deepEqual(heard, ["approval"]);
});

/** Read SSE blocks from a fetch body until `until` holds. */
async function readFrames(response, until) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const blocks = [];
  while (!until(blocks)) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let index;
    while ((index = buffer.indexOf("\n\n")) !== -1) {
      blocks.push(buffer.slice(0, index));
      buffer = buffer.slice(index + 2);
    }
  }
  await reader.cancel();
  return blocks;
}

test("GET /events needs the token, replays open requests, then says live and streams", async () => {
  const dir = mkdtempSync(join(tmpdir(), "omp-mobile-attention-"));
  const token = "attention-token-0123456789";
  const daemon = new Daemon({ host: "127.0.0.1", port: 0, cwd: dir, registryFile: join(dir, "sessions.json") }, token);
  const rpc = Object.assign(new EventEmitter(), {
    extensionRequests: new Map(),
    getState: async () => ({ sessionId: "s1", sessionName: "Smoke", isStreaming: false }),
    getMessages: async () => ({ messages: [] }),
    close() {},
  });
  const entry = new SessionEntry(dir, rpc);
  await entry.hydrate();
  entry.onBroadcast = (source, payload) => daemon.attention.observe(source, payload);
  entry.bind();
  daemon.sessions.set(entry.id, entry);
  rpc.emit("approval", toolApproval);
  await daemon.listen();
  const base = `http://127.0.0.1:${daemon.server.address().port}`;
  try {
    assert.equal((await fetch(`${base}/events`)).status, 401);
    const response = await fetch(`${base}/events?token=${token}`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type"), /^text\/event-stream/);
    const pending = readFrames(response, (blocks) => blocks.filter((block) => block.startsWith("data:")).length >= 3);
    await new Promise((resolve) => setTimeout(resolve, 50));
    rpc.emit("approval-resolved", { id: "r1", reason: "answered" });
    rpc.emit("event", { type: "agent_start" });
    rpc.emit("event", { type: "agent_end", messages: [{ role: "assistant", content: [{ type: "text", text: "hi" }] }] });
    const blocks = await pending;
    const live = blocks.indexOf("event: live\ndata: {}");
    assert.ok(live > 0, "live marker after the replay");
    const frames = blocks.filter((block) => block.startsWith("data:")).map((block) => JSON.parse(block.slice(5)));
    assert.deepEqual(
      frames.map((frame) => [frame.kind, frame.key, frame.sessionTitle]),
      [
        ["approval", "r1", "Smoke"],
        ["resolved", "r1", "Smoke"],
        ["done", "run:1", "Smoke"],
      ],
    );
    assert.ok(blocks.findIndex((block) => block.includes('"kind":"approval"')) < live);
  } finally {
    await daemon.close();
  }
});

const fakeOmp = `#!${process.execPath}
const readline = require("node:readline");
const send = (value) => process.stdout.write(JSON.stringify(value) + "\\n");
send({ type: "ready" });
readline.createInterface({ input: process.stdin }).on("line", (line) => {
  const command = JSON.parse(line);
  if (command.type !== "prompt") return;
  send({ id: command.id, type: "response", command: "prompt", success: true });
  send({ type: "extension_ui_request", id: "a1", method: "select", title: "Allow tool: bash", options: ["Approve", "Deny"] });
  send({ type: "extension_ui_request", id: "a2", method: "confirm", title: "Continue?" });
  send({ type: "extension_ui_request", id: "c1", method: "cancel", targetId: "a2" });
});
`;

test("RpcSession reports an answered request and one OMP cancelled itself", async () => {
  const { RpcSession } = await import("../src/rpc-session.mjs");
  const { chmodSync, writeFileSync } = await import("node:fs");
  const dir = mkdtempSync(join(tmpdir(), "omp-mobile-attention-rpc-"));
  const bin = join(dir, "omp");
  writeFileSync(bin, fakeOmp);
  chmodSync(bin, 0o755);
  const rpc = new RpcSession({ cwd: dir, ompBin: bin });
  const resolved = [];
  rpc.on("approval-resolved", (value) => resolved.push(value));
  await rpc.start();
  await rpc.prompt("go");
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.deepEqual(resolved, [{ id: "a2", reason: "cancelled" }]);
  assert.deepEqual([...rpc.extensionRequests.keys()], ["a1"]);
  rpc.respondExtension("a1", { value: "Approve" });
  assert.deepEqual(resolved.at(-1), { id: "a1", reason: "answered" });
  rpc.close();
});
