import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { appendFileSync, existsSync, mkdtempSync, readdirSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import WebSocket from "ws";
import { Daemon, FEATURES, SessionEntry } from "../src/server.mjs";
import { RECENT_MS, TranscriptStore, deltaBody, deltaFrom, deltaQuery, fingerprint } from "../src/transcripts.mjs";

const messages = [
  { role: "user", timestamp: 1, content: "hi" },
  { role: "assistant", timestamp: 2, responseId: "r1", content: [] },
  { role: "toolResult", timestamp: 3, toolCallId: "c1", content: [] },
  { role: "assistant", timestamp: 4, responseId: "r2", content: [] },
];

test("a fingerprint is role, timestamp and the tool call or reply id", () => {
  assert.equal(fingerprint(messages[0]), "user:1:");
  assert.equal(fingerprint(messages[1]), "assistant:2:r1");
  assert.equal(fingerprint(messages[2]), "toolResult:3:c1");
  assert.equal(fingerprint({ role: "toolResult", timestamp: 5, toolCallId: "c", responseId: "r" }), "toolResult:5:c");
  assert.equal(fingerprint(null), "");
  assert.equal(fingerprint({}), "::");
});

test("a delta starts after the phone's copy only when that copy lines up", () => {
  assert.equal(deltaFrom(messages, 2, "assistant:2:r1"), 2);
  assert.equal(deltaFrom(messages, 4, "assistant:4:r2"), 4, "a phone that holds everything gets nothing new");
  assert.equal(deltaFrom(messages, 2, "assistant:2:other"), 0, "a different message at that place: everything");
  assert.equal(deltaFrom(messages, 5, "assistant:4:r2"), 0, "more than the daemon holds: everything");
  assert.equal(deltaFrom(messages, 0, ""), 0);
  assert.equal(deltaFrom(messages, 2, ""), 0);
  assert.equal(deltaFrom(messages, 1.5, "user:1:"), 0);
  const body = deltaBody({ session: { id: "s" }, state: {}, messages }, { since: 3, last: "toolResult:3:c1" });
  assert.deepEqual([body.from, body.total, body.messages.length], [3, 4, 1]);
  assert.equal(body.messages[0], messages[3]);
  const whole = deltaBody({ session: { id: "s" }, state: {}, messages });
  assert.deepEqual([whole.from, whole.total, whole.messages.length], [0, 4, 4]);
});

test("since and last parse leniently: anything malformed asks for everything", () => {
  assert.deepEqual(deltaQuery(new URLSearchParams("since=12&last=a%3A1%3A")), { since: 12, last: "a:1:" });
  assert.deepEqual(deltaQuery(new URLSearchParams("")), { since: 0, last: "" });
  assert.equal(deltaQuery(new URLSearchParams("since=-3")).since, 0);
  assert.equal(deltaQuery(new URLSearchParams("since=1.5")).since, 0);
  assert.equal(deltaQuery(new URLSearchParams("since=1e3")).since, 0);
});

function sessionFile(dir, name = "s1.jsonl") {
  const path = join(dir, name);
  writeFileSync(path, '{"type":"session"}\n');
  return path;
}

test("the store serves a transcript while its session file is unchanged", () => {
  const dir = mkdtempSync(join(tmpdir(), "omp-mobile-transcripts-"));
  const store = new TranscriptStore(join(dir, "transcripts"));
  const file = sessionFile(dir);
  assert.equal(store.read("s1", file), undefined, "nothing saved yet");
  assert.equal(store.write("s1", { sessionFile: file, messages, state: { isStreaming: true }, session: { id: "s1", status: "streaming", waiting: 1, updatedAt: 5 } }), true);
  const saved = store.read("s1", file);
  assert.equal(saved.messages.length, 4);
  assert.equal(saved.state.isStreaming, false, "no omp runs for a saved transcript");
  assert.equal(saved.session.status, "idle");
  assert.equal(saved.session.waiting, 0);
  assert.equal(saved.session.updatedAt, 5, "dated by its last activity, not by the file omp rewrote on exit");
  assert.equal(store.read("s1", undefined)?.id, "s1", "the record's own file is checked when the caller knows none");
  assert.equal(store.read("s1", join(dir, "other.jsonl")), undefined, "known by another file now");
  assert.equal(store.read("other", file), undefined);

  // A terminal omp writes the session: stale, never served again.
  appendFileSync(file, '{"type":"message"}\n');
  assert.equal(store.read("s1", file), undefined);
  // Same size, another time: stale too.
  store.write("s1", { sessionFile: file, messages, state: {}, session: { id: "s1" } });
  assert.ok(store.read("s1", file));
  utimesSync(file, new Date(), new Date(Date.now() + 5_000));
  assert.equal(store.read("s1", file), undefined);

  assert.equal(store.write("s2", { sessionFile: join(dir, "missing.jsonl"), messages, state: {}, session: {} }), false, "no file, no record");
  assert.equal(store.write("s2", { sessionFile: undefined, messages, state: {}, session: {} }), false);
});

test("a corrupt or foreign record is not served, and ids that are not file names do not collide", () => {
  const dir = mkdtempSync(join(tmpdir(), "omp-mobile-transcripts-"));
  const store = new TranscriptStore(dir);
  const file = sessionFile(dir, "x.jsonl");
  writeFileSync(store.path("s1"), "{not json");
  assert.equal(store.read("s1", file), undefined);
  writeFileSync(store.path("s1"), JSON.stringify({ v: 99, id: "s1", messages: [] }));
  assert.equal(store.read("s1", file), undefined);
  assert.notEqual(store.path("a/b"), store.path("a_b"));
  store.write("a/b", { sessionFile: file, messages: [messages[0]], state: {}, session: {} });
  store.write("a_b", { sessionFile: file, messages, state: {}, session: {} });
  assert.equal(store.read("a/b", file).messages.length, 1);
  assert.equal(store.read("a_b", file).messages.length, 4);
});

test("prune keeps sessions active in the last 24 hours and drops the rest and the stale", () => {
  const dir = mkdtempSync(join(tmpdir(), "omp-mobile-transcripts-"));
  const store = new TranscriptStore(join(dir, "t"));
  const fresh = sessionFile(dir, "fresh.jsonl");
  const old = sessionFile(dir, "old.jsonl");
  const changed = sessionFile(dir, "changed.jsonl");
  const longAgo = new Date(Date.now() - RECENT_MS - 60_000);
  utimesSync(old, longAgo, longAgo);
  for (let i = 0; i < 60; i += 1) {
    // Many recent ones: nothing is evicted by count.
    store.write(`fresh${i}`, { sessionFile: fresh, messages, state: {}, session: { updatedAt: Date.now() } });
  }
  store.write("old", { sessionFile: old, messages, state: {}, session: { updatedAt: longAgo.getTime() } });
  store.write("changed", { sessionFile: changed, messages, state: {}, session: { updatedAt: Date.now() } });
  appendFileSync(changed, "more\n");
  writeFileSync(join(store.dir, "broken.json"), "{");
  writeFileSync(join(store.dir, "left.json.1-1.tmp"), "{");
  utimesSync(join(store.dir, "left.json.1-1.tmp"), longAgo, longAgo);
  assert.equal(store.prune(), 3);
  const left = readdirSync(store.dir);
  assert.equal(left.length, 60);
  assert.ok(left.every((name) => name.startsWith("fresh")));
  assert.equal(new TranscriptStore(join(dir, "none")).prune(), 0, "no directory yet");
});

/** A fake omp behind a SessionEntry: messages, state, and an exit the test triggers. */
function fakeRpc(id, file, list) {
  return Object.assign(new EventEmitter(), {
    extensionRequests: new Map(),
    getState: async () => ({ sessionId: id, isStreaming: false, sessionFile: file, model: { id: "m" } }),
    getMessages: async () => ({ messages: list }),
    close() {
      this.emit("closed", { reason: "exit 0", stderr: "" });
      return Promise.resolve("exited");
    },
  });
}

async function liveDaemon(dir, token) {
  const daemon = new Daemon({ host: "127.0.0.1", port: 0, cwd: dir, ompHome: dir, omp: join(dir, "no-omp"), registryFile: join(dir, "sessions.json") }, token);
  await daemon.listen();
  return { daemon, base: `http://127.0.0.1:${daemon.server.address().port}` };
}

async function addSession(daemon, dir, id, list) {
  const file = sessionFile(dir, `${id}.jsonl`);
  const rpc = fakeRpc(id, file, list);
  const entry = new SessionEntry(dir, rpc);
  await entry.hydrate();
  entry.onClosed = (closed) => daemon.sessionClosed(closed);
  entry.bind();
  daemon.sessions.set(id, entry);
  daemon.remember(entry);
  return { entry, rpc, file };
}

function snapshotOf(url) {
  const socket = new WebSocket(url);
  return new Promise((resolve, reject) => {
    socket.on("message", (data) => {
      const frame = JSON.parse(String(data));
      if (frame.type === "snapshot" || frame.type === "open_failed") {
        socket.terminate();
        resolve(frame);
      }
    });
    socket.on("error", reject);
  });
}

test("the session socket sends a delta when since/last line up, everything otherwise", async () => {
  const dir = mkdtempSync(join(tmpdir(), "omp-mobile-delta-"));
  const token = "delta-token-0123456789";
  const { daemon, base } = await liveDaemon(dir, token);
  try {
    assert.ok(FEATURES.includes("transcript-sync"));
    const hello = await (await fetch(`${base}/hello`)).json();
    assert.ok(hello.features.includes("transcript-sync"));
    await addSession(daemon, dir, "s1", messages);
    const ws = `${base.replace("http", "ws")}/sessions/s1/ws?token=${token}`;

    const whole = await snapshotOf(ws);
    assert.deepEqual([whole.from, whole.total, whole.messages.length], [0, 4, 4]);

    const delta = await snapshotOf(`${ws}&since=2&last=${encodeURIComponent("assistant:2:r1")}`);
    assert.deepEqual([delta.from, delta.total, delta.messages.length], [2, 4, 2]);
    assert.equal(delta.messages[0].toolCallId, "c1");
    assert.equal(delta.session.id, "s1");
    assert.equal(delta.state.model.id, "m");

    const none = await snapshotOf(`${ws}&since=4&last=${encodeURIComponent("assistant:4:r2")}`);
    assert.deepEqual([none.from, none.total, none.messages.length], [4, 4, 0]);

    const mismatch = await snapshotOf(`${ws}&since=2&last=${encodeURIComponent("assistant:2:other")}`);
    assert.deepEqual([mismatch.from, mismatch.total, mismatch.messages.length], [0, 4, 4], "a copy that does not line up gets everything");
  } finally {
    await daemon.close();
  }
});

test("/transcript answers live sessions from memory, closed ones from disk without an omp, else 404", async () => {
  const dir = mkdtempSync(join(tmpdir(), "omp-mobile-transcript-"));
  const token = "transcript-token-0123456789";
  const { daemon, base } = await liveDaemon(dir, token);
  const get = (path) => fetch(`${base}${path}`, { headers: { authorization: `Bearer ${token}` } });
  try {
    assert.equal((await fetch(`${base}/sessions/s1/transcript`)).status, 401, "token as every route");
    const unknown = await get("/sessions/nope/transcript");
    assert.equal(unknown.status, 404);
    assert.deepEqual(await unknown.json(), { error: "not cached" });

    const { entry, rpc, file } = await addSession(daemon, dir, "s1", [...messages]);
    const live = await (await get(`/sessions/s1/transcript?since=3&last=${encodeURIComponent("toolResult:3:c1")}`)).json();
    assert.deepEqual([live.from, live.total, live.messages.length], [3, 4, 1]);
    assert.equal(live.session.id, "s1");

    rpc.emit("event", { type: "message_end", message: { role: "user", timestamp: 9, content: "more" } });
    const grown = await (await get(`/sessions/s1/transcript?since=4&last=${encodeURIComponent("assistant:4:r2")}`)).json();
    assert.deepEqual([grown.from, grown.total, grown.messages.length], [4, 5, 1]);

    // The omp exits (the reaper closes it): the transcript is saved, and served with no omp at all.
    daemon.options.idleSessionMs = 0;
    daemon.reapIdleSessions();
    assert.equal(entry.closed, true);
    assert.equal(daemon.sessions.has("s1"), false);
    assert.ok(existsSync(daemon.transcripts.path("s1")), "saved when omp exited");
    const starts = [];
    daemon.ensureLive = (id) => {
      starts.push(id);
      return Promise.reject(new Error("must not start an omp"));
    };
    const disk = await get(`/sessions/s1/transcript?since=4&last=${encodeURIComponent("assistant:4:r2")}`);
    assert.equal(disk.status, 200);
    const saved = await disk.json();
    assert.deepEqual([saved.from, saved.total, saved.messages.length], [4, 5, 1]);
    assert.equal(saved.session.status, "idle");
    const all = await (await get("/sessions/s1/transcript")).json();
    assert.deepEqual([all.from, all.total], [0, 5]);
    assert.deepEqual(starts, []);
    assert.ok(daemon.registry.get("s1").updatedAt >= entry.updatedAt, "the registry knows when it was last active");

    // A terminal omp writes the session: the saved copy is stale.
    appendFileSync(file, '{"type":"message"}\n');
    assert.equal((await get("/sessions/s1/transcript")).status, 404);

    // A session closed from the phone is forgotten, saved copy included.
    const second = await addSession(daemon, dir, "s2", messages);
    second.entry.close();
    assert.ok(existsSync(daemon.transcripts.path("s2")));
    const third = await addSession(daemon, dir, "s3", messages);
    assert.equal((await fetch(`${base}/sessions/s3`, { method: "DELETE", headers: { authorization: `Bearer ${token}` } })).status, 200);
    assert.equal(third.entry.closed, true);
    assert.equal(existsSync(daemon.transcripts.path("s3")), false);
    assert.equal(daemon.registry.has("s3"), false);
  } finally {
    await daemon.close();
  }
});

test("stopping the daemon saves the transcripts of its live sessions; the next start prunes old ones", async () => {
  const dir = mkdtempSync(join(tmpdir(), "omp-mobile-shutdown-"));
  const token = "shutdown-token-0123456789";
  const first = await liveDaemon(dir, token);
  // Used a minute ago: kept (a session is dated by its messages, and these are recent).
  const recent = messages.map((message, index) => ({ ...message, timestamp: Date.now() - 60_000 + index }));
  await addSession(first.daemon, dir, "s1", recent);
  await first.daemon.close();
  assert.ok(existsSync(first.daemon.transcripts.path("s1")));

  const old = sessionFile(dir, "old.jsonl");
  first.daemon.transcripts.write("old", { sessionFile: old, messages, state: {}, session: {} });
  const longAgo = new Date(Date.now() - RECENT_MS - 60_000);
  utimesSync(old, longAgo, longAgo);
  first.daemon.transcripts.write("old", { sessionFile: old, messages, state: {}, session: { updatedAt: longAgo.getTime() } });

  const second = await liveDaemon(dir, token);
  try {
    assert.equal(existsSync(second.daemon.transcripts.path("old")), false, "pruned at start");
    const response = await fetch(`${second.base}/sessions/s1/transcript?token=${token}`);
    assert.equal(response.status, 200, "served after a restart, with no omp running");
    assert.equal((await response.json()).total, 4);
    assert.equal(second.daemon.sessions.size, 0);
  } finally {
    await second.daemon.close();
  }
});
