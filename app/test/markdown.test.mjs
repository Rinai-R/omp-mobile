import assert from "node:assert/strict";
import { test } from "node:test";
import { parseBlocks, parseInline, parseMarkdown, plainText, splitRow } from "../src/markdown.ts";

const kinds = (blocks) => blocks.map((block) => block.kind);
const para = (text) => ({ kind: "paragraph", text });

test("a pipe table becomes one block with alignment and padded rows", () => {
  const blocks = parseBlocks(
    ["Before", "", "| Name | Count | Note |", "| :--- | ---: | :-: |", "| a | 1 | x |", "| b |", "", "After"].join("\n"),
  );
  assert.deepEqual(kinds(blocks), ["paragraph", "table", "paragraph"]);
  assert.deepEqual(blocks[1], {
    kind: "table",
    header: ["Name", "Count", "Note"],
    aligns: ["left", "right", "center"],
    rows: [
      ["a", "1", "x"],
      ["b", "", ""],
    ],
  });
});

test("a pipe in prose without a separator row stays a paragraph", () => {
  assert.deepEqual(parseBlocks("use a | b as a separator"), [para("use a | b as a separator")]);
});

test("a table that follows text without a blank line still starts a block", () => {
  assert.deepEqual(kinds(parseBlocks("intro\n| a | b |\n| --- | --- |\n| 1 | 2 |")), ["paragraph", "table"]);
});

test("table cells keep escaped pipes and pipes inside code", () => {
  assert.deepEqual(splitRow("| `a|b` | c \\| d | e |"), ["`a|b`", "c | d", "e"]);
});

test("headings of every level, closing hashes dropped, and a === underline", () => {
  const blocks = parseBlocks("# One\n## Two ##\n###### Six\n#hashtag\nTitle\n===");
  assert.deepEqual(blocks, [
    { kind: "heading", level: 1, text: "One" },
    { kind: "heading", level: 2, text: "Two" },
    { kind: "heading", level: 6, text: "Six" },
    { kind: "heading", level: 1, text: "#hashtag Title" },
  ]);
});

test("paragraph lines keep their line breaks and blank lines split paragraphs", () => {
  assert.deepEqual(parseBlocks("one\ntwo  \n\nthree"), [para("one\ntwo"), para("three")]);
});

test("fenced code keeps its text verbatim, with its language", () => {
  const blocks = parseBlocks("```ts\nconst a = 1;\n\n  if (a) {}\n```\nafter");
  assert.deepEqual(blocks, [
    { kind: "code", lang: "ts", text: "const a = 1;\n\n  if (a) {}", open: false },
    para("after"),
  ]);
});

test("an unclosed fence while streaming runs to the end and is marked open", () => {
  const blocks = parseBlocks("Here:\n\n```python\nprint('hi')\n# not a heading");
  assert.deepEqual(blocks.at(-1), { kind: "code", lang: "python", text: "print('hi')\n# not a heading", open: true });
});

test("a longer fence holds a shorter one", () => {
  const blocks = parseBlocks("````md\n```js\nx\n```\n````");
  assert.deepEqual(blocks, [{ kind: "code", lang: "md", text: "```js\nx\n```", open: false }]);
});

test("tilde fences and fences without a language", () => {
  assert.deepEqual(parseBlocks("~~~\na\n~~~"), [{ kind: "code", lang: "", text: "a", open: false }]);
});

test("bullet lists, numbered lists with their start, and a list right after prose", () => {
  const blocks = parseBlocks("Steps:\n3. three\n4. four\n\n- a\n- b");
  assert.deepEqual(kinds(blocks), ["paragraph", "list", "list"]);
  assert.equal(blocks[1].ordered, true);
  assert.equal(blocks[1].start, 3);
  assert.deepEqual(blocks[1].items.map((item) => item.blocks), [[para("three")], [para("four")]]);
  assert.equal(blocks[2].ordered, false);
  assert.equal(blocks[2].items.length, 2);
});

test("nested lists, at the content column or two spaces in", () => {
  const blocks = parseBlocks("1. top\n   - nested\n     - deeper\n2. next\n  - two-space nested");
  assert.equal(blocks.length, 1);
  const [list] = blocks;
  assert.equal(list.items.length, 2);
  const first = list.items[0].blocks;
  assert.deepEqual(kinds(first), ["paragraph", "list"]);
  const nested = first[1];
  assert.equal(nested.ordered, false);
  assert.deepEqual(kinds(nested.items[0].blocks), ["paragraph", "list"]);
  assert.deepEqual(nested.items[0].blocks[1].items[0].blocks, [para("deeper")]);
  assert.deepEqual(kinds(list.items[1].blocks), ["paragraph", "list"]);
});

test("a loose list keeps paragraphs and code inside its items", () => {
  const blocks = parseBlocks("- first\n\n  more of first\n\n  ```sh\n  ls\n\n  pwd\n  ```\n- second\n\nafter");
  assert.deepEqual(kinds(blocks), ["list", "paragraph"]);
  assert.deepEqual(blocks[0].items[0].blocks, [
    para("first"),
    para("more of first"),
    { kind: "code", lang: "sh", text: "ls\n\npwd", open: false },
  ]);
  assert.deepEqual(blocks[0].items[1].blocks, [para("second")]);
});

test("a lazy line continues the item; a changed bullet starts a new list", () => {
  const blocks = parseBlocks("- one\ncontinued\n* other");
  assert.deepEqual(kinds(blocks), ["list", "list"]);
  assert.deepEqual(blocks[0].items[0].blocks, [para("one\ncontinued")]);
});

test("task list items carry their state", () => {
  const [list] = parseBlocks("- [x] done\n- [ ] todo\n- plain");
  assert.deepEqual(
    list.items.map((item) => [item.checked, plainText(parseInline(item.blocks[0].text))]),
    [
      [true, "done"],
      [false, "todo"],
      [undefined, "plain"],
    ],
  );
});

test("a rule is not a list item, and *** / ___ are rules too", () => {
  assert.deepEqual(kinds(parseBlocks("a\n\n---\n\n***\n___\n- - -")), ["paragraph", "rule", "rule", "rule", "rule"]);
});

test("block quotes nest and hold other blocks, with lazy continuation", () => {
  const [quote] = parseBlocks("> **Note**\nlazy line\n>\n> - item\n> > inner");
  assert.equal(quote.kind, "quote");
  assert.deepEqual(kinds(quote.blocks), ["paragraph", "list", "quote"]);
  assert.equal(quote.blocks[0].text, "**Note**\nlazy line");
  assert.deepEqual(quote.blocks[2].blocks, [para("inner")]);
});

test("CRLF and tabs are normalized", () => {
  assert.deepEqual(parseBlocks("a\r\n\r\n-\tb"), [para("a"), { kind: "list", ordered: false, start: 1, items: [{ blocks: [para("b")] }] }]);
});

test("parseMarkdown returns the same blocks for the same text", () => {
  const text = "# cached\n\nbody";
  assert.equal(parseMarkdown(text), parseMarkdown(text));
  assert.deepEqual(parseMarkdown(text), parseBlocks(text));
});

test("inline: bold, italic, strike, code and their nesting", () => {
  assert.deepEqual(parseInline("**bold** and `code`"), [
    { kind: "bold", children: [{ kind: "text", text: "bold" }] },
    { kind: "text", text: " and " },
    { kind: "code", text: "code" },
  ]);
  assert.deepEqual(parseInline("*it **b** it*"), [
    {
      kind: "italic",
      children: [
        { kind: "text", text: "it " },
        { kind: "bold", children: [{ kind: "text", text: "b" }] },
        { kind: "text", text: " it" },
      ],
    },
  ]);
  assert.deepEqual(parseInline("~~gone~~ ***both***"), [
    { kind: "strike", children: [{ kind: "text", text: "gone" }] },
    { kind: "text", text: " " },
    { kind: "bold", children: [{ kind: "italic", children: [{ kind: "text", text: "both" }] }] },
  ]);
  assert.deepEqual(parseInline("**bold *it***"), [
    {
      kind: "bold",
      children: [
        { kind: "text", text: "bold " },
        { kind: "italic", children: [{ kind: "text", text: "it" }] },
      ],
    },
  ]);
});

test("inline: emphasis next to CJK text, and no emphasis inside snake_case or around spaces", () => {
  assert.deepEqual(parseInline("这是**重点**内容"), [
    { kind: "text", text: "这是" },
    { kind: "bold", children: [{ kind: "text", text: "重点" }] },
    { kind: "text", text: "内容" },
  ]);
  assert.deepEqual(parseInline("**注意：**先保存"), [
    { kind: "bold", children: [{ kind: "text", text: "注意：" }] },
    { kind: "text", text: "先保存" },
  ]);
  assert.deepEqual(parseInline("snake_case_name and 2 * 3 * 4"), [{ kind: "text", text: "snake_case_name and 2 * 3 * 4" }]);
  assert.deepEqual(parseInline("_under_"), [{ kind: "italic", children: [{ kind: "text", text: "under" }] }]);
});

test("inline: code spans keep markup literal and may hold backticks", () => {
  assert.deepEqual(parseInline("`**not bold**`"), [{ kind: "code", text: "**not bold**" }]);
  assert.deepEqual(parseInline("`` a`b ``"), [{ kind: "code", text: "a`b" }]);
  assert.deepEqual(parseInline("**a `*` b**"), [
    { kind: "bold", children: [{ kind: "text", text: "a " }, { kind: "code", text: "*" }, { kind: "text", text: " b" }] },
  ]);
});

test("inline: unclosed markers while streaming stay text", () => {
  assert.deepEqual(parseInline("**half bold"), [{ kind: "text", text: "**half bold" }]);
  assert.deepEqual(parseInline("`open code"), [{ kind: "text", text: "`open code" }]);
  assert.deepEqual(parseInline("[label](http://exa"), [{ kind: "text", text: "[label](http://exa" }]);
});

test("inline: links, images, autolinks and bare URLs", () => {
  assert.deepEqual(parseInline('see [the **docs**](https://a.dev/x_(y) "t")'), [
    { kind: "text", text: "see " },
    {
      kind: "link",
      url: "https://a.dev/x_(y)",
      children: [{ kind: "text", text: "the " }, { kind: "bold", children: [{ kind: "text", text: "docs" }] }],
    },
  ]);
  assert.deepEqual(parseInline("![shot](https://a.dev/s.png)"), [
    { kind: "link", url: "https://a.dev/s.png", children: [{ kind: "text", text: "shot" }] },
  ]);
  assert.deepEqual(parseInline("<https://a.dev>"), [{ kind: "link", url: "https://a.dev", children: [{ kind: "text", text: "https://a.dev" }] }]);
  assert.deepEqual(parseInline("打开 https://example.com/a。然后"), [
    { kind: "text", text: "打开 " },
    { kind: "link", url: "https://example.com/a", children: [{ kind: "text", text: "https://example.com/a" }] },
    { kind: "text", text: "。然后" },
  ]);
  assert.deepEqual(parseInline("(see https://example.com/a)."), [
    { kind: "text", text: "(see " },
    { kind: "link", url: "https://example.com/a", children: [{ kind: "text", text: "https://example.com/a" }] },
    { kind: "text", text: ")." },
  ]);
});

test("inline: backslash escapes", () => {
  assert.deepEqual(parseInline("\\*not italic\\* and \\`tick\\`"), [{ kind: "text", text: "*not italic* and `tick`" }]);
});

test("unclosed markers and long replies parse in linear-ish time", () => {
  const started = performance.now();
  for (const text of ["*a **b ".repeat(400), "_a __b ~~c ".repeat(300), "[a](".repeat(500), "`a ``b ".repeat(400)]) parseInline(text);
  const doc = "# T\n\nSome **bold** and `code` https://x.dev/a.\n\n- a\n  - b\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n```ts\nx\n```\n\n".repeat(300);
  assert.ok(parseBlocks(doc).length > 1000);
  assert.ok(performance.now() - started < 2_000);
});
