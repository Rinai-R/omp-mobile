import assert from "node:assert/strict";
import { test } from "node:test";
import { setLanguage } from "../src/i18n/index.ts";
import { approvalText, levelLabel, optionLabel } from "../src/ompText.ts";

test("a tool approval reads in the phone's language; the command itself stays as sent", () => {
  setLanguage("zh-CN");
  try {
    assert.deepEqual(approvalText("Allow tool: bash\nCommand: rm -rf build"), {
      tool: "bash",
      heading: "允许运行 bash？",
      details: [{ label: "命令", command: true, value: "rm -rf build" }],
    });
  } finally {
    setLanguage("en");
  }
});

test("a block label takes the lines under it; a one-line label does not", () => {
  // write: `Content:` then the file, which may hold lines that look like labels.
  assert.deepEqual(approvalText("Allow tool: write\nPath: a.ts\nContent:\nline 1\nnote: kept").details, [
    { label: "Path", command: false, value: "a.ts" },
    { label: "Content", command: false, value: "line 1\nnote: kept" },
  ]);
  // An MCP tool: OMP's fixed origin, then the tool's own arguments, each its own line.
  assert.deepEqual(approvalText("Allow tool: mcp__x\nOrigin: MCP server tool\nquery: hi").details, [
    { label: "Origin", command: false, value: "MCP server tool" },
    { command: false, value: "query: hi" },
  ]);
});

test("an agent's own question is left as asked", () => {
  assert.deepEqual(approvalText("Which branch?", "main or dev"), {
    tool: undefined,
    heading: "Which branch?",
    details: [{ command: false, value: "main or dev" }],
  });
});

test("OMP's answers and levels are translated; unknown ones are shown as OMP named them", () => {
  setLanguage("zh-CN");
  try {
    assert.equal(optionLabel("Approve bash for this session"), "本会话都允许 bash");
    assert.equal(optionLabel("Always Approve Directory: src/app"), "总是允许在 src/app 中");
    assert.equal(optionLabel("Something new"), "Something new");
    assert.equal(levelLabel("xhigh"), "很高");
    assert.equal(levelLabel("turbo"), "turbo");
  } finally {
    setLanguage("en");
  }
});
