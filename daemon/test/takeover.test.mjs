import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import WebSocket from "ws";
import { Daemon, parseArgs } from "../src/server.mjs";
import { askOwnerToLeave, forksOf, isOmpCommand, requestPath, sessionBusy, takeoverFarewell } from "../src/takeover.mjs";
import { takeoverRequest } from "../src/omp-extension.mjs";

const root = mkdtempSync(join(tmpdir(), "omp-takeover-"));
const owners = new Set();
after(() => {
  // Test cleanup only: a fake owner that ignored everything is still running.
  for (const child of owners) if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  rmSync(root, { recursive: true, force: true });
});

const FAST = { ack: 400, extensionExit: 2_000, sigint: 1_000, sigterm: 1_000, poll: 20 };

const line = (entry) => `${JSON.stringify(entry)}\n`;
const header = (id, extra = {}) => line({ type: "session", version: 3, id, timestamp: "2026-10-24T00:00:00.000Z", cwd: root, ...extra });
const message = (role, extra = {}) => line({ type: "message", id: Math.random().toString(16).slice(2, 10), message: { role, content: [], ...extra } });

/**
 * A fake owner: a script named `omp` that holds the session's owner lock open,
 * logs each signal it gets, and behaves as `mode` says:
 * `polite` exits on SIGINT; `sigterm` ignores SIGINT and exits on SIGTERM;
 * `deaf` ignores both; `extension` takes the takeover request like the
 * omp-mobile extension (removes it, exits) and logs it.
 */
function fakeOwner(dir, { lock, sessionFile, sessionId, mode }) {
  const script = join(dir, `owner-${mode}`, "omp");
  mkdirSync(join(dir, `owner-${mode}`), { recursive: true });
  const log = join(dir, `owner-${mode}.log`);
  writeFileSync(
    script,
    `#!${process.execPath}
const fs = require("node:fs");
const [lock, sessionFile, sessionId, mode, log] = process.argv.slice(2);
const fd = fs.openSync(lock, "w");
const note = (text) => fs.appendFileSync(log, text + "\\n");
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    note(signal);
    if ((mode === "polite" && signal === "SIGINT") || (mode === "sigterm" && signal === "SIGTERM")) process.exit(0);
  });
}
if (mode === "extension") {
  const request = require("node:path").join(require("node:path").dirname(sessionFile), "." + require("node:path").basename(sessionFile) + ".omp-mobile-takeover");
  setInterval(() => {
    let body;
    try { body = JSON.parse(fs.readFileSync(request, "utf8")); } catch { return; }
    if (body.pid !== process.pid || body.sessionId !== sessionId) return;
    fs.rmSync(request);
    note("request " + body.device);
    fs.appendFileSync(sessionFile, JSON.stringify({ type: "custom", customType: "session_exit", data: { reason: "takeover" } }) + "\\n");
    process.exit(0);
  }, 50);
}
note("ready");
setInterval(() => fd, 1000);
`,
    { mode: 0o755 },
  );
  const child = spawn(script, [lock, sessionFile, sessionId, mode, log], { stdio: "ignore" });
  owners.add(child);
  const ready = new Promise((resolveReady, reject) => {
    const started = Date.now();
    const check = () => {
      if (existsSync(log) && readFileSync(log, "utf8").includes("ready")) resolveReady();
      else if (Date.now() - started > 5_000) reject(new Error("fake owner did not start"));
      else setTimeout(check, 20);
    };
    check();
  });
  return { child, ready, log: () => (existsSync(log) ? readFileSync(log, "utf8").trim().split("\n") : []) };
}

/** A recording `kill` that forwards to the real one. */
function recordingKill() {
  const sent = [];
  return {
    sent,
    kill: (pid, signal) => {
      sent.push(signal);
      process.kill(pid, signal);
    },
  };
}

function session(name, id, body = "") {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${id}.jsonl`);
  writeFileSync(file, header(id) + body);
  return { dir, file, lock: join(dir, `${id}.lock`) };
}

test("a session is mid-turn when its last message leaves the turn running", () => {
  const { file } = session("busy", "s-busy");
  assert.equal(sessionBusy(file), false, "no message yet");
  writeFileSync(file, header("s-busy") + message("user"));
  assert.equal(sessionBusy(file), true, "a prompt not answered yet");
  writeFileSync(file, header("s-busy") + message("user") + message("assistant", { stopReason: "toolUse" }));
  assert.equal(sessionBusy(file), true, "tools called");
  writeFileSync(file, header("s-busy") + message("user") + message("assistant", { stopReason: "toolUse" }) + message("toolResult"));
  assert.equal(sessionBusy(file), true, "a tool result the model has not seen");
  writeFileSync(file, header("s-busy") + message("user") + message("assistant", { stopReason: "stop" }) + line({ type: "custom", customType: "x" }));
  assert.equal(sessionBusy(file), false, "answered; later non-message entries do not count");
  writeFileSync(file, header("s-busy") + message("user") + message("assistant", { stopReason: "aborted" }));
  assert.equal(sessionBusy(file), false, "aborted");
  assert.equal(sessionBusy(join(root, "missing.jsonl")), false);
});

test("only omp is an owner the daemon will ask to leave", () => {
  assert.equal(isOmpCommand("/opt/homebrew/Cellar/omp/18.12.6/bin/omp --resume 01a1"), true);
  assert.equal(isOmpCommand("omp"), true);
  assert.equal(isOmpCommand("/usr/local/bin/node /tmp/x/omp --mode rpc"), true);
  assert.equal(isOmpCommand("vim /tmp/x.lock"), false);
  assert.equal(isOmpCommand("/usr/bin/python3 omp.py"), false);
});

test("a fork is a newer file whose header names the session as its parent", () => {
  const { dir } = session("forks", "s-forks");
  const since = Date.now() - 1_000;
  writeFileSync(join(dir, "fork.jsonl"), line({ type: "title", v: 1, title: "" }) + header("s-fork", { parentSession: "s-forks" }));
  writeFileSync(join(dir, "other.jsonl"), header("s-other", { parentSession: "elsewhere" }));
  const old = join(dir, "old-fork.jsonl");
  writeFileSync(old, header("s-old", { parentSession: "s-forks" }));
  const then = new Date(since - 60_000);
  utimesSync(old, then, then);
  assert.deepEqual(forksOf(dir, "s-forks", since), [join(dir, "fork.jsonl")]);
});

test("an owner that exits on SIGINT is never sent SIGTERM", async () => {
  const s = session("polite", "s-polite");
  const owner = fakeOwner(root, { ...s, sessionFile: s.file, sessionId: "s-polite", mode: "polite" });
  await owner.ready;
  const { sent, kill } = recordingKill();
  const left = await askOwnerToLeave({ pid: owner.child.pid, sessionId: "s-polite", sessionFile: s.file, device: "Pixel", timings: FAST, kill });
  assert.equal(left.via, "SIGINT");
  assert.deepEqual(sent, ["SIGINT"]);
  assert.equal(existsSync(requestPath(s.file)), false, "the unanswered request is cleaned up");
});

test("an owner that ignores SIGINT gets SIGTERM, and never SIGKILL", async () => {
  const s = session("sigterm", "s-term");
  const owner = fakeOwner(root, { ...s, sessionFile: s.file, sessionId: "s-term", mode: "sigterm" });
  await owner.ready;
  const { sent, kill } = recordingKill();
  const left = await askOwnerToLeave({ pid: owner.child.pid, sessionId: "s-term", sessionFile: s.file, device: "Pixel", timings: FAST, kill });
  assert.equal(left.via, "SIGTERM");
  assert.deepEqual(sent, ["SIGINT", "SIGTERM"]);
  assert.deepEqual(owner.log(), ["ready", "SIGINT", "SIGTERM"]);
});

test("an owner that will not leave keeps the session; the takeover fails with 504", async () => {
  const s = session("deaf", "s-deaf");
  const owner = fakeOwner(root, { ...s, sessionFile: s.file, sessionId: "s-deaf", mode: "deaf" });
  await owner.ready;
  const { sent, kill } = recordingKill();
  await assert.rejects(
    askOwnerToLeave({ pid: owner.child.pid, sessionId: "s-deaf", sessionFile: s.file, device: "Pixel", timings: FAST, kill }),
    (error) => error.status === 504 && /still has this session/.test(error.message),
  );
  assert.deepEqual(sent, ["SIGINT", "SIGTERM"], "no SIGKILL");
  assert.equal(owner.child.exitCode, null, "still running");
});

test("an owner with the omp-mobile extension takes the request and leaves without a signal", async () => {
  const s = session("ext", "s-ext");
  const owner = fakeOwner(root, { ...s, sessionFile: s.file, sessionId: "s-ext", mode: "extension" });
  await owner.ready;
  const { sent, kill } = recordingKill();
  const left = await askOwnerToLeave({ pid: owner.child.pid, sessionId: "s-ext", sessionFile: s.file, device: "Pixel 9", timings: FAST, kill });
  assert.equal(left.via, "extension");
  assert.deepEqual(sent, []);
  assert.deepEqual(owner.log(), ["ready", "request Pixel 9"]);
});

test("the extension takes only a fresh request for its own process and session", () => {
  const { file } = session("ext-request", "s-req");
  const path = requestPath(file);
  writeFileSync(path, JSON.stringify({ pid: 41, sessionId: "s-req", device: "Pixel", at: 1_000 }));
  assert.deepEqual(takeoverRequest(file, "s-req", 41, 2_000), { device: "Pixel" });
  assert.equal(takeoverRequest(file, "s-req", 42, 2_000), undefined, "another process");
  assert.equal(takeoverRequest(file, "s-other", 41, 2_000), undefined, "another session");
  assert.equal(takeoverRequest(file, "s-req", 41, 120_000), undefined, "stale");
  assert.equal(takeoverRequest(undefined, "s-req", 41, 2_000), undefined, "no file (an unsaved session)");
  assert.match(takeoverFarewell("Pixel"), /continues on Pixel/);
});

/** A fake `omp --mode rpc-ui` that resumes the session it is given. */
function fakeRpcOmp(dir) {
  const path = join(dir, "rpc", "omp");
  mkdirSync(join(dir, "rpc"), { recursive: true });
  writeFileSync(
    path,
    `#!${process.execPath}
const readline = require("node:readline");
const args = process.argv.slice(2);
const file = args[args.indexOf("--resume") + 1];
const id = require("node:path").basename(file, ".jsonl");
const write = (frame) => process.stdout.write(JSON.stringify(frame) + "\\n");
write({ type: "ready", protocolVersion: 1, supportedProtocolVersions: [1] });
readline.createInterface({ input: process.stdin }).on("line", (text) => {
  const command = JSON.parse(text);
  const ok = (data) => write({ id: command.id, type: "response", command: command.type, success: true, data });
  if (command.type === "get_state") return ok({ sessionId: id, sessionFile: file, isStreaming: false });
  if (command.type === "get_messages") return ok({ messages: [{ role: "user", content: "hello", timestamp: 1 }] });
  ok({});
});
`,
    { mode: 0o755 },
  );
  return path;
}

test("the daemon shows who holds a session, refuses to open it with that, and takes it over on request", async () => {
  const home = join(root, "home");
  const sessions = join(home, "agent", "sessions", "-work");
  const ownersDir = join(home, "run", "session-owners");
  mkdirSync(sessions, { recursive: true });
  mkdirSync(ownersDir, { recursive: true });
  const id = "s-daemon";
  const file = join(sessions, `${id}.jsonl`);
  writeFileSync(file, header(id) + message("user", { content: "hello" }));
  const owner = fakeOwner(join(root, "daemon"), { lock: join(ownersDir, `${id}.lock`), sessionFile: file, sessionId: id, mode: "polite" });
  await owner.ready;
  const options = {
    ...parseArgs(["--omp-home", home, "--registry-file", join(root, "registry.json"), "--port", "0"]),
    omp: fakeRpcOmp(root),
    takeoverTimings: FAST,
    log: () => undefined,
  };
  const daemon = new Daemon(options, "secret-token-0123456789");
  await daemon.listen();
  const { port } = daemon.server.address();
  const base = `http://127.0.0.1:${port}`;
  const auth = { authorization: "Bearer secret-token-0123456789" };
  try {
    const listed = (await (await fetch(`${base}/sessions`, { headers: auth })).json()).sessions;
    assert.deepEqual(listed.map((s) => [s.id, s.openElsewhere, s.owner]), [[id, true, { pid: owner.child.pid, busy: true, terminal: false }]]);

    const refused = await fetch(`${base}/sessions/${id}`, { headers: auth });
    assert.equal(refused.status, 409);
    assert.deepEqual((await refused.json()).owner, { pid: owner.child.pid, busy: true, terminal: false });
    const frames = await new Promise((resolveFrames, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/sessions/${id}/ws?token=secret-token-0123456789`);
      const got = [];
      ws.on("message", (data) => got.push(JSON.parse(String(data))));
      ws.on("close", () => resolveFrames(got));
      ws.on("error", reject);
    });
    assert.equal(frames[0].type, "open_failed");
    assert.equal(frames[0].status, 409);
    assert.equal(frames[0].owner.pid, owner.child.pid);

    // Two phones asking at once ask the owner once.
    const [first, second] = await Promise.all(
      [1, 2].map(() =>
        fetch(`${base}/sessions/${id}/takeover`, { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ device: "Pixel" }) }),
      ),
    );
    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    const taken = await first.json();
    assert.equal(taken.session.id, id);
    assert.deepEqual(taken.takeover, { pid: owner.child.pid, via: "SIGINT", waitedMs: taken.takeover.waitedMs, busy: true, forks: [] });
    assert.deepEqual(owner.log(), ["ready", "SIGINT"]);
    assert.equal((await fetch(`${base}/sessions/${id}`, { headers: auth })).status, 200, "the session is now the daemon's");

    const again = await (await fetch(`${base}/sessions/${id}/takeover`, { method: "POST", headers: auth })).json();
    assert.equal(again.takeover.via, "live", "nothing to take from a session the daemon already has");
    assert.equal((await fetch(`${base}/sessions/nope/takeover`, { method: "POST", headers: auth })).status, 404);
  } finally {
    await daemon.close();
  }
});
