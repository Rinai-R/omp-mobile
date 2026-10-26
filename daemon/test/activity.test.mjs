import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Daemon, SessionEntry } from "../src/server.mjs";

/** When the session's last message was written: a minute before the test runs. */
const LAST_MESSAGE = Date.now() - 60_000;
/** The registry's idea of the last real use: a day ago. */
const LAST_USE = Date.now() - 24 * 60 * 60_000;

const fake = `#!${process.execPath}
const readline = require("node:readline");
const send = (value) => process.stdout.write(JSON.stringify(value) + "\\n");
const state = { sessionId: "s1", isStreaming: false, sessionFile: process.env.FAKE_SESSION_FILE };
send({ type: "ready", protocolVersion: 1, supportedProtocolVersions: [1] });
readline.createInterface({ input: process.stdin }).on("line", (line) => {
  const command = JSON.parse(line);
  if (command.type === "get_state") send({ id: command.id, type: "response", command: "get_state", success: true, data: state });
  else if (command.type === "get_messages") send({ id: command.id, type: "response", command: "get_messages", success: true, data: { messages: [{ role: "user", content: "hello", timestamp: Number(process.env.FAKE_MESSAGE_AT) }] } });
});
`;

function daemonWith(lastMessage, lastUse) {
  const dir = mkdtempSync(join(tmpdir(), "omp-mobile-activity-"));
  const omp = join(dir, "omp");
  writeFileSync(omp, fake, { mode: 0o755 });
  chmodSync(omp, 0o755);
  const sessionFile = join(dir, "s1.jsonl");
  writeFileSync(sessionFile, "");
  mkdirSync(join(dir, "run", "session-owners"), { recursive: true });
  Object.assign(process.env, { FAKE_SESSION_FILE: sessionFile, FAKE_MESSAGE_AT: String(lastMessage) });
  const daemon = new Daemon(
    { host: "127.0.0.1", port: 0, cwd: dir, omp, ompHome: dir, registryFile: join(dir, "sessions.json"), log: () => undefined },
    "token-0123456789",
  );
  daemon.registry.set("s1", { id: "s1", title: "one", cwd: dir, sessionFile, createdAt: 0, updatedAt: lastUse });
  return daemon;
}

test("opening a session leaves it where it was; a new message moves it to the top", async () => {
  const daemon = daemonWith(LAST_MESSAGE, LAST_USE);
  try {
    const entry = await daemon.ensureLive("s1");
    // Resuming a session makes omp emit lifecycle events; none of them is a conversation.
    entry.rpc.emit("event", { type: "agent_start" });
    entry.rpc.emit("event", { type: "agent_end" });
    entry.rpc.emit("event", { type: "turn_end" });
    entry.rpc.emit("event", { type: "tool_execution_start", toolName: "bash" });
    assert.equal(entry.updatedAt, LAST_MESSAGE, "opening or a lifecycle event does not reorder");

    entry.rpc.emit("event", { type: "message_end", message: { role: "assistant", content: "hi", timestamp: Date.now() } });
    assert.ok(entry.updatedAt > LAST_MESSAGE + 30_000, "a new message is activity");
  } finally {
    await daemon.close();
  }
});

test("a prompt moves the session to the top and is written to the registry", async () => {
  const daemon = daemonWith(LAST_MESSAGE, LAST_USE);
  const entry = Object.assign(new EventEmitter(), {
    id: "s1",
    updatedAt: LAST_MESSAGE,
    rpc: { prompt: async () => ({}) },
    onChange: () => {
      changed += 1;
    },
  });
  let changed = 0;
  const frames = [];
  const ws = { send: (text) => frames.push(JSON.parse(text)) };
  try {
    await daemon.handleClientMessage(entry, ws, JSON.stringify({ type: "prompt", text: "go" }));
    assert.ok(entry.updatedAt > LAST_MESSAGE + 30_000, "sending a prompt is activity");
    assert.equal(changed, 1, "the registry hears about it");
    assert.deepEqual(frames.at(-1), { type: "accepted", command: "prompt" });
  } finally {
    await daemon.close();
  }
});

test("a state echo from omp does not move a session", () => {
  const entry = new SessionEntry("/tmp/work", Object.assign(new EventEmitter(), {}));
  entry.updatedAt = LAST_USE;
  entry.bind();
  entry.rpc.emit("event", { type: "model_changed" });
  entry.rpc.emit("event", { type: "thinking_level_changed" });
  assert.equal(entry.updatedAt, LAST_USE);
});
