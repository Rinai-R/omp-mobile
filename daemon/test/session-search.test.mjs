import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Daemon } from "../src/server.mjs";
import { SessionSearchIndex, matchOf, rankRecords, readSearchRecord, searchTokens, snippetOf } from "../src/session-search.mjs";

const line = (value) => JSON.stringify(value);

/** A session file as OMP writes it: title slot, header, then entries. */
function sessionText({ id, cwd = "/work/app", title = "", messages = [] }) {
  let parent = null;
  const entries = messages.map(([role, text, extra = {}], index) => {
    const entry = {
      type: "message",
      id: `e${index}`,
      parentId: parent,
      timestamp: new Date(1_000 + index).toISOString(),
      message: { role, content: typeof text === "string" ? [{ type: "text", text }] : text, timestamp: 1_000 + index, ...extra },
    };
    parent = entry.id;
    return line(entry);
  });
  return [line({ type: "title", v: 1, title, pad: "    " }), line({ type: "session", version: 3, id, timestamp: "2026-01-01T00:00:00.000Z", cwd }), ...entries].join("\n") + "\n";
}

function write(dir, name, text, mtime) {
  const file = join(dir, name);
  writeFileSync(file, text);
  if (mtime !== undefined) utimesSync(file, mtime / 1000, mtime / 1000);
  return file;
}

/** The text of each message of `record`, from its spans of the record's text. */
const texts = (record) => record.messages.map((message) => record.text.slice(message.start, message.end));

/** A record as `readSearchRecord` builds it, from `[role, text, timestamp]` messages. */
function recordOf({ id = "s", title = "chat", cwd = "/w", updatedAt = 0, messages }) {
  let at = 0;
  const spans = messages.map(([role, text, timestamp]) => {
    const span = { role, timestamp, start: at, end: at + text.length };
    at += text.length + 1;
    return span;
  });
  return { id, title, cwd, createdAt: 0, updatedAt, sessionFile: `/${id}`, meta: `${id}\n${title}\n${cwd}`, text: messages.map(([, text]) => text).join("\n"), messages: spans };
}

test("searchTokens splits on whitespace and lowercases, as the resume picker does", () => {
  assert.deepEqual(searchTokens("  Fix  LOGIN bug "), ["fix", "login", "bug"]);
  assert.deepEqual(searchTokens("   "), []);
});

test("a record holds the user and assistant text, never tool results or thinking", async () => {
  const dir = mkdtempSync(join(tmpdir(), "omp-mobile-search-"));
  try {
    const file = write(
      dir,
      "a.jsonl",
      sessionText({
        id: "a",
        messages: [
          ["user", "where is the ledger"],
          ["assistant", [{ type: "thinking", thinking: "secret-thought" }, { type: "text", text: "in src/ledger.ts" }, { type: "toolCall", id: "t1", name: "read", arguments: {} }]],
          ["toolResult", "tool-output-word", { toolCallId: "t1" }],
        ],
      }),
    );
    const record = await readSearchRecord(file);
    assert.equal(record.id, "a");
    assert.equal(record.title, "where is the ledger");
    assert.deepEqual(
      record.messages.map((message) => [message.role, message.timestamp]),
      [
        ["user", 1000],
        ["assistant", 1001],
      ],
    );
    assert.deepEqual(texts(record), ["where is the ledger", "in src/ledger.ts"]);
    assert.equal(record.text.includes("tool-output-word"), false);
    assert.equal(record.text.includes("secret-thought"), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a file without a session header is not a session", async () => {
  const dir = mkdtempSync(join(tmpdir(), "omp-mobile-search-"));
  try {
    assert.equal(await readSearchRecord(write(dir, "x.jsonl", `${line({ type: "message", message: { role: "user", content: "hi" } })}\n`)), undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("ranking: exact title, then partial title, then content matches newest first; every word must match", () => {
  const record = (id, title, text, updatedAt) => recordOf({ id, title, updatedAt, messages: [["user", text, 1]] });
  const records = [
    record("old-content", "something", "deploy the parser", 1),
    record("new-content", "other", "the parser deploy", 5),
    record("partial", "Deploy parser v2", "x", 2),
    record("exact", "deploy  parser", "x", 0),
    record("half", "deploy only", "nothing else", 9),
  ];
  assert.deepEqual(
    rankRecords(records, "Deploy parser").map((item) => item.id),
    ["exact", "partial", "new-content", "old-content"],
  );
  assert.deepEqual(rankRecords(records, " "), []);
});

test("a content match names the message with the most words, the newest of equals, as a snippet", () => {
  const record = recordOf({
    messages: [
      ["user", "alpha only", 1],
      ["assistant", `${"x ".repeat(60)}alpha and beta together`, 2],
      ["user", "beta alone", 3],
    ],
  });
  const match = matchOf(record, ["alpha", "beta"]);
  assert.equal(match.kind, "message");
  assert.equal(match.role, "assistant");
  assert.equal(match.timestamp, 2);
  assert.match(match.snippet, /^….*alpha and beta together$/);
  assert.deepEqual(matchOf({ ...record, title: "Alpha Beta" }, ["alpha", "beta"]), { kind: "title" });
});

test("snippetOf keeps context before the match on one line", () => {
  assert.equal(snippetOf("first line\nsecond KEY word", ["key"]), "first line second KEY word");
});

test("the index reads a file again only when it changed, and keeps the newest copy of an id", async () => {
  const dir = mkdtempSync(join(tmpdir(), "omp-mobile-search-"));
  try {
    const a = write(dir, "a.jsonl", sessionText({ id: "same", messages: [["user", "first copy"]] }), 1_000_000);
    const b = write(dir, "b.jsonl", sessionText({ id: "same", messages: [["user", "moved copy"]] }), 2_000_000);
    const index = new SessionSearchIndex();
    let records = await index.records([a, b, a]);
    assert.deepEqual(records.map((record) => texts(record)[0]), ["moved copy"]);
    const cached = index.cache.get(b).record;
    records = await index.records([a, b]);
    assert.equal(index.cache.get(b).record, cached);
    write(dir, "b.jsonl", sessionText({ id: "same", messages: [["user", "moved copy, longer now"]] }), 3_000_000);
    records = await index.records([a, b]);
    assert.notEqual(index.cache.get(b).record, cached);
    assert.equal(texts(records[0])[0], "moved copy, longer now");
    await index.records([a]);
    assert.equal(index.cache.has(b), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("GET /sessions/search finds a terminal session past the list's limit by a word only in its messages", async () => {
  const home = mkdtempSync(join(tmpdir(), "omp-mobile-search-home-"));
  const bucket = join(home, "agent", "sessions", "--work--");
  mkdirSync(bucket, { recursive: true });
  mkdirSync(join(home, "run", "session-owners"), { recursive: true });
  // More sessions than the list shows (50); the match is the oldest.
  for (let index = 0; index < 60; index += 1) {
    write(bucket, `s${index}.jsonl`, sessionText({ id: `s${index}`, title: `session ${index}`, messages: [["user", "hello"], ["assistant", "hi"]] }), 10_000_000 + index * 1000);
  }
  write(bucket, "needle.jsonl", sessionText({ id: "needle", title: "unrelated", messages: [["user", "hello"], ["assistant", "the quokka-zebra lives here"]] }), 1_000_000);
  const daemon = new Daemon(
    { host: "127.0.0.1", port: 0, cwd: home, omp: "/nonexistent", ompHome: home, registryFile: join(home, "sessions.json"), log: () => undefined },
    "search-token-0123456789",
  );
  await daemon.listen();
  try {
    const url = `http://127.0.0.1:${daemon.server.address().port}`;
    const headers = { authorization: "Bearer search-token-0123456789" };
    const hello = await (await fetch(`${url}/hello`)).json();
    assert.ok(hello.features.includes("session-search"));
    assert.ok(hello.features.includes("fork"));
    const listed = await (await fetch(`${url}/sessions`, { headers })).json();
    assert.equal(listed.sessions.some((session) => session.id === "needle"), false);
    const response = await fetch(`${url}/sessions/search?q=${encodeURIComponent("QUOKKA-zebra")}`, { headers });
    assert.equal(response.status, 200);
    const { results } = await response.json();
    assert.equal(results.length, 1);
    assert.equal(results[0].session.id, "needle");
    assert.equal(results[0].session.origin, "omp");
    assert.deepEqual(results[0].match, { kind: "message", role: "assistant", timestamp: 1001, snippet: "the quokka-zebra lives here" });
    // A result the list never showed can be opened: the daemon knows its file.
    assert.equal(daemon.known("needle").sessionFile, join(bucket, "needle.jsonl"));
    assert.deepEqual((await (await fetch(`${url}/sessions/search?q=%20`, { headers })).json()).results, []);
  } finally {
    await daemon.close();
    rmSync(home, { recursive: true, force: true });
  }
});
