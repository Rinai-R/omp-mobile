import assert from "node:assert/strict";
import { test } from "node:test";
import { CACHED_ITEMS, CACHED_SESSIONS, CACHED_TOOL_TEXT, cacheName, forCache, stale } from "../src/cache.ts";

test("a saved transcript keeps the end of the chat and nothing still streaming", () => {
  const items = Array.from({ length: CACHED_ITEMS + 5 }, (_, i) => ({
    kind: "message",
    id: `m${i}`,
    role: "assistant",
    text: String(i),
    streaming: true,
    open: true,
  }));
  const saved = forCache(items);
  assert.equal(saved.length, CACHED_ITEMS);
  assert.equal(saved[0].id, "m5");
  assert.equal(saved.at(-1).id, `m${CACHED_ITEMS + 4}`);
  assert.ok(saved.every((item) => item.streaming === false && item.open === false));
});

test("tool output is kept as its text, cut to the cache limit; a running tool is saved as settled", () => {
  const long = "x".repeat(CACHED_TOOL_TEXT + 100);
  const [tool] = forCache([
    { kind: "tool", id: "c1", name: "bash", args: { command: "ls" }, partial: { content: [{ type: "text", text: long }], details: {} }, status: "running" },
  ]);
  assert.equal(tool.status, "done");
  assert.equal(tool.partial, undefined);
  assert.deepEqual(tool.args, { command: "ls" });
  assert.equal(tool.result.content[0].text.length, CACHED_TOOL_TEXT + 1);
  assert.ok(tool.result.content[0].text.endsWith("…"));
});

test("large tool arguments are cut to text; an error keeps its state", () => {
  const [tool] = forCache([
    { kind: "tool", id: "c1", name: "write", args: { path: "a", content: "y".repeat(CACHED_TOOL_TEXT) }, result: "denied", status: "error", isError: true },
  ]);
  assert.equal(typeof tool.args, "string");
  assert.equal(tool.args.length, CACHED_TOOL_TEXT + 1);
  assert.equal(tool.status, "error");
  assert.equal(tool.result, "denied");
});

test("only the most recently saved transcripts are kept", () => {
  const saved = Array.from({ length: CACHED_SESSIONS + 3 }, (_, i) => ({ name: `t${i}`, savedAt: i }));
  assert.deepEqual(stale(saved).map((entry) => entry.name), ["t2", "t1", "t0"]);
  assert.deepEqual(stale(saved.slice(0, CACHED_SESSIONS)), []);
});

test("cache names are stable per machine and session and differ between them", () => {
  const name = cacheName("http://100.64.0.1:7390", "01a1-session");
  assert.match(name, /^[0-9a-f]{16}$/);
  assert.equal(cacheName("http://100.64.0.1:7390", "01a1-session"), name);
  assert.notEqual(cacheName("http://100.64.0.2:7390", "01a1-session"), name);
  assert.notEqual(cacheName("http://100.64.0.1:7390", "01a1-sessioN"), name);
});
