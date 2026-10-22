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
