import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import WebSocket from "ws";
import * as server from "../src/server.mjs";

const { Daemon, ensureWorkingDirectory } = server;

/** A fake omp that answers `ready` (after FAKE_READY_DELAY_MS, if set) and records its cwd. */
const fake = `#!${process.execPath}
const fs = require("node:fs");
const readline = require("node:readline");
const send = (value) => process.stdout.write(JSON.stringify(value) + "\\n");
if (process.env.FAKE_CWD_FILE) fs.writeFileSync(process.env.FAKE_CWD_FILE, process.cwd());
const state = { sessionId: "s1", isStreaming: false, sessionFile: process.env.FAKE_SESSION_FILE };
const ready = () => send({ type: "ready", protocolVersion: 1, supportedProtocolVersions: [1] });
if (process.env.FAKE_READY_DELAY_MS) setTimeout(ready, Number(process.env.FAKE_READY_DELAY_MS));
else ready();
process.on("SIGINT", () => process.exit(0));
readline.createInterface({ input: process.stdin }).on("line", (line) => {
  const command = JSON.parse(line);
  if (command.type === "get_state") send({ id: command.id, type: "response", command: "get_state", success: true, data: state });
  else if (command.type === "get_messages") send({ id: command.id, type: "response", command: "get_messages", success: true, data: { messages: [] } });
});
`;

function fakeOmp(dir) {
  const path = join(dir, "omp");
  writeFileSync(path, fake, { mode: 0o755 });
  chmodSync(path, 0o755);
  return path;
}

/**
 * A daemon whose registry names one session, `s1`, in `cwd` (which may not
 * exist yet). `env` goes to the fake omp; no listener until `listen()`.
 */
function daemonWith(cwd, { env = {}, ...options } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "omp-mobile-resume-"));
  Object.assign(process.env, { FAKE_CWD_FILE: "", FAKE_READY_DELAY_MS: "", FAKE_SESSION_FILE: "" }, env);
  const sessionFile = join(dir, "s1.jsonl");
  writeFileSync(sessionFile, "");
  process.env.FAKE_SESSION_FILE = sessionFile;
  mkdirSync(join(dir, "run", "session-owners"), { recursive: true });
  const daemon = new Daemon(
    {
      host: "127.0.0.1",
      port: 0,
      cwd: dir,
      omp: fakeOmp(dir),
      ompHome: dir,
      registryFile: join(dir, "sessions.json"),
      log: () => undefined,
      ...options,
    },
    "resume-token-0123456789",
  );
  daemon.registry.set("s1", { id: "s1", title: "one", cwd, sessionFile, createdAt: 0, updatedAt: 0 });
  return daemon;
}

test("a working directory that was removed is recreated, so the session opens", () => {
  const root = mkdtempSync(join(tmpdir(), "omp-mobile-cwd-"));
  const gone = join(root, "gone", "deeper");
  assert.equal(ensureWorkingDirectory(gone), gone);
  assert.ok(statSync(gone).isDirectory());

  // A parent that is a file cannot become a directory: a 410 with the reason.
  const file = join(root, "file");
  writeFileSync(file, "");
  assert.throws(() => ensureWorkingDirectory(join(file, "under")), /working directory is gone and cannot be recreated/);
});

test("a session whose directory was removed opens without waiting out a timeout", async () => {
  const gone = join(tmpdir(), `omp-mobile-gone-${process.pid}-${Date.now()}`);
  const daemon = daemonWith(gone);
  try {
    const started = Date.now();
    const entry = await daemon.ensureLive("s1");
    assert.ok(Date.now() - started < 10_000, `opening took ${Date.now() - started} ms`);
    assert.ok(existsSync(gone), "the directory was recreated");
    assert.equal(entry.cwd, gone);
  } finally {
    await daemon.close();
  }
});

test("the session directory is scanned and the owner locks read once per short window", async () => {
  const daemon = daemonWith(tmpdir());
  try {
    const first = await daemon.scanOmpSessions();
    const second = await daemon.scanOmpSessions();
    assert.equal(first, second, "the second call reuses the scan");
    assert.equal(daemon.owners(), daemon.owners(), "the second call reuses the lsof");
  } finally {
    await daemon.close();
  }
});

test("the socket opens before a slow omp is ready, and the snapshot follows", async () => {
  const daemon = daemonWith(tmpdir(), { env: { FAKE_READY_DELAY_MS: "400" } });
  await daemon.listen();
  const port = daemon.server.address().port;
  const socket = new WebSocket(`ws://127.0.0.1:${port}/sessions/s1/ws?token=resume-token-0123456789`);
  try {
    const openedAt = await new Promise((resolve, reject) => {
      socket.once("open", () => resolve(Date.now()));
      socket.once("error", reject);
      socket.once("unexpected-response", (_req, res) => reject(new Error(`HTTP ${res.statusCode}`)));
    });
    const snapshot = await new Promise((resolve) => {
      socket.on("message", (data) => {
        const frame = JSON.parse(String(data));
        if (frame.type === "snapshot") resolve(frame);
      });
    });
    assert.equal(snapshot.session.id, "s1");
    // The upgrade did not wait for the fake's 400 ms start.
    assert.ok(Date.now() - openedAt > 100, "the test's omp really was slow");
  } finally {
    socket.close();
    await daemon.close();
  }
});

test("a session that cannot open says why on the open socket and closes", async () => {
  const daemon = daemonWith(tmpdir());
  await daemon.listen();
  const port = daemon.server.address().port;
  const socket = new WebSocket(`ws://127.0.0.1:${port}/sessions/missing/ws?token=resume-token-0123456789`);
  try {
    const failure = await new Promise((resolve) => {
      socket.on("message", (data) => resolve(JSON.parse(String(data))));
    });
    assert.equal(failure.type, "open_failed");
    assert.equal(failure.status, 404);
    const code = await new Promise((resolve) => socket.on("close", (closed) => resolve(closed)));
    assert.equal(code, 4000);
  } finally {
    await daemon.close();
  }
});

test("an idle socket is pinged, and its frames keep the session from being reaped", async () => {
  const daemon = daemonWith(tmpdir(), { heartbeatMs: 60, idleSessionMs: 150, reapIntervalMs: 25 });
  await daemon.listen();
  const port = daemon.server.address().port;
  const socket = new WebSocket(`ws://127.0.0.1:${port}/sessions/s1/ws?token=resume-token-0123456789`);
  const frames = [];
  let sawPing;
  const pinged = new Promise((resolve) => {
    sawPing = resolve;
  });
  socket.on("message", (data) => {
    const frame = JSON.parse(String(data));
    frames.push(frame.type);
    if (frame.type === "ping") sawPing();
  });
  try {
    await new Promise((resolve, reject) => {
      socket.once("open", resolve);
      socket.once("error", reject);
    });
    // The session comes up first (the snapshot), then the beat.
    const deadline = Date.now() + 5_000;
    while (!frames.includes("snapshot") && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20));
    assert.ok(frames.includes("snapshot"), `frames: ${frames.join(", ")}`);
    await Promise.race([pinged, new Promise((resolve) => setTimeout(resolve, 2_000))]);
    assert.ok(frames.includes("ping"), `frames: ${frames.join(", ")}`);
    // The phone is still on this session, so the reaper leaves it alone.
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.equal(daemon.sessions.size, 1);
  } finally {
    socket.terminate();
    await daemon.close();
  }
});

test("a live session nobody is using is closed after the idle window", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "omp-mobile-idle-"));
  const daemon = daemonWith(cwd, { idleSessionMs: 0, reapIntervalMs: 25 });
  await daemon.listen();
  try {
    const entry = await daemon.ensureLive("s1");
    assert.equal(daemon.sessions.size, 1);
    const deadline = Date.now() + 3_000;
    while (daemon.sessions.size > 0 && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 25));
    assert.equal(daemon.sessions.size, 0, "the reaper closed the idle session");
    assert.ok(entry.closed);
    rmSync(cwd, { recursive: true, force: true });
  } finally {
    await daemon.close();
  }
});
