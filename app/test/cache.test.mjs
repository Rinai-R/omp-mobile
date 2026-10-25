import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MISS_RETRY_MS,
  RECENT_MS,
  activeAt,
  behind,
  cacheName,
  currentTo,
  expired,
  fingerprint,
  heldOf,
  heldOfEntry,
  heldQuery,
  mergeTranscript,
  parseCached,
  parseIndex,
  replaces,
  retained,
  syncQueue,
  TAIL_MESSAGES,
  attachHead,
  heldOfWindow,
  mergeWindow,
  parseTail,
  tailStart,
  appendAt,
  copyLines,
  extendTail,
  parseCopyLines,
} from "../src/cache.ts";
import { snapshotItems } from "../src/messages.ts";
import { fingerprint as daemonFingerprint } from "../../daemon/src/transcripts.mjs";

const messages = [
  { role: "user", timestamp: 1, content: "hi" },
  { role: "assistant", timestamp: 2, responseId: "r1", content: [] },
  { role: "toolResult", timestamp: 3, toolCallId: "c1", content: [] },
  { role: "assistant", timestamp: 4, responseId: "r2", content: [] },
];

test("the phone fingerprints a message exactly as the daemon does", () => {
  const cases = [
    ...messages,
    { role: "toolResult", timestamp: 5, toolCallId: "c", responseId: "r" },
    { role: "custom" },
    { role: "assistant", timestamp: 1.5e12, responseId: 7 },
    {},
    null,
    "text",
  ];
  for (const message of cases) assert.equal(fingerprint(message), daemonFingerprint(message), JSON.stringify(message));
  assert.equal(fingerprint(messages[2]), "toolResult:3:c1");
});

test("what the phone holds, as since/last", () => {
  assert.equal(heldOf([]), undefined);
  assert.equal(heldOf(undefined), undefined);
  assert.deepEqual(heldOf(messages), { since: 4, last: "assistant:4:r2" });
  assert.equal(heldQuery(heldOf(messages)), "since=4&last=assistant%3A4%3Ar2");
  assert.equal(heldQuery(undefined), "");
  assert.deepEqual(heldOfEntry({ count: 2, last: "x" }), { since: 2, last: "x" });
  assert.equal(heldOfEntry({ count: 0, last: "" }), undefined);
  assert.equal(heldOfEntry(undefined), undefined);
});

test("a delta extends the copy at its from; a whole transcript replaces it", () => {
  const base = messages.slice(0, 2);
  const held = heldOf(base);
  const delta = mergeTranscript(base, held, { from: 2, total: 4, messages: messages.slice(2) });
  assert.deepEqual(delta, messages);
  assert.deepEqual(mergeTranscript(messages, heldOf(messages), { from: 4, total: 4, messages: [] }), messages, "nothing new");
  assert.deepEqual(mergeTranscript(base, held, { from: 0, total: 4, messages }), messages, "a mismatch on the daemon: everything");
  assert.deepEqual(mergeTranscript([], undefined, { messages }), messages, "an older daemon: no from, no total");
});

test("an answer that does not fit its copy is refused, never spliced", () => {
  const base = messages.slice(0, 2);
  const held = heldOf(base);
  assert.equal(mergeTranscript(base, held, { from: 1, total: 4, messages: messages.slice(1) }), undefined, "another from than asked");
  assert.equal(mergeTranscript(base, undefined, { from: 2, total: 4, messages: messages.slice(2) }), undefined, "a delta nobody asked for");
  assert.equal(mergeTranscript(base.slice(0, 1), { since: 2, last: held.last }, { from: 2, total: 4, messages: messages.slice(2) }), undefined, "the copy is shorter");
  const changed = [messages[0], { ...messages[1], responseId: "other" }];
  assert.equal(mergeTranscript(changed, held, { from: 2, total: 4, messages: messages.slice(2) }), undefined, "the copy changed since it was asked against");
  assert.equal(mergeTranscript(base, held, { from: 2, total: 5, messages: messages.slice(2) }), undefined, "the count does not add up");
  assert.equal(mergeTranscript(base, held, { from: 0, total: 3, messages }), undefined);
  assert.equal(mergeTranscript(base, held, { from: -1, messages }), undefined);
  assert.equal(mergeTranscript(base, held, { from: 2, messages: "x" }), undefined);
});

test("a copy is kept while its session was active or viewed in the last 24 hours, with no count limit", () => {
  const now = 10 * RECENT_MS;
  assert.equal(activeAt({ updatedAt: 5, viewedAt: 9 }), 9);
  assert.equal(retained({ updatedAt: now - RECENT_MS, viewedAt: 0 }, now), true);
  assert.equal(retained({ updatedAt: now - RECENT_MS - 1, viewedAt: 0 }, now), false);
  assert.equal(retained({ updatedAt: 0, viewedAt: now - 1_000 }, now), true, "viewed recently");
  const many = Array.from({ length: 200 }, (_, i) => ({ name: `c${i}`, updatedAt: now - i * 60_000, viewedAt: 0 }));
  assert.deepEqual(expired(many, now), [], "200 recent sessions all stay");
  const old = { name: "old", updatedAt: now - 2 * RECENT_MS, viewedAt: now - RECENT_MS - 5 };
  assert.deepEqual(expired([...many, old], now), [old]);
});

test("the background pass refreshes recent sessions newer than their copy, newest first", () => {
  const now = 10 * RECENT_MS;
  const session = (id, updatedAt, extra = {}) => ({ id, title: id, cwd: "/w", status: "idle", createdAt: 0, updatedAt, origin: "daemon", ...extra });
  const entry = (sessionId, updatedAt, viewedAt = 0) => ({ machineId: "m", sessionId, updatedAt, viewedAt, savedAt: 0, count: 1, last: "" });
  const sessions = [
    session("current", now - 10, {}),
    session("newer", now - 5),
    session("uncached", now - 20),
    session("old", now - RECENT_MS - 1),
    session("viewed", now - RECENT_MS - 1),
    session("held", now - 1, { openElsewhere: true }),
    session("missed", now - 2),
    session("missedLongAgo", now - 3),
  ];
  const entries = new Map([
    ["current", entry("current", now - 10)],
    ["newer", entry("newer", now - 50)],
    ["viewed", entry("viewed", now - RECENT_MS - 100, now - 1_000)],
  ]);
  const misses = new Map([
    ["missed", now - 1_000],
    ["missedLongAgo", now - MISS_RETRY_MS - 1],
  ]);
  assert.deepEqual(
    syncQueue(sessions, entries, misses, now).map((item) => item.id),
    ["missedLongAgo", "newer", "uncached", "viewed"],
  );
  assert.deepEqual(
    syncQueue(sessions, entries, misses, now, "newer").map((item) => item.id),
    ["missedLongAgo", "uncached", "viewed"],
    "the chat on screen keeps its own copy",
  );
  assert.equal(behind({ updatedAt: 5 }, { updatedAt: 5 }), false);
  assert.equal(behind({ updatedAt: 6 }, { updatedAt: 5 }), true);
  assert.equal(behind({ updatedAt: 6 }, undefined), true);
});

test("a copy is current to the later of the answer and the list, and never replaced by an older one", () => {
  assert.equal(currentTo(10, 12), 12);
  assert.equal(currentTo(15, 12), 15);
  assert.equal(currentTo(undefined, 12), 12);
  assert.equal(currentTo(Number.NaN, undefined), 0);
  assert.equal(replaces(undefined, 1), true);
  assert.equal(replaces({ updatedAt: 5 }, 5), true);
  assert.equal(replaces({ updatedAt: 5 }, 4), false);
});

test("damaged or foreign cache files read as no copy", () => {
  const good = { v: 2, machineId: "m", sessionId: "s", updatedAt: 1, savedAt: 1, session: { id: "s" }, state: null, messages };
  assert.equal(parseCached(good, "m", "s"), good);
  assert.equal(parseCached(good, "m", "other"), undefined);
  assert.equal(parseCached(good, "other", "s"), undefined);
  assert.equal(parseCached({ ...good, v: 1, items: [] }, "m", "s"), undefined, "a 0.4 item cache");
  assert.equal(parseCached({ ...good, messages: "x" }, "m", "s"), undefined);
  assert.equal(parseCached({ ...good, messages: [null] }, "m", "s"), undefined);
  assert.equal(parseCached({ ...good, session: null }, "m", "s"), undefined);
  assert.equal(parseCached(null, "m", "s"), undefined);
  assert.equal(parseCached("{", "m", "s"), undefined);

  const entry = { machineId: "m", sessionId: "s", updatedAt: 1, viewedAt: 0, savedAt: 1, count: 4, last: "x" };
  const index = parseIndex({ v: 2, entries: { a: entry, b: { ...entry, count: "4" }, c: null, d: { ...entry, last: 3 } } });
  assert.deepEqual([...index.keys()], ["a"]);
  assert.deepEqual(index.get("a"), entry);
  assert.equal(parseIndex(undefined).size, 0);
  assert.equal(parseIndex({ v: 1, entries: { a: entry } }).size, 0);
  assert.equal(parseIndex({ v: 2, entries: "x" }).size, 0);
});

test("cache names are stable per machine and session and differ between them", () => {
  const name = cacheName("http://100.64.0.1:7390", "01a1-session");
  assert.match(name, /^[0-9a-f]{16}$/);
  assert.equal(cacheName("http://100.64.0.1:7390", "01a1-session"), name);
  assert.notEqual(cacheName("http://100.64.0.2:7390", "01a1-session"), name);
  assert.notEqual(cacheName("http://100.64.0.1:7390", "01a1-sessioN"), name);
});

/** A long session: turns of a user prompt, a tool call, its result and a reply. */
function longSession(turns) {
  const list = [];
  for (let t = 0; t < turns; t += 1) {
    const at = t * 10;
    list.push({ role: "user", timestamp: at, content: `q${t}` });
    list.push({ role: "assistant", timestamp: at + 1, responseId: `a${t}`, content: [{ type: "toolCall", id: `c${t}`, name: "bash", arguments: {} }] });
    list.push({ role: "toolResult", timestamp: at + 2, toolCallId: `c${t}`, toolName: "bash", content: [{ type: "text", text: "ok" }] });
    list.push({ role: "assistant", timestamp: at + 3, responseId: `r${t}`, content: [{ type: "text", text: `answer ${t}` }] });
  }
  return list;
}

test("a tail is small whatever the session's size, and starts at a turn", () => {
  const long = longSession(800);
  const from = tailStart(long);
  assert.ok(long.length - from <= TAIL_MESSAGES, "no more than the tail size");
  assert.ok(long.length - from > TAIL_MESSAGES - 4, "close to it");
  assert.equal(long[from].role, "user");
  assert.equal(tailStart(long.slice(0, 40)), 0, "a short session is its own tail");
  // One endless turn: reach back for its start, within bounds.
  const oneTurn = [{ role: "user", timestamp: 0 }, ...Array.from({ length: 300 }, (_, i) => ({ role: "toolResult", timestamp: i + 1, toolCallId: `c${i}` }))];
  assert.equal(tailStart(oneTurn), 0);
  const huge = [{ role: "user", timestamp: 0 }, ...Array.from({ length: 2000 }, (_, i) => ({ role: "toolResult", timestamp: i + 1, toolCallId: `c${i}` }))];
  assert.equal(tailStart(huge), huge.length - TAIL_MESSAGES, "no turn start in reach: the plain tail");
});

test("a tail renders with the ids the whole transcript gives those rows", () => {
  const long = longSession(100);
  const from = tailStart(long);
  const whole = snapshotItems(long);
  const tail = snapshotItems(long.slice(from), from);
  const wholeIds = whole.map((item) => item.id);
  assert.deepEqual(tail.map((item) => item.id), wholeIds.slice(wholeIds.length - tail.length));
});

test("a tail is used only when it describes the copy the index knows", () => {
  const long = longSession(100);
  const from = tailStart(long);
  const entry = { sessionId: "s", count: long.length, last: fingerprint(long.at(-1)) };
  const tail = { v: 2, machineId: "m", sessionId: "s", updatedAt: 1, savedAt: 1, from, count: long.length, last: entry.last, session: { id: "s" }, state: null, messages: long.slice(from) };
  assert.equal(parseTail(tail, "m", entry), tail);
  assert.equal(parseTail(tail, "m", { ...entry, count: long.length + 2 }), undefined, "the copy grew without its tail (a crash between writes)");
  assert.equal(parseTail(tail, "m", { ...entry, last: "other" }), undefined);
  assert.equal(parseTail(tail, "other", entry), undefined);
  assert.equal(parseTail({ ...tail, from: from + 1 }, "m", entry), undefined, "its messages do not reach the copy's end");
  assert.equal(parseTail({ ...tail, messages: tail.messages.slice(0, -1) }, "m", entry), undefined);
  assert.equal(parseTail({ ...tail, messages: [] }, "m", entry), undefined);
  assert.equal(parseTail({ ...tail, messages: [null] }, "m", entry), undefined);
  assert.equal(parseTail("{", "m", entry), undefined);
});

test("a tail asks for a delta; the whole copy goes under it; anything that does not fit is refused", () => {
  const long = longSession(100);
  const from = tailStart(long);
  const tail = { offset: from, messages: long.slice(from) };
  const held = heldOfWindow(tail);
  assert.deepEqual(held, { since: long.length, last: fingerprint(long.at(-1)) });
  assert.equal(heldOfWindow({ offset: 0, messages: [] }), undefined);

  const more = [{ role: "user", timestamp: 9_000, content: "next" }, { role: "assistant", timestamp: 9_001, responseId: "rx", content: [] }];
  const extended = mergeWindow(tail, held, { from: long.length, total: long.length + 2, messages: more });
  assert.equal(extended.offset, from);
  assert.equal(extended.messages.length, long.length - from + 2);
  assert.deepEqual(mergeWindow(tail, held, { from: long.length, total: long.length, messages: [] }), tail, "nothing new");
  assert.deepEqual(mergeWindow(tail, held, { from: 0, total: long.length, messages: long }), { offset: 0, messages: long }, "everything replaces the tail");

  assert.equal(mergeWindow(tail, held, { from: long.length - 1, total: long.length + 1, messages: more }), undefined, "another from");
  assert.equal(mergeWindow(tail, held, { from: long.length, total: long.length + 3, messages: more }), undefined, "the count does not add up");
  assert.equal(mergeWindow(tail, { ...held, last: "x" }, { from: long.length, total: long.length + 2, messages: more }), undefined);
  assert.equal(mergeWindow(tail, undefined, { from: long.length, messages: more }), undefined);
  assert.equal(mergeWindow({ offset: 5, messages: [] }, { since: 5, last: "" }, { from: 5, messages: more }), undefined, "an empty window proves nothing");

  // The whole copy, read later, goes under the extended tail: the transcript is the daemon's.
  const whole = attachHead(extended, long);
  assert.deepEqual(whole, { offset: 0, messages: [...long, ...more] });
  assert.deepEqual(attachHead({ offset: 0, messages: long }, []), { offset: 0, messages: long }, "nothing to attach");
  // A copy that does not fit the tail (rewritten, damaged, shorter) is never spliced in.
  assert.equal(attachHead(extended, long.slice(0, from)), undefined, "does not reach the tail");
  const rewritten = long.map((message, i) => (i === from ? { ...message, timestamp: -1 } : message));
  assert.equal(attachHead(extended, rewritten), undefined, "disagrees where they meet");
  assert.equal(attachHead({ offset: 3, messages: [] }, long), undefined);
});

test("a whole answer from a session past the daemon's cap opens a window where it starts, and is never saved as a copy", () => {
  const held = messages.slice(1);
  const window = mergeWindow({ offset: 0, messages: [] }, undefined, { from: 0, total: 3, base: 1, messages: held });
  assert.deepEqual(window, { offset: 1, messages: held });
  // Its next ask is in the session's own indices.
  assert.deepEqual(heldOfWindow(window), { since: 4, last: fingerprint(messages[3]) });
  assert.equal(mergeTranscript([], undefined, { from: 0, total: 3, base: 1, messages: held }), undefined, "not the transcript from its start");
  assert.deepEqual(mergeWindow(window, heldOfWindow(window), { from: 4, total: 5, messages: [{ role: "user", timestamp: 5 }] })?.messages.length, 4);
});

test("a copy file holds one message per line and reads back only what the index knows", () => {
  const text = copyLines(messages);
  assert.equal(text.split("\n").length, messages.length + 1);
  const entry = { count: 4, last: fingerprint(messages[3]) };
  assert.deepEqual(parseCopyLines(text, entry), messages);
  // A save that did not finish left more (or half a line): the first `count` lines still read.
  assert.deepEqual(parseCopyLines(`${text}{"role":"us`, entry), messages);
  assert.deepEqual(parseCopyLines(text, { count: 2, last: fingerprint(messages[1]) }), messages.slice(0, 2));
  assert.equal(parseCopyLines(text, { count: 4, last: "other" }), undefined, "another copy than the index names");
  assert.equal(parseCopyLines(copyLines(messages.slice(0, 3)), entry), undefined, "shorter than the index says");
  assert.equal(parseCopyLines("{not json\n", { count: 1, last: "" }), undefined);
  assert.equal(copyLines([]), "");
});

test("a save appends to the copy file only when it continues the file the last save left", () => {
  const bytes = 120;
  const entry = { count: 2, last: fingerprint(messages[1]), bytes };
  assert.equal(appendAt(entry, bytes, messages), 2, "the whole copy, continuing the saved one: append the rest");
  assert.equal(appendAt(entry, bytes, messages.slice(2), 2), 0, "a delta at the saved count: append it all");
  assert.equal(appendAt(entry, bytes, messages.slice(2), 3), undefined, "a delta elsewhere");
  assert.equal(appendAt(entry, bytes + 7, messages), undefined, "the file is not what the last save left");
  assert.equal(appendAt({ ...entry, bytes: undefined }, bytes, messages), undefined, "an earlier version's copy");
  assert.equal(appendAt(entry, bytes, [messages[0], { role: "user", timestamp: 9 }, ...messages.slice(2)]), undefined, "the copy changed");
  assert.equal(appendAt(undefined, undefined, messages), undefined);
});

test("a delta extends the tail, which stays small and starts at a turn", () => {
  const turn = (index) => [
    { role: "user", timestamp: index * 2, content: "q" },
    { role: "assistant", timestamp: index * 2 + 1, responseId: `r${index}`, content: [] },
  ];
  const all = Array.from({ length: TAIL_MESSAGES }, (_, index) => turn(index)).flat();
  const start = tailStart(all.slice(0, 300));
  const before = { from: start, messages: all.slice(start, 300) };
  const after = extendTail(before, all.slice(300));
  assert.equal(after.from + after.messages.length, all.length);
  assert.equal(after.messages[0].role, "user");
  assert.ok(after.messages.length <= TAIL_MESSAGES + 1);
  assert.deepEqual(after.messages, all.slice(after.from));
  assert.deepEqual(extendTail({ from: 0, messages: messages.slice(0, 2) }, messages.slice(2)), { from: 0, messages });
});
