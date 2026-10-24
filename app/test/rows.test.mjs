import assert from "node:assert/strict";
import { test } from "node:test";
import {
  activitySummary,
  duration,
  editCounts,
  layoutRows,
  liveStep,
  shortPath,
  stepStat,
  stepTarget,
  stepTitle,
  toolKind,
} from "../src/rows.ts";

const user = (id, text) => ({ kind: "message", id, role: "user", text });
const reply = (id, text, extra = {}) => ({ kind: "message", id, role: "assistant", text, ...extra });
const tool = (id, name, args, extra = {}) => ({ kind: "tool", id, name, args, status: "done", ...extra });

test("a turn is a header, its prose, and each stretch of tools as one activity", () => {
  const rows = layoutRows([
    user("u1", "Fix the test"),
    reply("r1", "", { thinking: "look first" }),
    tool("t1", "read", { path: "/a.ts" }),
    tool("t2", "grep", { pattern: "x" }),
    reply("r2", "Found it."),
    tool("t3", "edit", { path: "/a.ts" }, { status: "running" }),
    reply("r3", "", { thinking: "now run", streaming: true }),
  ]);
  assert.deepEqual(
    rows.map((row) => `${row.kind}:${row.id}`),
    ["user:u1", "turn:turn:r1", "activity:act:r1", "reply:r2", "activity:act:t3", "reply:r3"],
  );
  const first = rows[2];
  assert.equal(first.kind, "activity");
  assert.deepEqual(
    first.steps.map((step) => step.kind),
    ["thought", "tool", "tool"],
    "thinking that only leads into a tool call belongs to the stretch",
  );
  assert.equal(first.running, false);
  assert.equal(rows[4].running, true);
  assert.equal(rows[5].kind, "reply", "thinking at the end of the transcript stays a reply: it may become an answer");
});

test("each user message starts a new turn with its own header", () => {
  const rows = layoutRows([user("u1", "a"), reply("r1", "b"), user("u2", "c"), reply("r2", "d")]);
  assert.deepEqual(
    rows.map((row) => row.kind),
    ["user", "turn", "reply", "user", "turn", "reply"],
  );
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

test("a finished stretch summarizes the most consequential work first", () => {
  const steps = [
    { kind: "tool", tool: tool("1", "read", { path: "/a" }) },
    { kind: "tool", tool: tool("2", "read", { path: "/a" }) },
    { kind: "tool", tool: tool("3", "read", { path: "/b" }) },
    { kind: "tool", tool: tool("4", "edit", { path: "/a" }) },
    { kind: "tool", tool: tool("5", "edit", { path: "/a" }) },
    { kind: "tool", tool: tool("6", "bash", { command: "x" }) },
    { kind: "tool", tool: tool("7", "bash", { command: "y" }) },
  ];
  assert.equal(activitySummary(steps), "Edited a file, ran 2, read 2");
  assert.equal(activitySummary([{ kind: "tool", tool: tool("1", "bash", {}) }]), "Ran a command");
  assert.equal(activitySummary([{ kind: "thought", item: reply("r", "", { thinking: "x" }) }]), "Thought it through");
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
