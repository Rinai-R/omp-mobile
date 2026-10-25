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
} from "../src/cache.ts";
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
