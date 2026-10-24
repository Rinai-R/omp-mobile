import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "node:test";
import { SessionEntry } from "../src/server.mjs";

test("a session created untitled is named by its first prompt, and the registry hears it", async () => {
  const rpc = Object.assign(new EventEmitter(), {
    getState: async () => ({ sessionId: "s1", isStreaming: false }),
    getMessages: async () => ({ messages: [] }),
  });
  const entry = new SessionEntry("/tmp/work", rpc);
  await entry.hydrate();
  assert.equal(entry.title, "work");
  const changed = [];
  entry.onChange = (value) => changed.push(value.title);
  entry.bind();
  rpc.emit("event", { type: "message_end", message: { role: "user", content: [{ type: "text", text: "Fix the  flaky\nlogin test" }] } });
  rpc.emit("event", { type: "message_end", message: { role: "assistant", content: "ok" } });
  assert.equal(entry.title, "Fix the flaky login test");
  assert.deepEqual(changed, ["Fix the flaky login test"]);
});

test("model, thinking, todo and queue events refresh the state the phone holds", async () => {
  let reads = 0;
  const rpc = Object.assign(new EventEmitter(), {
    getState: async () => {
      reads += 1;
      return { sessionId: "s1", isStreaming: false, model: { provider: "fake", id: `m${reads}` } };
    },
    getMessages: async () => ({ messages: [] }),
  });
  const entry = new SessionEntry("/tmp/work", rpc);
  await entry.hydrate();
  const frames = [];
  entry.clients.add({ readyState: 1, send: (text) => frames.push(JSON.parse(text)) });
  entry.bind();

  rpc.emit("event", { type: "model_changed" });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(entry.state.model.id, "m2");
  assert.equal(frames.at(-1).type, "state");

  rpc.emit("event", { type: "todo_reminder" });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(entry.state.model.id, "m3");

  const before = reads;
  rpc.emit("event", { type: "tool_execution_end", toolCallId: "c1", toolName: "bash" });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(reads, before, "an ordinary tool event does not re-read the state");

  rpc.emit("event", { type: "tool_execution_end", toolCallId: "c2", toolName: "todo" });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(reads, before + 1, "a todo tool call does");
});

test("a session waiting on an OMP question says so in its summary", async () => {
  const rpc = Object.assign(new EventEmitter(), {
    getState: async () => ({ sessionId: "s1", isStreaming: true }),
    getMessages: async () => ({ messages: [] }),
    extensionRequests: new Map(),
  });
  const entry = new SessionEntry("/tmp/work", rpc);
  await entry.hydrate();
  assert.equal(entry.summary().waiting, 0);
  rpc.extensionRequests.set("q1", { id: "q1", method: "select", title: "Allow tool: bash" });
  assert.equal(entry.summary().waiting, 1);
  assert.equal(entry.summary().status, "streaming");
});
