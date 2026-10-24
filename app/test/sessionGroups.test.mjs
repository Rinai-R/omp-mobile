import assert from "node:assert/strict";
import { test } from "node:test";
import { age, attentionCount, folderOf, groupSessions, matches } from "../src/sessionGroups.ts";

const NOW = new Date(2026, 9, 24, 15, 0, 0).getTime();
const HOUR = 3_600_000;
const s = (id, extra = {}) => ({
  id,
  title: `Session ${id}`,
  cwd: "/w/app",
  status: "idle",
  createdAt: 0,
  updatedAt: NOW - HOUR,
  origin: "daemon",
  ...extra,
});

test("sessions group by what needs the user first, then by state and recency", () => {
  const groups = groupSessions(
    [
      s("today"),
      s("old", { updatedAt: NOW - 30 * HOUR }),
      s("run", { status: "streaming" }),
      s("ask", { status: "streaming", waiting: 1 }),
      s("term", { origin: "omp" }),
      s("term-run", { origin: "omp", status: "streaming" }),
    ],
    NOW,
  );
  assert.deepEqual(
    groups.map((group) => [group.key, group.sessions.map((session) => session.id)]),
    [
      ["waiting", ["ask"]],
      ["running", ["run", "term-run"]],
      ["today", ["today"]],
      ["earlier", ["old"]],
      ["terminal", ["term"]],
    ],
  );
  assert.equal(groups[0].title, "Needs you");
});

test("each group is newest first, a repeated id shows once, empty groups are left out", () => {
  const groups = groupSessions([s("a", { updatedAt: NOW - 2 * HOUR }), s("b"), s("a")], NOW);
  assert.deepEqual(groups.map((group) => group.key), ["today"]);
  assert.deepEqual(groups[0].sessions.map((session) => session.id), ["b", "a"]);
});

test("search needs every word in the title, directory or model", () => {
  const session = s("x", { title: "Fix the flaky login test", cwd: "/w/omp-mobile", model: "Opus 4.5" });
  assert.equal(matches(session, "login mobile"), true);
  assert.equal(matches(session, "LOGIN opus"), true);
  assert.equal(matches(session, "login importer"), false);
  assert.equal(matches(session, "  "), true);
  assert.deepEqual(groupSessions([session, s("y")], NOW, "flaky").flatMap((group) => group.sessions.map((item) => item.id)), ["x"]);
});

test("ages are compact", () => {
  assert.equal(age(NOW - 10_000, NOW), "now");
  assert.equal(age(NOW - 5 * 60_000, NOW), "5m");
  assert.equal(age(NOW - 3 * HOUR, NOW), "3h");
  assert.equal(age(NOW - 50 * HOUR, NOW), "2d");
  assert.equal(age(new Date(2026, 8, 3).getTime(), NOW), "Sep 3");
  assert.equal(age(0, NOW), "");
});

test("folder and attention helpers", () => {
  assert.equal(folderOf("/Users/rinai/project/"), "project");
  assert.deepEqual(attentionCount([s("a", { waiting: 2 }), s("b", { status: "streaming" }), s("c")]), { waiting: 1, running: 1 });
});
