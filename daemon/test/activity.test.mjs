import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { appendFileSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Daemon, SessionEntry, dormantActivity, lastActivity } from "../src/server.mjs";
import { TranscriptStore, deltaBody, deltaFrom, fingerprint } from "../src/transcripts.mjs";

test("a session's last activity is the newest timestamp on its messages", () => {
  assert.equal(lastActivity([]), undefined);
  assert.equal(lastActivity([{ timestamp: 5 }, { timestamp: 9 }, { role: "x" }]), 9);
  assert.equal(lastActivity([{ timestamp: "soon" }]), undefined);
});

test("a dormant session is dated by its file only when someone else wrote the file", () => {
  const stored = { updatedAt: 1_000, closedFile: { mtimeMs: 5_000.25, size: 300 } };
  assert.equal(dormantActivity(stored, undefined), 1_000, "not scanned: what the registry says");
  assert.equal(dormantActivity(stored, { updatedAt: 5_000.25, size: 300 }), 1_000, "the file as our omp left it on exit");
  assert.equal(dormantActivity(stored, { updatedAt: 6_000, size: 300 }), 6_000, "written again since");
  assert.equal(dormantActivity(stored, { updatedAt: 5_000.25, size: 301 }), 5_000.25, "another size: written again");
  assert.equal(dormantActivity({ updatedAt: 1_000 }, { updatedAt: 6_000, size: 1 }), 6_000, "never closed by us: the file decides");
  assert.equal(dormantActivity(stored, { updatedAt: 500, size: 1 }), 1_000, "an older file never dates it back");
});

/** A fake omp whose exit rewrites its session file, as omp does. */
function fakeRpc(id, file, list) {
  return Object.assign(new EventEmitter(), {
    extensionRequests: new Map(),
    getState: async () => ({ sessionId: id, isStreaming: false, sessionFile: file, model: { id: "m" } }),
    getMessages: async () => ({ messages: list }),
    close() {
      writeFileSync(file, `${header(id)}\n{"type":"message","rewritten":true}\n`);
      this.emit("closed", { reason: "exit 0", stderr: "" });
      return Promise.resolve("exited");
    },
  });
}

function header(id) {
  return JSON.stringify({ type: "session", id, cwd: "/tmp", timestamp: new Date(0).toISOString() });
}

test("opening, closing and the omp's exit rewrite never make a session look recently used", async () => {
  const dir = mkdtempSync(join(tmpdir(), "omp-mobile-activity-"));
  const sessions = join(dir, "agent", "sessions", "-tmp");
  mkdirSync(sessions, { recursive: true });
  const file = join(sessions, "s1.jsonl");
  writeFileSync(file, `${header("s1")}\n`);
  const used = Date.now() - 30 * 60_000;
  const messages = [
    { role: "user", timestamp: used - 1_000, content: "hi" },
    { role: "assistant", timestamp: used, responseId: "r1", content: [] },
  ];
  const daemon = new Daemon({ host: "127.0.0.1", port: 0, cwd: dir, ompHome: dir, omp: join(dir, "no-omp"), registryFile: join(dir, "sessions.json") }, "activity-token-0123456789");
  daemon.owners = () => Promise.resolve(new Map());
  const rpc = fakeRpc("s1", file, messages);
  const entry = new SessionEntry(dir, rpc);
  await entry.hydrate();
  assert.equal(entry.updatedAt, used, "opened, not used: as recent as its last message");
  entry.onClosed = (closed) => daemon.sessionClosed(closed);
  entry.bind();
  daemon.sessions.set("s1", entry);
  daemon.remember(entry);

  await entry.refreshState();
  rpc.emit("event", { type: "thinking_level_changed", thinkingLevel: "low" });
  assert.equal(entry.updatedAt, used, "state echoes are not activity");

  // The reaper closes it.
  entry.close();
  daemon.sessions.delete("s1");
  assert.ok(daemon.registry.get("s1").closedFile, "the file as the omp left it is remembered");
  const listed = (await daemon.listSessions()).find((session) => session.id === "s1");
  assert.equal(listed.updatedAt, used, "omp rewrote the file on exit; the list still dates it by its use");
  assert.equal(daemon.transcript("s1", { since: 0, last: "" }).session.updatedAt, used, "and so does the saved transcript");

  // A terminal omp writes it: that is activity, and the saved transcript is stale.
  appendFileSync(file, '{"type":"message"}\n');
  daemon.sessionScan.at = 0;
  const written = (await daemon.listSessions()).find((session) => session.id === "s1");
  assert.ok(written.updatedAt > used + 60_000, "written since: dated by the file");
  assert.throws(() => daemon.transcript("s1", { since: 0, last: "" }), /not cached/);
});

test("a turn is activity", async () => {
  const dir = mkdtempSync(join(tmpdir(), "omp-mobile-activity-"));
  const file = join(dir, "s.jsonl");
  writeFileSync(file, `${header("s")}\n`);
  const rpc = fakeRpc("s", file, [{ role: "user", timestamp: 10, content: "old" }]);
  const entry = new SessionEntry(dir, rpc);
  await entry.hydrate(5);
  assert.equal(entry.updatedAt, 10);
  entry.bind();
  const before = Date.now();
  rpc.emit("event", { type: "message_end", message: { role: "user", timestamp: before, content: "new" } });
  assert.ok(entry.updatedAt >= before);
});

const numbered = (count, start = 0) =>
  Array.from({ length: count }, (_, index) => ({ role: "assistant", timestamp: 1_000 + start + index, responseId: `r${start + index}`, content: [] }));

test("past the 5,000-message cap a phone's copy still lines up: indices are the transcript's", async () => {
  const dir = mkdtempSync(join(tmpdir(), "omp-mobile-cap-"));
  const file = join(dir, "big.jsonl");
  writeFileSync(file, `${header("big")}\n`);
  const all = numbered(5_000);
  const entry = new SessionEntry(dir, fakeRpc("big", file, all));
  await entry.hydrate();
  entry.bind();
  // The phone holds all 5,000; then three more arrive and the front is dropped.
  const held = { since: 5_000, last: fingerprint(all[4_999]) };
  for (const message of numbered(3, 5_000)) entry.rpc.emit("event", { type: "message_end", message });
  assert.equal(entry.messages.length, 5_000);
  assert.equal(entry.base, 3);

  const delta = entry.snapshot(held);
  assert.deepEqual([delta.from, delta.total, delta.messages.length], [5_000, 5_003, 3]);
  assert.equal(delta.messages[0].responseId, "r5000");
  const none = entry.snapshot({ since: 5_003, last: fingerprint(delta.messages[2]) });
  assert.deepEqual([none.from, none.total, none.messages.length], [5_003, 5_003, 0]);

  // Nothing lines up: what is held, whole, and where in the session it starts.
  const whole = entry.snapshot();
  assert.deepEqual([whole.from, whole.total, whole.messages.length, whole.base], [0, 5_000, 5_000, 3]);
  assert.equal(deltaFrom(entry.messages, 3, fingerprint(all[2]), 3), 0, "a copy that ends before what is held gets everything");

  // The saved transcript keeps the offset.
  const store = new TranscriptStore(join(dir, "t"));
  store.write("big", { sessionFile: file, messages: entry.messages, base: entry.base, state: {}, session: { updatedAt: 1 } });
  const saved = deltaBody(store.read("big", file), held);
  assert.deepEqual([saved.from, saved.total, saved.messages.length], [5_000, 5_003, 3]);
});
