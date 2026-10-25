import assert from "node:assert/strict";
import { test } from "node:test";
import {
  activityLabel,
  clockTime,
  duration,
  editCounts,
  gapBefore,
  layoutRows,
  liveLabel,
  liveStep,
  shortPath,
  stepStat,
  stepTarget,
  stepTitle,
  toolKind,
  toolSummaryLine,
  toolTitle,
  turnDuration,
  turnLabel,
} from "../src/rows.ts";

const user = (id, text, extra = {}) => ({ kind: "message", id, role: "user", text, ...extra });
const reply = (id, text, extra = {}) => ({ kind: "message", id, role: "assistant", text, ...extra });
const tool = (id, name, args, extra = {}) => ({ kind: "tool", id, name, args, status: "done", ...extra });

test("a turn is a divider, its work rows, its prose and a tail", () => {
  const rows = layoutRows([
    user("u1", "Fix the test"),
    reply("r1", "", { thinking: "look first" }),
    tool("t1", "read", { path: "/a.ts" }),
    tool("t2", "grep", { pattern: "x" }),
    reply("r2", "Found it.", { thinking: "it is the import" }),
    tool("t3", "edit", { path: "/a.ts" }),
    reply("r3", "Fixed."),
  ]);
  assert.deepEqual(
    rows.map((row) => `${row.kind}:${row.id}`),
    ["user:u1", "turn:turn:r1", "activity:act:r1", "thinking:think:r2", "reply:r2", "activity:act:t3", "reply:r3", "tail:tail:turn:r1"],
  );
  assert.deepEqual(
    rows[2].steps.map((step) => step.kind),
    ["thought", "tool", "tool"],
    "thinking that only leads into a tool call belongs to the stretch",
  );
  for (const row of rows.filter((row) => row.kind === "activity" || row.kind === "thinking")) assert.equal(row.turn, "turn:r1");
  assert.equal(rows[1].members, 3);
  assert.equal(rows.at(-1).text, "Found it.\n\nFixed.", "the tail copies the whole reply");
});

test("a running turn has no tail and says what it is doing", () => {
  const streaming = layoutRows([user("u1", "go"), reply("r1", "", { thinking: "hmm", streaming: true })]);
  assert.deepEqual(streaming.map((row) => row.kind), ["user", "turn", "thinking"]);
  assert.equal(streaming[1].running, true);
  assert.deepEqual(streaming[1].live, { kind: "thinking" });
  const between = layoutRows([user("u1", "go"), tool("t1", "bash", { command: "ls" })], true);
  assert.equal(between[1].running, true, "OMP working between events keeps the last turn running");
  assert.deepEqual(between[1].live, { kind: "working" });
  const running = layoutRows([user("u1", "go"), tool("t1", "bash", { command: "ls" }, { status: "running", intent: "Listing files" })]);
  assert.equal(running[1].live.kind, "tool");
  assert.equal(liveLabel(running[1].live), "Listing files");
  assert.equal(liveLabel({ kind: "tool", tool: tool("t", "bash", {}, { status: "running" }) }), "Running a command");
  const earlier = layoutRows([user("u1", "a"), reply("r1", "b"), user("u2", "c")], true);
  assert.equal(earlier[1].running, false, "only the last turn runs");
});

test("a turn's time runs from the user's message to its last item", () => {
  const rows = layoutRows([
    user("u1", "go", { createdAt: 1_000 }),
    tool("t1", "bash", { command: "ls" }, { endedAt: 60_000 }),
    reply("r1", "done", { createdAt: 62_000 }),
    reply("r2", "really", { createdAt: 70_000, endedAt: 193_000 }),
  ]);
  const turn = rows[1];
  assert.equal(turn.startedAt, 1_000);
  assert.equal(turn.endedAt, 193_000);
  assert.equal(turnLabel(turn), "Done in 3m 12s");
  assert.equal(rows.at(-1).at, 193_000);
  assert.equal(turnLabel({ end: "done" }), "Done", "no times, no duration");
  assert.equal(turnDuration(400), "1s");
  assert.equal(turnDuration(48_000), "48s");
  assert.equal(turnDuration(3_725_000), "1h 2m");
});

test("a turn that ended on an error or a stop says so", () => {
  const failed = layoutRows([user("u1", "go"), reply("r1", "", { stop: "error", error: "overloaded" })]);
  assert.deepEqual(failed.map((row) => row.kind), ["user", "turn", "error"]);
  assert.equal(failed[1].end, "failed");
  assert.equal(turnLabel(failed[1]), "Failed");
  const stopped = layoutRows([user("u1", "go"), reply("r1", "Half an ans", { stop: "aborted" })]);
  assert.equal(turnLabel(stopped[1]), "Stopped");
});

test("each user message starts a new turn with its own divider", () => {
  const rows = layoutRows([user("u1", "a"), reply("r1", "b"), user("u2", "c"), reply("r2", "d")]);
  assert.deepEqual(
    rows.map((row) => row.kind),
    ["user", "turn", "reply", "tail", "user", "turn", "reply", "tail"],
  );
});

test("rows keep one rhythm: tight work rows, room around prose and between turns", () => {
  const rows = layoutRows([
    user("u1", "a"),
    tool("t1", "bash", { command: "x" }),
    reply("r1", "", { thinking: "t" }),
    reply("r2", "b"),
    user("u2", "c"),
  ]);
  assert.deepEqual(
    rows.map((row) => `${row.kind}:${row.gap}`),
    ["user:0", "turn:14", "activity:12", "thinking:6", "reply:10", "tail:6", "user:28"],
  );
  assert.equal(gapBefore("reply", "turn"), 14);
});

test("a notice ends a stretch and failed steps are counted", () => {
  const rows = layoutRows([
    tool("t1", "bash", { command: "a" }, { status: "error" }),
    { kind: "notice", id: "n1", level: "warning", text: "Retrying" },
    tool("t2", "bash", { command: "b" }),
  ]);
  assert.deepEqual(
    rows.map((row) => row.kind),
    ["turn", "activity", "notice", "activity"],
  );
  assert.equal(rows[1].failed, 1);
});

test("activity ids stay stable while the stretch grows", () => {
  const before = layoutRows([tool("t1", "read", {})]);
  const after = layoutRows([tool("t1", "read", {}), tool("t2", "read", {})]);
  assert.equal(before[1].id, after[1].id);
});

test("the time under a turn is the clock today, with the date on other days", () => {
  const now = new Date(2026, 9, 25, 20, 0).getTime();
  assert.equal(clockTime(new Date(2026, 9, 25, 9, 5).getTime(), now), "09:05");
  assert.equal(clockTime(new Date(2026, 9, 24, 19, 31).getTime(), now), "10/24 19:31");
});

test("step titles prefer OMP's intent line, else describe the call", () => {
  assert.equal(stepTitle(tool("t", "read", { path: "/x/auth.ts" }, { intent: "Reading the  login\nhelper" })), "Reading the login helper");
  assert.equal(stepTitle(tool("t", "read", { path: "/x/auth.ts" })), "Read auth.ts");
  assert.equal(stepTitle(tool("t", "bash", { command: "ls" })), "Run a command");
  assert.equal(stepTitle(tool("t", "eval", { code: "1", title: "List projects" })), "List projects");
  assert.equal(stepTitle(tool("t", "grep", { pattern: "loginAs" })), "Search for loginAs");
  assert.equal(stepTitle(tool("t", "mystery", {})), "mystery");
});

test("step targets show the command, pattern or path, paths relative to the session", () => {
  assert.equal(stepTarget(tool("t", "bash", { command: "bun test\n  --repeat 20" })), "$ bun test --repeat 20");
  assert.equal(stepTarget(tool("t", "read", { path: "/w/app/src/a.ts" }), "/w/app"), "src/a.ts");
  assert.equal(stepTarget(tool("t", "read", { path: "/Users/rinai/x/a.ts" }), "/w"), "~/x/a.ts");
  assert.equal(stepTarget(tool("t", "grep", { pattern: "foo", path: "/w/src" }), "/w"), "foo · src");
  assert.equal(stepTarget(tool("t", "web_search", { query: "tailscale whois" })), "tailscale whois");
  assert.equal(stepTarget(tool("t", "todo", { op: "init" })), undefined);
  assert.equal(shortPath("/w/app", "/w/app/"), "/w/app");
});

test("edit counts come from OMP's result diff, else from the two sides", () => {
  const result = { content: [], details: { diff: " 226|  a\n+231|  b\n+232|  c\n-240|  d\n 241|  e" } };
  assert.deepEqual(editCounts(tool("t", "edit", {}, { result })), { added: 2, removed: 1 });
  assert.deepEqual(editCounts(tool("t", "edit", { old_string: "a\nb", new_string: "c" })), { added: 1, removed: 2 });
  assert.equal(editCounts(tool("t", "edit", {})), undefined);
});

test("step stats: edit counts, line counts, run times, failures", () => {
  assert.equal(stepStat(tool("t", "edit", { old_string: "a", new_string: "b\nc" })), "+2 −1");
  assert.equal(stepStat(tool("t", "read", {}, { result: { details: { totalLines: 142 } } })), "142 lines");
  assert.equal(stepStat(tool("t", "bash", {}, { result: { details: { wallTimeMs: 1234 } } })), "1.2s");
  assert.equal(stepStat(tool("t", "write", { content: "a\nb\nc" })), "3 lines");
  assert.equal(stepStat(tool("t", "bash", {}, { status: "error" })), "failed");
  assert.equal(stepStat(tool("t", "bash", {}, { status: "running" })), undefined);
});

test("durations read like a stopwatch", () => {
  assert.equal(duration(850), "850ms");
  assert.equal(duration(1234), "1.2s");
  assert.equal(duration(14_200), "14s");
  assert.equal(duration(63_000), "1m 03s");
});

test("an activity names the kinds of work, not how many calls", () => {
  const steps = [
    { kind: "tool", tool: tool("1", "read", { path: "/a" }) },
    { kind: "tool", tool: tool("2", "edit", { path: "/a" }) },
    { kind: "tool", tool: tool("3", "read", { path: "/b" }) },
    { kind: "tool", tool: tool("4", "bash", { command: "x" }) },
  ];
  assert.equal(activityLabel(steps), "Read files, edited files, ran commands");
  assert.equal(activityLabel([{ kind: "tool", tool: tool("1", "bash", {}) }]), "Ran commands");
  assert.equal(
    activityLabel([...steps, { kind: "tool", tool: tool("5", "grep", { pattern: "x" }) }]),
    "Read files, edited files, ran commands and more",
  );
  assert.equal(activityLabel([{ kind: "thought", item: reply("r", "", { thinking: "x" }) }]), "Thought");
});

test("a tool row reads as its kind and what it acted on", () => {
  assert.equal(toolTitle(tool("t", "bash", { command: "ls -la" })), "Run");
  assert.equal(toolSummaryLine(tool("t", "bash", { command: "ls -la" })), "ls -la");
  assert.equal(toolTitle(tool("t", "mystery", {})), "mystery");
  assert.equal(toolSummaryLine(tool("t", "mystery", {}, { intent: "Doing a thing" })), "Doing a thing");
  assert.equal(toolSummaryLine(tool("t", "todo", {})), undefined);
});

test("the live step is the last running call", () => {
  const steps = [
    { kind: "tool", tool: tool("1", "bash", {}, { status: "running" }) },
    { kind: "tool", tool: tool("2", "read", {}) },
  ];
  assert.equal(liveStep(steps).tool.id, "1");
  assert.equal(toolKind("history_recall_search"), "search");
  assert.equal(toolKind("hub"), "agent");
});

test("a thought's row names how long it ran, in either language", async () => {
  const { setLanguage } = await import("../src/i18n/index.ts");
  const { thoughtLabel } = await import("../src/rows.ts");
  setLanguage("en");
  assert.equal(thoughtLabel(undefined), "Thought");
  assert.equal(thoughtLabel(400), "Thought for 1s");
  assert.equal(thoughtLabel(12_300), "Thought for 12s");
  assert.equal(thoughtLabel(83_000), "Thought for 1m 23s");
  setLanguage("zh-CN");
  assert.equal(thoughtLabel(12_300), "思考了 12 秒");
  assert.equal(thoughtLabel(83_000), "思考了 1 分 23 秒");
  setLanguage("en");
});
