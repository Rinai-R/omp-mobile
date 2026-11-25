/**
 * The herdr backend against a fake `hc` (test/fixtures/fake-hc.mjs): finding
 * the herdr terminal that runs a session's omp, falling back when there is
 * none, input and interrupts, dialog keys only after checking the dialog is
 * still the same, and the session file followed for new messages.
 * No real herdr-core is involved: the fake reads its world from a JSON file.
 */
import assert from "node:assert/strict";
import { appendFileSync, chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { Herdr } from "../src/herdr.mjs";
import { Daemon } from "../src/server.mjs";

const FAKE_HC = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "fake-hc.mjs");

const omp = (address, pid, status = { app: "omp", state: "idle" }, extra = {}) => ({
  address,
  pid,
  foreground: { pid, name: "omp", argv: ["omp"], cwd: "/tmp" },
  status,
  status_ms: 100,
  turn: 3,
  title: "π > tmp",
  ...extra,
});
const shell = (address, pid) => ({ address, pid, foreground: { pid, name: "zsh", argv: ["zsh"], cwd: "/tmp" }, status: null, status_ms: null, turn: 0, title: "" });

/** A fake hc and the world it reports; `set` rewrites the world, `calls` reads what was asked of it. */
function fakeHerdr(terminals, screens = {}) {
  const dir = mkdtempSync(join(tmpdir(), "omp-mobile-herdr-"));
  const state = join(dir, "state.json");
  const log = join(dir, "calls.jsonl");
  const bin = join(dir, "hc");
  writeFileSync(bin, `#!/bin/sh\nexec "${process.execPath}" "${FAKE_HC}" "$@"\n`);
  chmodSync(bin, 0o755);
  writeFileSync(log, "");
  const world = { terminals, screens };
  const write = () => writeFileSync(state, JSON.stringify(world));
  write();
  return {
    dir,
    bin,
    env: { ...process.env, FAKE_HC_STATE: state, FAKE_HC_LOG: log },
    world,
    set(change) {
      change(world);
      write();
    },
    calls: (method) =>
      readFileSync(log, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line))
        .filter((call) => method === undefined || call.method === method),
  };
}

async function until(check, what, ms = 3_000) {
  const end = Date.now() + ms;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolveWait) => setTimeout(resolveWait, 20));
  }
}

const message = (role, text, timestamp) => ({ type: "message", id: `m${timestamp}`, parentId: null, timestamp: new Date(timestamp).toISOString(), message: { role, content: [{ type: "text", text }], timestamp } });

/** A daemon whose registry names session `s1` (file with one message), held by `pid`, with herdr `mode` on the fake. */
function daemonHeldBy(fake, pid, mode = "auto") {
  const dir = mkdtempSync(join(tmpdir(), "omp-mobile-herdr-daemon-"));
  const sessionFile = join(dir, "s1.jsonl");
  writeFileSync(
    sessionFile,
    [
      JSON.stringify({ type: "session", version: 3, id: "s1", cwd: dir, timestamp: new Date(1).toISOString() }),
      JSON.stringify({ type: "model_change", id: "mc", parentId: null, model: "acme/fast-1" }),
      JSON.stringify(message("user", "hello", 1_000)),
    ].join("\n") + "\n",
  );
  mkdirSync(join(dir, "run", "session-owners"), { recursive: true });
  const daemon = new Daemon(
    { host: "127.0.0.1", port: 0, cwd: dir, omp: "/bin/false", ompHome: dir, registryFile: join(dir, "sessions.json"), log: () => undefined, herdr: mode, hc: fake.bin, hcEnv: fake.env },
    "herdr-token-0123456789",
  );
  daemon.registry.set("s1", { id: "s1", title: "one", cwd: dir, sessionFile, createdAt: 0, updatedAt: 0 });
  daemon.owners = () => Promise.resolve(new Map([["s1", pid]]));
  return { daemon, sessionFile };
}

test("an omp herdr terminal is found by its process; a shell, or omp not in the foreground, is not", async () => {
  const fake = fakeHerdr([omp("t1", 4242), shell("t2", 99), omp("t3", 77, { app: "omp", state: "idle" }, { foreground: { pid: 78, name: "zsh", argv: ["zsh"], cwd: "/" } })]);
  const herdr = new Herdr({ bin: fake.bin, env: fake.env });
  try {
    await herdr.start();
    assert.equal(herdr.online, true);
    assert.equal(herdr.ompTerminal(4242)?.address, "t1");
    assert.equal(herdr.ompTerminal(99), undefined, "a shell is never an omp terminal");
    assert.equal(herdr.ompTerminal(77), undefined, "omp is not what runs in t3 now");
    assert.equal(herdr.ompTerminal(5), undefined);
  } finally {
    herdr.close();
  }
});

test("a herdr that does not answer leaves the daemon offline, not failing", async () => {
  const fake = fakeHerdr([omp("t1", 4242)]);
  fake.set((world) => {
    world.down = true;
  });
  const herdr = new Herdr({ bin: fake.bin, env: fake.env });
  try {
    await herdr.start();
    assert.equal(herdr.online, false);
    assert.equal(herdr.ompTerminal(4242), undefined);
  } finally {
    herdr.close();
  }
  const missing = new Herdr({ bin: join(fake.dir, "no-such-hc"), env: fake.env });
  await missing.start();
  assert.equal(missing.online, false);
  missing.close();
});

test("a session held by an omp in herdr opens through herdr, without a takeover", async () => {
  const fake = fakeHerdr([omp("t1", 4242)]);
  const { daemon } = daemonHeldBy(fake, 4242);
  try {
    await daemon.herdr.start();
    const entry = await daemon.ensureLive("s1");
    assert.equal(entry.rpc.via, "herdr");
    assert.equal(entry.summary().via, "herdr");
    assert.deepEqual(entry.messages.map((item) => item.content[0].text), ["hello"]);
    assert.equal(entry.state.model.id, "fast-1");
    const listed = (await daemon.listSessions()).find((session) => session.id === "s1");
    assert.equal(listed.via, "herdr");
    assert.notEqual(listed.openElsewhere, true, "a herdr session is not offered as a takeover");
  } finally {
    await daemon.close();
  }
});

test("before it is opened, a herdr session is listed as one, running or waiting as herdr says", async () => {
  const fake = fakeHerdr([omp("t1", 4242, { app: "omp", state: "blocked", kind: "permission" })]);
  const { daemon } = daemonHeldBy(fake, 4242);
  daemon.scanOmpSessions = () => Promise.resolve([]);
  try {
    await daemon.herdr.start();
    const listed = (await daemon.listSessions()).find((session) => session.id === "s1");
    assert.equal(listed.via, "herdr");
    assert.equal(listed.herdrTerminal, "t1");
    assert.equal(listed.openElsewhere, undefined);
    assert.equal(listed.owner, undefined);
    assert.equal(listed.waiting, 1);
  } finally {
    await daemon.close();
  }
});

test("held elsewhere, or herdr turned off, still means the takeover answer", async () => {
  const fake = fakeHerdr([omp("t1", 4242)]);
  const other = daemonHeldBy(fake, 555);
  try {
    await other.daemon.herdr.start();
    await assert.rejects(other.daemon.ensureLive("s1"), (error) => error.status === 409);
  } finally {
    await other.daemon.close();
  }
  const off = daemonHeldBy(fake, 4242, "off");
  try {
    assert.equal(off.daemon.herdr, undefined);
    await assert.rejects(off.daemon.ensureLive("s1"), (error) => error.status === 409);
  } finally {
    await off.daemon.close();
  }
});

test("a prompt is sent and a stop is an interrupt; never to a terminal that stopped being omp", async () => {
  const fake = fakeHerdr([omp("t1", 4242)]);
  const { daemon } = daemonHeldBy(fake, 4242);
  try {
    await daemon.herdr.start();
    const entry = await daemon.ensureLive("s1");
    await entry.rpc.prompt("run the tests");
    assert.deepEqual(fake.calls("terminal.send").map((call) => [call.params.terminal, call.params.text, call.params.force]), [["t1", "run the tests", undefined]]);
    await entry.rpc.abort();
    assert.deepEqual(fake.calls("terminal.interrupt").map((call) => call.params.terminal), ["t1"]);
    await assert.rejects(entry.rpc.prompt("look", [{ type: "image", data: "AA", mimeType: "image/png" }]), /image/i);

    fake.set((world) => {
      world.terminals[0].foreground = { pid: 4300, name: "zsh", argv: ["zsh"], cwd: "/tmp" };
    });
    await until(() => entry.closed, "the session to close once omp left the terminal");
    await assert.rejects(entry.rpc.prompt("rm -rf"), /not running omp/);
    assert.equal(fake.calls("terminal.send").length, 1, "nothing typed into the shell");
  } finally {
    await daemon.close();
  }
});

test("dialog keys go in only while the same dialog is up, once per dialog", async () => {
  const fake = fakeHerdr([omp("t1", 4242)], { t1: "Allow bash?\n> Yes\n  No" });
  const { daemon } = daemonHeldBy(fake, 4242);
  try {
    await daemon.herdr.start();
    const entry = await daemon.ensureLive("s1");
    const asked = new Promise((resolveAsk) => entry.rpc.once("approval", resolveAsk));
    fake.set((world) => {
      world.terminals[0].status = { app: "omp", state: "blocked", kind: "permission" };
      world.terminals[0].status_ms = 200;
    });
    const request = await asked;
    assert.equal(request.method, "keys");
    assert.match(request.screen, /Allow bash\?/);
    assert.equal(entry.openRequests().length, 1);

    // The screen moved on under the phone: no keys, and the old request is gone.
    fake.set((world) => {
      world.screens.t1 = "Allow edit?\n> Yes\n  No";
    });
    const fresh = new Promise((resolveAsk) => entry.rpc.once("approval", resolveAsk));
    await assert.rejects(entry.rpc.respondExtension(request.id, { keys: ["enter"] }), /changed/);
    assert.equal(fake.calls("terminal.keys").length, 0);
    await assert.rejects(entry.rpc.respondExtension(request.id, { keys: ["enter"] }), /unknown|answered/);

    // The phone answers the dialog as it is now, once.
    const current = await fresh;
    assert.match(current.screen, /Allow edit\?/);
    await entry.rpc.respondExtension(current.id, { keys: ["enter"] });
    assert.deepEqual(fake.calls("terminal.keys").map((call) => call.params.keys), [["enter"]]);
    await assert.rejects(entry.rpc.respondExtension(current.id, { keys: ["enter"] }), /unknown|answered/);
    assert.equal(fake.calls("terminal.keys").length, 1, "the panel works once");

    // Not blocked any more: no dialog is left open.
    fake.set((world) => {
      world.terminals[0].status = { app: "omp", state: "working" };
      world.terminals[0].status_ms = 300;
    });
    await until(() => entry.rpc.terminal?.status?.state === "working" && entry.openRequests().length === 0, "the dialog to close");
  } finally {
    await daemon.close();
  }
});

/** omp's screen with a dialog: output above, the dialog box, then the footer whose spinner and clock tick. */
const dialogScreen = (tick, choice = "> Approve") =>
  ["Warning: an extension failed to load", "╭─── $ date", "│ Tue", `╰─── elapsed ${tick}.0s ──`, "", "╭─ Allow tool: bash ──", "│ Command: date", `│ ${choice}`, "│   Deny", "╰──────────", `⠙ ${tick}s  Opus · tmp ── 4% ──`, "╰─"].join("\n");

test("the dialog box alone is shown and checked: a ticking footer does not block the keys", async () => {
  const fake = fakeHerdr([omp("t1", 4242)], { t1: dialogScreen(8) });
  const { daemon } = daemonHeldBy(fake, 4242);
  try {
    await daemon.herdr.start();
    const entry = await daemon.ensureLive("s1");
    const asked = new Promise((resolveAsk) => entry.rpc.once("approval", resolveAsk));
    fake.set((world) => {
      world.terminals[0].status = { app: "omp", state: "blocked", kind: "permission", msg: "Allow tool: bash Command: date" };
      world.terminals[0].status_ms = 200;
    });
    const request = await asked;
    assert.equal(request.screen, ["╭─ Allow tool: bash ──", "│ Command: date", "│ > Approve", "│   Deny", "╰──────────"].join("\n"));
    assert.equal(request.title, "Allow tool: bash Command: date");

    fake.set((world) => {
      world.screens.t1 = dialogScreen(9);
    });
    await entry.rpc.respondExtension(request.id, { keys: ["enter"] });
    assert.deepEqual(fake.calls("terminal.keys").map((call) => call.params.keys), [["enter"]]);
  } finally {
    await daemon.close();
  }
});

test("a different choice highlighted in the dialog is a changed dialog", async () => {
  const fake = fakeHerdr([omp("t1", 4242)], { t1: dialogScreen(8) });
  const { daemon } = daemonHeldBy(fake, 4242);
  try {
    await daemon.herdr.start();
    const entry = await daemon.ensureLive("s1");
    const asked = new Promise((resolveAsk) => entry.rpc.once("approval", resolveAsk));
    fake.set((world) => {
      world.terminals[0].status = { app: "omp", state: "blocked", kind: "permission" };
      world.terminals[0].status_ms = 200;
    });
    const request = await asked;
    fake.set((world) => {
      world.screens.t1 = dialogScreen(9, "  Approve").replace("│   Deny", "│ > Deny");
    });
    await assert.rejects(entry.rpc.respondExtension(request.id, { keys: ["enter"] }), /changed/);
    assert.equal(fake.calls("terminal.keys").length, 0);
  } finally {
    await daemon.close();
  }
});

test("messages omp appends to the session file reach the phone, and its run state follows herdr", async () => {
  const fake = fakeHerdr([omp("t1", 4242)]);
  const { daemon, sessionFile } = daemonHeldBy(fake, 4242);
  try {
    await daemon.herdr.start();
    const entry = await daemon.ensureLive("s1");
    const events = [];
    entry.rpc.on("event", (event) => events.push(event));
    fake.set((world) => {
      world.terminals[0].status = { app: "omp", state: "working" };
      world.terminals[0].status_ms = 400;
    });
    await until(() => events.some((event) => event.type === "agent_start"), "agent_start");
    appendFileSync(sessionFile, `${JSON.stringify(message("assistant", "done here", 2_000))}\n`);
    await until(() => events.some((event) => event.type === "message_end"), "message_end");
    assert.equal(events.find((event) => event.type === "message_end").message.content[0].text, "done here");
    await until(() => entry.messages.length === 2, "the message kept for later phones");
    // A tool's result closes its card on the phone, as a live omp's tool_execution_end does.
    appendFileSync(
      sessionFile,
      `${JSON.stringify({ type: "message", id: "r1", parentId: null, timestamp: new Date(3_000).toISOString(), message: { role: "toolResult", toolCallId: "call-1", toolName: "bash", content: [{ type: "text", text: "Tue" }], isError: false, timestamp: 3_000 } })}\n`,
    );
    const ended = await until(() => events.find((event) => event.type === "tool_execution_end"), "tool_execution_end");
    assert.deepEqual([ended.toolCallId, ended.toolName, ended.isError, ended.result.content[0].text], ["call-1", "bash", false, "Tue"]);
    fake.set((world) => {
      world.terminals[0].status = { app: "omp", state: "idle" };
      world.terminals[0].status_ms = 500;
    });
    await until(() => events.some((event) => event.type === "agent_end"), "agent_end");
  } finally {
    await daemon.close();
  }
});

/** The screen as omp draws it a moment before its dialog: only the tool's preview box. */
const previewScreen = (tick) => ["Warning: an extension failed to load", "╭─── $ touch /tmp/FIRST │", "│ preparing", "╰──────────", "", `⠙ ${tick}s  Opus · tmp ── 4% ──`, "╰─"].join("\n");

/** Opens `s1` through herdr on a fake with terminal t1 = omp 4242, then puts it in `blocked` with `screens`. */
async function blockedSession(fake, status = { app: "omp", state: "blocked", kind: "permission" }) {
  const { daemon } = daemonHeldBy(fake, 4242);
  await daemon.herdr.start();
  const entry = await daemon.ensureLive("s1");
  const asked = new Promise((resolveAsk) => entry.rpc.once("approval", resolveAsk));
  fake.set((world) => {
    world.terminals[0].status = status;
    world.terminals[0].status_ms = 200;
  });
  return { daemon, entry, request: await asked };
}

test("a dialog read before omp drew it is read again: the phone gets the dialog, not the tool preview", async () => {
  const fake = fakeHerdr([omp("t1", 4242)], { t1: dialogScreen(9) });
  fake.set((world) => {
    world.screenSeq = { t1: [previewScreen(7), previewScreen(8)] };
  });
  const { daemon, entry, request } = await blockedSession(fake);
  try {
    assert.match(request.screen, /Allow tool: bash/, "the request shows the dialog");
    await entry.rpc.respondExtension(request.id, { keys: ["enter"] });
    assert.deepEqual(fake.calls("terminal.keys").map((call) => call.params.keys), [["enter"]]);
  } finally {
    await daemon.close();
  }
});

test("a dialog that no longer matches the phone's copy is sent again as a new request, and that one can be answered", async () => {
  const fake = fakeHerdr([omp("t1", 4242)], { t1: dialogScreen(8) });
  const { daemon, entry, request } = await blockedSession(fake);
  try {
    const again = new Promise((resolveAsk) => entry.rpc.once("approval", resolveAsk));
    fake.set((world) => {
      world.screens.t1 = dialogScreen(9).replace("Command: date", "Command: rm -rf build");
    });
    await assert.rejects(entry.rpc.respondExtension(request.id, { keys: ["enter"] }), /changed/);
    const fresh = await again;
    assert.notEqual(fresh.id, request.id);
    assert.match(fresh.screen, /rm -rf build/);
    await entry.rpc.respondExtension(fresh.id, { keys: ["enter"] });
    assert.equal(fake.calls("terminal.keys").length, 1);
  } finally {
    await daemon.close();
  }
});

test("another omp process in the same terminal is not this session's: nothing is typed and the session closes", async () => {
  const fake = fakeHerdr([omp("t1", 4242)]);
  const { daemon } = daemonHeldBy(fake, 4242);
  try {
    await daemon.herdr.start();
    const entry = await daemon.ensureLive("s1");
    fake.set((world) => {
      world.terminals[0].foreground = { pid: 9999, name: "omp", argv: ["omp"], cwd: "/tmp" };
      world.terminals[0].pid = 9999;
    });
    await until(() => entry.closed, "the session to close for another omp");
    await assert.rejects(entry.rpc.prompt("hello"), /not running omp/);
    assert.equal(fake.calls("terminal.send").length, 0);
  } finally {
    await daemon.close();
  }
});

test("omp's status with a shell in the foreground is not an omp terminal", async () => {
  const fake = fakeHerdr([omp("t1", 4242, { app: "omp", state: "idle" }, { foreground: { pid: 4242, name: "zsh", argv: ["zsh"], cwd: "/tmp" } })]);
  const herdr = new Herdr({ bin: fake.bin, env: fake.env });
  try {
    await herdr.start();
    assert.equal(herdr.ompTerminal(4242), undefined);
  } finally {
    herdr.close();
  }
});

test("a dialog whose status time changed is a new dialog, even with the same box", async () => {
  const fake = fakeHerdr([omp("t1", 4242)], { t1: dialogScreen(8) });
  const { daemon, entry, request } = await blockedSession(fake);
  try {
    // Answered in the terminal and asked again with the same words: the phone's answer was for the first one.
    entry.rpc.follow = () => undefined;
    fake.set((world) => {
      world.terminals[0].status_ms = 900;
    });
    await assert.rejects(entry.rpc.respondExtension(request.id, { keys: ["enter"] }), /changed/);
    assert.equal(fake.calls("terminal.keys").length, 0);
  } finally {
    await daemon.close();
  }
});

test("one dialog takes one answer, even when two arrive together", async () => {
  const fake = fakeHerdr([omp("t1", 4242)], { t1: dialogScreen(8) });
  const { daemon, entry, request } = await blockedSession(fake);
  try {
    const answers = await Promise.allSettled([
      entry.rpc.respondExtension(request.id, { keys: ["enter"] }),
      entry.rpc.respondExtension(request.id, { keys: ["enter"] }),
    ]);
    assert.deepEqual(answers.map((answer) => answer.status).sort(), ["fulfilled", "rejected"]);
    assert.equal(fake.calls("terminal.keys").length, 1);
  } finally {
    await daemon.close();
  }
});

test("only dialog keys are pressed: ctrl+c, letters or text are refused", async () => {
  const fake = fakeHerdr([omp("t1", 4242)], { t1: dialogScreen(8) });
  const { daemon, entry, request } = await blockedSession(fake);
  try {
    for (const keys of [["ctrl+c"], ["a"], ["rm -rf /"], [], ["enter", "enter", "enter", "enter", "enter", "enter", "enter", "enter", "enter"]]) {
      await assert.rejects(entry.rpc.respondExtension(request.id, { keys }), /a dialog takes keys/, JSON.stringify(keys));
    }
    assert.equal(fake.calls("terminal.keys").length, 0);
    await entry.rpc.respondExtension(request.id, { keys: ["down", "enter"] });
    assert.deepEqual(fake.calls("terminal.keys").map((call) => call.params.keys), [["down", "enter"]]);
  } finally {
    await daemon.close();
  }
});
