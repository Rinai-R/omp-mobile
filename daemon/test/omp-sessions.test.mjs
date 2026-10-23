import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, openSync, closeSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { listOmpSessions, parseLsof, sessionOwners } from "../src/omp-sessions.mjs";
import { Daemon, parseArgs } from "../src/server.mjs";

const home = mkdtempSync(join(tmpdir(), "omp-home-"));
after(() => rmSync(home, { recursive: true, force: true }));
const sessionsRoot = join(home, "agent", "sessions");
const ownersDir = join(home, "run", "session-owners");
mkdirSync(ownersDir, { recursive: true });

const slot = (title) => JSON.stringify({ type: "title", v: 1, title, updatedAt: "2026-10-23T07:00:00.000Z", pad: " ".repeat(40) });
const header = (id, cwd) => JSON.stringify({ type: "session", version: 3, id, timestamp: "2026-10-23T07:00:00.000Z", cwd });
const prompt = (text) =>
  JSON.stringify({ type: "message", id: "m1", parentId: null, message: { role: "user", content: [{ type: "text", text }] } });

/** Write a session file and give it a modification time `age` seconds in the past. */
function session(dir, name, lines, age) {
  mkdirSync(join(sessionsRoot, dir), { recursive: true });
  const file = join(sessionsRoot, dir, name);
  writeFileSync(file, `${lines.join("\n")}\n`);
  const when = new Date(Date.now() - age * 1000);
  utimesSync(file, when, when);
  return file;
}

session("-work-a", "1_titled.jsonl", [slot("\u{f0219} DOC: Fix the parser"), header("titled", "/work/a")], 10);
session("-work-a", "2_prompted.jsonl", [slot(""), header("prompted", "/work/a"), JSON.stringify({ type: "model_change" }), prompt("Why is  the\nbuild red?")], 20);
session("-work-b", "3_legacy.jsonl", [header("legacy", "/work/b")], 30);
session("-work-b", "4_notes.jsonl", [JSON.stringify({ hello: "world" })], 5);
session("-work-b", "5_old-copy.jsonl", [slot("old copy"), header("titled", "/work/a")], 40);

test("terminal sessions are listed newest first, titled by the slot, the first prompt or the directory", async () => {
  const sessions = await listOmpSessions(sessionsRoot);
  assert.deepEqual(
    sessions.map((s) => [s.id, s.title, s.cwd]),
    [
      ["titled", "DOC: Fix the parser", "/work/a"],
      ["prompted", "Why is the build red?", "/work/a"],
      ["legacy", "b", "/work/b"],
    ],
  );
  assert.ok(sessions[0].sessionFile.endsWith("1_titled.jsonl"), "the newest copy of a moved session wins");
  assert.deepEqual((await listOmpSessions(sessionsRoot, { limit: 1 })).map((s) => s.id), ["titled"]);
  assert.deepEqual(await listOmpSessions(join(home, "missing")), []);
});

test("lsof output maps each held owner lock to its process", () => {
  const output = "p101\nn/x/run/session-owners/a.lock\nn/x/other.txt\np202\nn/x/run/session-owners/b.lock\n";
  assert.deepEqual([...parseLsof(output)], [["a", 101], ["b", 202]]);
});

test("a lock held by a process is an owner; a missing lsof is unknown, not nobody", async () => {
  const fd = openSync(join(ownersDir, "prompted.lock"), "w");
  try {
    assert.equal((await sessionOwners(ownersDir)).get("prompted"), process.pid);
  } finally {
    closeSync(fd);
  }
  assert.equal((await sessionOwners(ownersDir)).size, 0);
  assert.equal(await sessionOwners(ownersDir, { lsof: "/nonexistent/lsof" }), undefined);
});

test("the daemon lists terminal sessions, marks one held elsewhere, and refuses to open it", async () => {
  const options = {
    ...parseArgs(["--omp-home", home, "--registry-file", join(home, "registry.json")]),
    omp: "/nonexistent/omp",
  };
  const daemon = new Daemon(options, "token");
  const fd = openSync(join(ownersDir, "prompted.lock"), "w");
  try {
    const sessions = await daemon.listSessions();
    assert.deepEqual(
      sessions.map((s) => [s.id, s.origin, s.openElsewhere === true]),
      [
        ["titled", "omp", false],
        ["prompted", "omp", true],
        ["legacy", "omp", false],
      ],
    );
    await assert.rejects(daemon.ensureLive("prompted"), (error) => error.status === 409 && /pid \d+/.test(error.message));
    await assert.rejects(daemon.ensureLive("nope"), (error) => error.status === 404);
  } finally {
    closeSync(fd);
    await daemon.close();
  }
});
