import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import WebSocket from "ws";
import { Daemon, FEATURES, SessionEntry } from "../src/server.mjs";
import { findSubagents, listSubagents, statusOf, subagentFile } from "../src/subagents.mjs";

const user = (text, timestamp) => ({ role: "user", timestamp, content: [{ type: "text", text }] });
const reply = (text, timestamp, stopReason = "stop") => ({ role: "assistant", timestamp, responseId: `r${timestamp}`, stopReason, content: [{ type: "text", text }] });

/** A subagent session file as OMP writes it: header, `session_init`, then message entries. */
function writeSubagent(file, { agent = "task", task = "do it", messages = [] }) {
  const lines = [
    { type: "session", version: 3, id: "x", timestamp: "2026-11-15T00:00:00.000Z", cwd: "/tmp" },
    { type: "session_init", id: "i", parentId: null, agent, task, systemPrompt: ["long"], tools: [] },
    ...messages.map((message, index) => ({ type: "message", id: `m${index}`, parentId: null, message })),
  ];
  writeFileSync(file, `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`);
}

/** A session file and, next to it, a tree of subagents: done, failed, killed, interrupted, and one nested. */
function sessionTree() {
  const dir = mkdtempSync(join(tmpdir(), "omp-mobile-subagents-"));
  const sessionFile = join(dir, "parent.jsonl");
  writeFileSync(sessionFile, "");
  const sub = join(dir, "parent");
  mkdirSync(join(sub, "Scout"), { recursive: true });
  writeSubagent(join(sub, "Scout.jsonl"), { agent: "scout", task: "  Look around  ", messages: [user("look", 1), reply("found it", 2)] });
  writeSubagent(join(sub, "Scout", "Helper.jsonl"), { messages: [user("help", 3), reply("calling", 4, "toolUse")] });
  writeSubagent(join(sub, "Broken.jsonl"), { messages: [user("go", 5), reply("boom", 6, "error")] });
  writeSubagent(join(sub, "Killed.jsonl"), { messages: [user("go", 7)] });
  writeFileSync(join(sub, "Killed.jsonl.tombstone"), "");
  writeSubagent(join(sub, "__advisor.jsonl"), { messages: [user("advise", 8)] });
  writeFileSync(join(sub, "Scout.md"), "output");
  return { dir, sessionFile, sub };
}

test("subagents are found under the session's directory, nested ones after their parent, advisors left out", () => {
  const { dir, sessionFile, sub } = sessionTree();
  try {
    assert.deepEqual(
      findSubagents(sessionFile).map((found) => [found.id, found.parent, found.aborted]),
      [
        ["Broken", null, false],
        ["Killed", null, true],
        ["Scout", null, false],
        ["Scout/Helper", "Scout", false],
      ],
    );
    assert.deepEqual(findSubagents(join(dir, "missing.jsonl")), []);
    assert.equal(subagentFile(sessionFile, "Scout/Helper"), join(sub, "Scout", "Helper.jsonl"));
    assert.equal(subagentFile(sessionFile, "../parent"), undefined, "no id leaves the session's directory");
    assert.equal(subagentFile(sessionFile, "Scout/.."), undefined);
    assert.equal(subagentFile(sessionFile, "Nobody"), undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a subagent's status: running while listed, else from its tombstone and last reply", () => {
  const done = [user("a", 1), reply("b", 2)];
  const stepping = [user("a", 1), reply("b", 2, "toolUse")];
  assert.equal(statusOf({ aborted: false, live: { status: "running" }, messages: done }), "running");
  assert.equal(statusOf({ aborted: false, messages: done }), "completed");
  assert.equal(statusOf({ aborted: true, messages: done }), "aborted");
  assert.equal(statusOf({ aborted: false, messages: [user("a", 1), reply("b", 2, "error")] }), "failed");
  assert.equal(statusOf({ aborted: false, messages: [user("a", 1), reply("b", 2, "aborted")] }), "aborted");
  assert.equal(statusOf({ aborted: false, messages: stepping }), "aborted", "its omp exited mid-step");
  assert.equal(statusOf({ aborted: false, unsure: true, messages: stepping }), "running", "a live omp that could not say");
  assert.equal(statusOf({ aborted: false, unsure: true, messages: done }), "completed");
});

test("the list carries agent type, assignment, status and a live omp's description", () => {
  const { dir, sessionFile, sub } = sessionTree();
  try {
    const running = [{ id: "Helper", status: "running", description: "Helping", parentToolCallId: "call-1", sessionFile: join(sub, "Scout", "Helper.jsonl") }];
    const byId = Object.fromEntries(listSubagents(sessionFile, running).map((entry) => [entry.id, entry]));
    assert.deepEqual(Object.keys(byId), ["Broken", "Killed", "Scout", "Scout/Helper"]);
    assert.equal(byId.Scout.agent, "scout");
    assert.equal(byId.Scout.task, "Look around");
    assert.equal(byId.Scout.status, "completed");
    assert.equal(byId.Scout.messageCount, 2);
    assert.equal(byId.Broken.status, "failed");
    assert.equal(byId.Killed.status, "aborted");
    assert.deepEqual(
      [byId["Scout/Helper"].status, byId["Scout/Helper"].description, byId["Scout/Helper"].parentToolCallId, byId["Scout/Helper"].parent],
      ["running", "Helping", "call-1", "Scout"],
    );
    assert.equal(listSubagents(sessionFile).find((entry) => entry.id === "Scout/Helper").status, "aborted", "no omp runs it");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** A live session whose fake omp lists `running` as `get_subagents` would. */
async function liveSession(daemon, dir, sessionFile, running) {
  const rpc = Object.assign(new EventEmitter(), {
    extensionRequests: new Map(),
    getState: async () => ({ sessionId: "s1", isStreaming: false, sessionFile }),
    getMessages: async () => ({ messages: [] }),
    subagents: async () => running(),
    close() {},
  });
  const entry = new SessionEntry(dir, rpc);
  await entry.hydrate();
  entry.bind();
  daemon.sessions.set(entry.id, entry);
  return { entry, rpc };
}

test("GET /sessions/:id/subagents and /subagents/:agent serve a live session's subagents", async () => {
  const { dir, sessionFile, sub } = sessionTree();
  const token = "subagents-token-0123456789";
  const daemon = new Daemon({ host: "127.0.0.1", port: 0, cwd: dir, ompHome: dir, registryFile: join(dir, "sessions.json") }, token);
  let running = [{ id: "Helper", status: "running", sessionFile: join(sub, "Scout", "Helper.jsonl") }];
  const { rpc } = await liveSession(daemon, dir, sessionFile, () => running);
  await daemon.listen();
  const base = `http://127.0.0.1:${daemon.server.address().port}`;
  const get = (path) => fetch(`${base}${path}`, { headers: { authorization: `Bearer ${token}` } });
  try {
    assert.ok(FEATURES.includes("subagents"));
    assert.ok((await (await fetch(`${base}/hello`)).json()).features.includes("subagents"));
    assert.equal((await fetch(`${base}/sessions/s1/subagents`)).status, 401, "token as every route");

    const list = (await (await get("/sessions/s1/subagents")).json()).subagents;
    assert.deepEqual(
      list.map((entry) => [entry.id, entry.status]),
      [
        ["Broken", "failed"],
        ["Killed", "aborted"],
        ["Scout", "completed"],
        ["Scout/Helper", "running"],
      ],
    );

    const whole = await (await get(`/sessions/s1/subagents/${encodeURIComponent("Scout/Helper")}`)).json();
    assert.equal(whole.subagent.id, "Scout/Helper");
    assert.equal(whole.subagent.status, "running");
    assert.deepEqual([whole.from, whole.total, whole.messages.length], [0, 2, 2]);

    // The phone holds both messages: only what came after is sent.
    const helper = join(sub, "Scout", "Helper.jsonl");
    writeSubagent(helper, { messages: [user("help", 3), reply("calling", 4, "toolUse"), reply("done", 9)] });
    running = [];
    const delta = await (await get(`/sessions/s1/subagents/Scout%2FHelper?since=2&last=${encodeURIComponent("assistant:4:r4")}`)).json();
    assert.deepEqual([delta.from, delta.total, delta.messages.map((message) => message.timestamp)], [2, 3, [9]]);
    assert.equal(delta.subagent.status, "completed");

    assert.equal((await get("/sessions/s1/subagents/Nobody")).status, 404);
    assert.equal((await get(`/sessions/s1/subagents/${encodeURIComponent("../parent")}`)).status, 404);
    assert.equal((await get("/sessions/nope/subagents")).status, 404);

    // An omp that cannot list its subagents: an unfinished transcript is taken as running.
    rpc.subagents = async () => {
      throw new Error("unknown command");
    };
    writeSubagent(helper, { messages: [user("help", 3), reply("calling", 4, "toolUse")] });
    const unsure = (await (await get("/sessions/s1/subagents")).json()).subagents;
    assert.equal(unsure.find((entry) => entry.id === "Scout/Helper").status, "running");

    // Lifecycle frames reach the session socket as `subagent` frames; progress ticks do not.
    const socket = new WebSocket(`${base.replace("http", "ws")}/sessions/s1/ws?token=${token}`);
    const frame = new Promise((resolve, reject) => {
      socket.on("message", (data) => {
        const parsed = JSON.parse(String(data));
        if (parsed.type === "snapshot") {
          rpc.emit("event", { type: "subagent_progress", payload: { index: 0, progress: { id: "Helper" } } });
          rpc.emit("event", { type: "subagent_lifecycle", payload: { id: "Helper", agent: "task", status: "completed", sessionFile: helper, parentToolCallId: "call-1", index: 0 } });
        } else if (parsed.type !== "ping") resolve(parsed);
      });
      socket.on("error", reject);
    });
    assert.deepEqual(await frame, {
      type: "subagent",
      subagent: { id: "Scout/Helper", agentId: "Helper", agent: "task", status: "completed", parentToolCallId: "call-1" },
    });
    socket.terminate();
  } finally {
    await daemon.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a session no omp runs lists its subagents from its file", async () => {
  const { dir, sessionFile } = sessionTree();
  const token = "subagents-token-0123456789";
  const daemon = new Daemon({ host: "127.0.0.1", port: 0, cwd: dir, ompHome: dir, registryFile: join(dir, "sessions.json") }, token);
  daemon.registry.set("old", { id: "old", title: "Old", cwd: dir, sessionFile, createdAt: 1, updatedAt: 1 });
  await daemon.listen();
  const base = `http://127.0.0.1:${daemon.server.address().port}`;
  try {
    const response = await fetch(`${base}/sessions/old/subagents?token=${token}`);
    assert.equal(response.status, 200);
    const { subagents } = await response.json();
    assert.equal(subagents.find((entry) => entry.id === "Scout/Helper").status, "aborted", "nothing runs it any more");
    const scout = await (await fetch(`${base}/sessions/old/subagents/Scout?token=${token}`)).json();
    assert.deepEqual(scout.messages.map((message) => message.role), ["user", "assistant"]);
  } finally {
    await daemon.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
