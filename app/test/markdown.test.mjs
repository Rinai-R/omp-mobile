import assert from "node:assert/strict";
import { test } from "node:test";
import { parseBlocks, parseInline } from "../src/markdown.ts";

test("a pipe table becomes one block with alignment and padded rows", () => {
  const blocks = parseBlocks(
    ["Before", "", "| Name | Count |", "| :--- | ---: |", "| a | 1 |", "| b |", "", "After"].join("\n"),
  );
  assert.deepEqual(
    blocks.map((block) => block.kind),
    ["paragraph", "table", "paragraph"],
  );
  assert.deepEqual(blocks[1], {
    kind: "table",
    header: ["Name", "Count"],
    aligns: ["left", "right"],
    rows: [
      ["a", "1"],
      ["b", ""],
    ],
  });
});

test("a pipe in prose without a separator row stays a paragraph", () => {
  const blocks = parseBlocks("use a | b as a separator");
  assert.deepEqual(blocks, [{ kind: "paragraph", text: "use a | b as a separator" }]);
});

test("a table that follows text without a blank line still starts a block", () => {
  const blocks = parseBlocks("intro\n| a | b |\n| --- | --- |\n| 1 | 2 |");
  assert.deepEqual(
    blocks.map((block) => block.kind),
    ["paragraph", "table"],
  );
});

test("the existing blocks still parse beside tables", () => {
  const blocks = parseBlocks("# Title\n\n- one\n- two\n\n```ts\nconst a = 1;\n```\n\n> quote");
  assert.deepEqual(
    blocks.map((block) => block.kind),
    ["heading", "list", "code", "quote"],
  );
  assert.deepEqual(parseInline("**bold** and `code`").map((node) => node.kind), ["bold", "text", "code"]);
});
