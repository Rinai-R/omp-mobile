import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { Daemon } from "../src/server.mjs";
import { cutAt, isForkPoint, writeCut } from "../src/fork.mjs";

const line = (value) => JSON.stringify(value);
const message = (id, parentId, role, timestamp, content, extra = {}) =>
  line({ type: "message", id, parentId, timestamp: "t", message: { role, content, timestamp, ...extra } });

/**
 * root u1 -> a1 (tool calls c1, c2) -> r1 -> (label) -> r2 -> a2 -> u2 -> a3,
 * and an abandoned branch u1 -> a1' that `activeLeafId` once pointed past.
 */
const SOURCE = [
  line({ type: "title", v: 1, title: "Ledger work", pad: "  " }),
  line({ type: "session", version: 3, id: "src", timestamp: "t", cwd: "/work" }),
  line({ type: "model_change", id: "m0", parentId: null, timestamp: "t", model: "x" }),
  message("u1", "m0", "user", 10, [{ type: "text", text: "read two files" }]),
  message("a1", "u1", "assistant", 11, [
    { type: "text", text: "reading" },
    { type: "toolCall", id: "c1", name: "read", arguments: {} },
    { type: "toolCall", id: "c2", name: "read", arguments: {} },
  ]),
  message("alt", "u1", "assistant", 99, [{ type: "text", text: "abandoned branch" }]),
  message("r1", "a1", "toolResult", 12, [{ type: "text", text: "one" }], { toolCallId: "c1" }),
  line({ type: "label", id: "l1", parentId: "r1", timestamp: "t", targetId: "u1", label: "start" }),
  message("r2", "l1", "toolResult", 13, [{ type: "text", text: "two" }], { toolCallId: "c2" }),
  line({ ...JSON.parse(message("a2", "r2", "assistant", 14, [{ type: "text", text: "done reading" }])), activeLeafId: "alt" }),
  message("u2", "a2", "user", 15, [{ type: "text", text: "and now?" }]),
  message("a3", "u2", "assistant", 16, [{ type: "text", text: "now this" }]),
].join("\n");

const ids = (lines) => lines.map((text) => JSON.parse(text)).map((entry) => entry.id ?? entry.type);

test("isForkPoint accepts a role and a timestamp only", () => {
  assert.equal(isForkPoint({ role: "user", timestamp: 1 }), true);
  assert.equal(isForkPoint({ role: "toolResult", timestamp: 1 }), false);
  assert.equal(isForkPoint({ role: "user" }), false);
  assert.equal(isForkPoint(null), false);
});

test("a cut keeps the title slot, the header and the root-to-message path", () => {
  const cut = cutAt(SOURCE, { role: "user", timestamp: 15 });
  assert.deepEqual(ids(cut), ["title", "src", "m0", "u1", "a1", "r1", "r2", "a2", "u2"]);
  // The header is the original one: `omp --fork` records it as the parent.
  assert.equal(JSON.parse(cut[1]).id, "src");
});

test("a cut inside a tool-call batch runs through the batch's results, as OMP's fork does", () => {
  assert.deepEqual(ids(cutAt(SOURCE, { role: "assistant", timestamp: 11 })).slice(2), ["m0", "u1", "a1", "r1", "r2"]);
});

test("a cut drops labels and clears leaf markers; off-path branches stay out", () => {
  const cut = cutAt(SOURCE, { role: "assistant", timestamp: 16 });
  assert.equal(ids(cut).includes("l1"), false);
  assert.equal(ids(cut).includes("alt"), false);
  const a2 = cut.map((text) => JSON.parse(text)).find((entry) => entry.id === "a2");
  assert.equal("activeLeafId" in a2, false);
  // Untouched lines are copied byte for byte.
  assert.ok(cut.includes(SOURCE.split("\n")[3]));
});

test("a cut at a message the file does not hold is undefined", () => {
  assert.equal(cutAt(SOURCE, { role: "user", timestamp: 11 }), undefined);
  assert.equal(cutAt("not json\n", { role: "user", timestamp: 15 }), undefined);
});

test("writeCut writes a private copy and leaves the source untouched", async () => {
  const dir = mkdtempSync(join(tmpdir(), "omp-mobile-fork-test-"));
  try {
    const source = join(dir, "2026_src.jsonl");
    writeFileSync(source, SOURCE);
    const cut = await writeCut(source, { role: "user", timestamp: 15 });
    assert.notEqual(dirname(cut.file), dir);
    assert.ok(cut.file.endsWith("2026_src.jsonl"));
    assert.equal(readFileSync(source, "utf8"), SOURCE);
    assert.deepEqual(ids(readFileSync(cut.file, "utf8").trim().split("\n")).at(-1), "u2");
    await cut.remove();
    assert.equal(existsSync(dirname(cut.file)), false);
    assert.equal(await writeCut(source, { role: "user", timestamp: 1 }), undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * A fake omp for a fork: records its arguments and the file `--fork` named
 * (as it was while omp started), then reports a new session beside it.
 */
const fake = `#!${process.execPath}
const fs = require("node:fs");
const path = require("node:path");
const readline = require("node:readline");
const send = (value) => process.stdout.write(JSON.stringify(value) + "\\n");
const args = process.argv.slice(2);
const at = (flag) => args[args.indexOf(flag) + 1];
const source = at("--fork");
const dir = at("--session-dir");
const sessionFile = path.join(dir, "fork_f1.jsonl");
fs.writeFileSync(process.env.FAKE_RECORD, JSON.stringify({ args, source: fs.readFileSync(source, "utf8") }));
fs.writeFileSync(sessionFile, "");
const state = { sessionId: "f1", isStreaming: false, sessionFile };
send({ type: "ready", protocolVersion: 1, supportedProtocolVersions: [1] });
process.on("SIGINT", () => process.exit(0));
readline.createInterface({ input: process.stdin }).on("line", (line) => {
  const command = JSON.parse(line);
  if (command.type === "get_state") send({ id: command.id, type: "response", command: "get_state", success: true, data: state });
  else if (command.type === "get_messages") send({ id: command.id, type: "response", command: "get_messages", success: true, data: { messages: [] } });
});
`;

const sha = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");

async function forkDaemon(run) {
  const home = mkdtempSync(join(tmpdir(), "omp-mobile-fork-home-"));
  const bucket = join(home, "agent", "sessions", "--work--");
  mkdirSync(bucket, { recursive: true });
  mkdirSync(join(home, "run", "session-owners"), { recursive: true });
  const source = join(bucket, "2026_src.jsonl");
  writeFileSync(source, SOURCE.replace('"cwd":"/work"', `"cwd":${JSON.stringify(home)}`));
  // An artifact a kept tool result may cite.
  mkdirSync(join(bucket, "2026_src"), { recursive: true });
  writeFileSync(join(bucket, "2026_src", "1.read.log"), "artifact one");
  const omp = join(home, "omp");
  writeFileSync(omp, fake, { mode: 0o755 });
  chmodSync(omp, 0o755);
  process.env.FAKE_RECORD = join(home, "record.json");
  const daemon = new Daemon(
    { host: "127.0.0.1", port: 0, cwd: home, omp, ompHome: home, registryFile: join(home, "sessions.json"), log: () => undefined },
    "fork-token-0123456789",
  );
  await daemon.listen();
  const url = `http://127.0.0.1:${daemon.server.address().port}`;
  const post = (id, body) =>
    fetch(`${url}/sessions/${id}/fork`, { method: "POST", headers: { authorization: "Bearer fork-token-0123456789", "content-type": "application/json" }, body: JSON.stringify(body) });
  try {
    await run({ home, bucket, source, post, daemon, record: () => JSON.parse(readFileSync(process.env.FAKE_RECORD, "utf8")) });
  } finally {
    await daemon.close();
    rmSync(home, { recursive: true, force: true });
  }
}

test("POST /sessions/:id/fork with `at` forks a cut copy beside the source, with its artifacts", async () => {
  await forkDaemon(async ({ bucket, source, post, daemon, record }) => {
    const before = sha(source);
    const response = await post("src", { at: { role: "user", timestamp: 15 } });
    assert.equal(response.status, 201);
    const { session } = await response.json();
    assert.equal(session.id, "f1");
    assert.equal(session.origin, "daemon");
    const { args, source: forked } = record();
    assert.equal(args[args.indexOf("--session-dir") + 1], bucket);
    const forkArg = args[args.indexOf("--fork") + 1];
    assert.notEqual(forkArg, source);
    assert.equal(existsSync(forkArg), false, "the temporary cut is removed");
    assert.deepEqual(ids(forked.trim().split("\n")).at(-1), "u2");
    assert.equal(readFileSync(join(bucket, "fork_f1", "1.read.log"), "utf8"), "artifact one");
    assert.equal(sha(source), before);
    assert.ok(daemon.registry.has("f1"));
  });
});

test("POST /sessions/:id/fork without `at` hands omp the session file itself", async () => {
  await forkDaemon(async ({ source, post, record }) => {
    const before = sha(source);
    assert.equal((await post("src", {})).status, 201);
    const { args } = record();
    assert.equal(args[args.indexOf("--fork") + 1], source);
    assert.equal(args.includes("--resume"), false);
    assert.equal(sha(source), before);
  });
});

test("a fork from a message the file lacks, or of an unknown session, is refused", async () => {
  await forkDaemon(async ({ post }) => {
    assert.equal((await post("src", { at: { role: "user", timestamp: 1 } })).status, 404);
    assert.equal((await post("nope", {})).status, 404);
    assert.equal((await post("src", { at: { role: "tool", timestamp: 1 } })).status, 400);
  });
});
