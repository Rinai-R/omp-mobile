import assert from "node:assert/strict";
import { test } from "node:test";
import { diffLines, editInput, editSides } from "../src/diff.ts";

test("an edit keeps its shared context and marks only the changed lines", () => {
  const lines = diffLines("one\ntwo\nthree", "one\nTWO\nthree");
  assert.deepEqual(lines, [
    { kind: "same", text: "one" },
    { kind: "remove", text: "two" },
    { kind: "add", text: "TWO" },
    { kind: "same", text: "three" },
  ]);
});

test("an insertion inside an unchanged line stream aligns around it", () => {
  const lines = diffLines("a\nc", "a\nb\nc");
  assert.deepEqual(
    lines.map((line) => `${line.kind}:${line.text}`),
    ["same:a", "add:b", "same:c"],
  );
});

test("a whole replacement is removals then additions, and a tail stays context", () => {
  assert.deepEqual(diffLines("old", "new"), [
    { kind: "remove", text: "old" },
    { kind: "add", text: "new" },
  ]);
  assert.deepEqual(
    diffLines("a\nb", "a\nb\nc").map((line) => `${line.kind}:${line.text}`),
    ["same:a", "same:b", "add:c"],
  );
});

test("the two edit shapes are read, and a plain call has neither", () => {
  assert.deepEqual(editSides({ old_string: "a", new_string: "b" }), { before: "a", after: "b" });
  assert.equal(editInput({ input: "PUT 3.=4:\n+b" }), "PUT 3.=4:\n+b");
  assert.equal(editSides({ path: "x" }), undefined);
  assert.equal(editInput({ path: "x" }), undefined);
  assert.equal(editSides(undefined), undefined);
});
