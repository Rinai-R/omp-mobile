import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import WebSocket from "ws";
import { RpcSession } from "../src/rpc-session.mjs";
import * as server from "../src/server.mjs";

const { Daemon } = server;

/**
 * A fake omp that frames its output the way OMP 18's RPC mode does: one JSON
 * line per frame, at most 1 MiB under protocol v1 (a larger response becomes a
 * transport-limit error, a larger event an `rpc_frame_error`), and after
 * `negotiate_protocol` v2 a larger frame split into base64 `rpc_chunk` lines.
 * It keeps a long, uncompacted session: 120 messages of about 20 KB.
 *
 * Environment: FAKE_PID_FILE records the pid; FAKE_FAIL=get_state makes that
 * command fail; FAKE_PROMPTS appends each prompt command as a JSON line.
 */
const fake = `#!${process.execPath}
const fs = require("node:fs");
const readline = require("node:readline");
const MAX_FRAME = 1024 * 1024, MAX_REASSEMBLED = 64 * 1024 * 1024, CHUNK = 256 * 1024, PAGE_BYTES = 768 * 1024;
if (process.env.FAKE_PID_FILE) fs.writeFileSync(process.env.FAKE_PID_FILE, String(process.pid));
let version = 1, chunks = 0;
const write = (frame) => {
  const json = JSON.stringify(frame);
  const bytes = Buffer.from(json, "utf8");
  if (bytes.byteLength + 1 <= MAX_FRAME) return process.stdout.write(json + "\\n");
  if (version === 1) {
    const overflow = frame.type === "response"
      ? { id: frame.id, type: "response", command: frame.command, success: false, error: "RPC response exceeded the transport limit" }
      : { type: "rpc_frame_error", originalType: frame.type, error: "RPC frame exceeded the transport limit" };
    return process.stdout.write(JSON.stringify(overflow) + "\\n");
  }
  const chunkId = "rpc-" + (++chunks), count = Math.ceil(bytes.byteLength / CHUNK);
  let out = "";
  for (let index = 0; index < count; index++) {
    out += JSON.stringify({ type: "rpc_chunk", chunkId, index, count, byteLength: bytes.byteLength, data: bytes.subarray(index * CHUNK, (index + 1) * CHUNK).toString("base64") }) + "\\n";
  }
  process.stdout.write(out);
};
const messages = Array.from({ length: 120 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: [{ type: "text", text: "m" + i + " " + "x".repeat(20000) }], timestamp: i }));
const state = { sessionId: "big-session", isStreaming: false, sessionFile: process.env.FAKE_SESSION_FILE || "/tmp/big.jsonl", model: { provider: "fake", id: "m" } };
write({ type: "ready", protocolVersion: 1, supportedProtocolVersions: [1, 2], maxFrameBytes: MAX_FRAME, maxReassembledFrameBytes: MAX_REASSEMBLED });
const ok = (command, data) => write(data === undefined ? { id: command.id, type: "response", command: command.type, success: true } : { id: command.id, type: "response", command: command.type, success: true, data });
readline.createInterface({ input: process.stdin }).on("line", (line) => {
  const command = JSON.parse(line);
  if (process.env.FAKE_FAIL === command.type) return write({ id: command.id, type: "response", command: command.type, success: false, error: "fake failure" });
  switch (command.type) {
    case "negotiate_protocol":
      ok(command, { protocolVersion: 2 });
      version = 2;
      return;
    case "get_state": return ok(command, state);
    case "get_messages": return ok(command, { messages });
    case "get_messages_page": {
      const offset = command.cursor ? Number(Buffer.from(command.cursor, "base64url").toString()) : 0;
      const page = [];
      let bytes = 0;
      for (let at = offset; at < messages.length && page.length < (command.limit || 100); at++) {
        const size = Buffer.byteLength(JSON.stringify(messages[at]));
        if (page.length > 0 && bytes + size > PAGE_BYTES) break;
        page.push(messages[at]);
        bytes += size;
      }
      const next = offset + page.length;
      return ok(command, { messages: page, totalMessages: messages.length, ...(next < messages.length ? { nextCursor: Buffer.from(String(next)).toString("base64url") } : {}) });
    }
    case "prompt":
      if (process.env.FAKE_PROMPTS) fs.appendFileSync(process.env.FAKE_PROMPTS, JSON.stringify(command) + "\\n");
      ok(command, { agentInvoked: true });
      // A tool result far above one frame, as a big file read produces.
      write({ type: "tool_execution_end", toolCallId: "t1", toolName: "read", result: { content: [{ type: "text", text: "y".repeat(2 * 1024 * 1024) }] } });
      return;
    case "abort": return ok(command);
  }
});
`;

function fakeOmp(dir) {
  const path = join(dir, "omp");
  writeFileSync(path, fake, { mode: 0o755 });
  chmodSync(path, 0o755);
  return path;
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function until(check, ms = 4_000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await check()) return true;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return check();
}

/** A daemon whose one known session is the fake's, with env for the fake set per test. */
function daemonWith(dir, env = {}) {
  Object.assign(process.env, { FAKE_PID_FILE: "", FAKE_FAIL: "", FAKE_PROMPTS: "" }, env);
  const sessionFile = join(dir, "big.jsonl");
  writeFileSync(sessionFile, "");
  process.env.FAKE_SESSION_FILE = sessionFile;
  mkdirSync(join(dir, "run", "session-owners"), { recursive: true });
  const daemon = new Daemon(
    { host: "127.0.0.1", port: 0, cwd: dir, omp: fakeOmp(dir), ompHome: dir, registryFile: join(dir, "sessions.json"), log: () => undefined },
    "secret-token-0123456789",
  );
  daemon.registry.set("big-session", { id: "big-session", title: "big", cwd: dir, sessionFile, createdAt: 0, updatedAt: 0 });
  return daemon;
}

test("a long session whose messages exceed one RPC frame still loads, in pages over protocol v2", async () => {
  const dir = mkdtempSync(join(tmpdir(), "omp-mobile-big-"));
  const rpc = new RpcSession({ cwd: dir, ompBin: fakeOmp(dir) });
  await rpc.start();
  try {
    assert.equal(rpc.protocolVersion, 2);
    const { messages } = await rpc.getMessages();
    assert.equal(messages.length, 120);
    assert.match(messages[119].content[0].text, /^m119 /);
  } finally {
    rpc.close();
  }
});

test("an event larger than one frame arrives whole, reassembled from chunks", async () => {
  const dir = mkdtempSync(join(tmpdir(), "omp-mobile-big-"));
  const rpc = new RpcSession({ cwd: dir, ompBin: fakeOmp(dir) });
  const events = [];
  const errors = [];
  rpc.on("event", (event) => events.push(event));
  rpc.on("protocol-error", (error) => errors.push(error));
  await rpc.start();
  try {
    await rpc.prompt("read the big file");
    assert.ok(await until(() => events.some((event) => event.type === "tool_execution_end")));
    const end = events.find((event) => event.type === "tool_execution_end");
    assert.equal(end.result.content[0].text.length, 2 * 1024 * 1024);
    assert.deepEqual(errors, []);
  } finally {
    rpc.close();
  }
});

test("a resume that fails closes the omp it started, so the session is not held by a leaked child", async () => {
  const dir = mkdtempSync(join(tmpdir(), "omp-mobile-leak-"));
  const pidFile = join(dir, "pid");
  const daemon = daemonWith(dir, { FAKE_PID_FILE: pidFile, FAKE_FAIL: "get_state" });
  await assert.rejects(daemon.ensureLive("big-session"), /fake failure/);
  assert.ok(existsSync(pidFile), "the fake omp was started");
  const pid = Number(readFileSync(pidFile, "utf8"));
  assert.ok(await until(() => !alive(pid)), `omp ${pid} still runs after the failed resume`);
  assert.equal(daemon.sessions.size, 0);
});

test("a live session whose omp exited is resumed afresh, not served dead", async () => {
  const dir = mkdtempSync(join(tmpdir(), "omp-mobile-dead-"));
  const daemon = daemonWith(dir);
  const first = await daemon.ensureLive("big-session");
  assert.equal(first.messages.length, 120);
  first.rpc.child.kill("SIGKILL");
  assert.ok(await until(() => first.closed));
  const second = await daemon.ensureLive("big-session");
  assert.notEqual(second, first);
  assert.equal(second.closed, false);
  second.close();
});

test("a prompt carries the phone's images to omp; malformed images are refused whole", async () => {
  const dir = mkdtempSync(join(tmpdir(), "omp-mobile-images-"));
  const prompts = join(dir, "prompts.jsonl");
  const daemon = daemonWith(dir, { FAKE_PROMPTS: prompts });
  const entry = await daemon.ensureLive("big-session");
  const frames = [];
  const ws = { send: (text) => frames.push(JSON.parse(text)) };
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString("base64");
  try {
    await daemon.handleClientMessage(entry, ws, JSON.stringify({ type: "prompt", text: "", images: [{ data: png, mimeType: "image/png" }] }));
    assert.deepEqual(frames.at(-1), { type: "accepted", command: "prompt" });
    const sent = readFileSync(prompts, "utf8").trim().split("\n").map((line) => JSON.parse(line));
    assert.deepEqual(sent[0].images, [{ type: "image", data: png, mimeType: "image/png" }]);
    assert.equal(sent[0].message, "");

    await daemon.handleClientMessage(entry, ws, JSON.stringify({ type: "prompt", text: "hi", images: [{ data: "not base64!", mimeType: "image/png" }] }));
    assert.equal(frames.at(-1).type, "error");
    assert.equal(readFileSync(prompts, "utf8").trim().split("\n").length, 1, "nothing was sent for the bad image");
  } finally {
    entry.close();
  }
  assert.throws(() => server.promptImages([{ data: png, mimeType: "text/html" }]), /unsupported type/);
  assert.throws(() => server.promptImages(Array.from({ length: 9 }, () => ({ data: png, mimeType: "image/png" }))), /at most 8/);
  assert.deepEqual(server.promptImages(undefined), []);
});

test("a session socket that cannot open says why before it closes", async () => {
  const dir = mkdtempSync(join(tmpdir(), "omp-mobile-ws-"));
  const daemon = daemonWith(dir, { FAKE_FAIL: "get_state" });
  await daemon.listen();
  try {
    const { port } = daemon.server.address();
    const ws = new WebSocket(`ws://127.0.0.1:${port}/sessions/big-session/ws?token=secret-token-0123456789`);
    const outcome = await new Promise((resolve, reject) => {
      const frames = [];
      ws.on("message", (data) => frames.push(JSON.parse(String(data))));
      ws.on("close", (code) => resolve({ code, frames }));
      ws.on("error", reject);
    });
    assert.equal(outcome.code, 4000);
    const hello = await (await fetch(`http://127.0.0.1:${port}/hello`)).json();
    assert.deepEqual(hello.features, ["prompt-images", "takeover", "heartbeat"], "the app offers only what the daemon does");
    assert.deepEqual(outcome.frames, [{ type: "open_failed", status: 500, error: "fake failure" }]);
  } finally {
    await daemon.close();
  }
});
