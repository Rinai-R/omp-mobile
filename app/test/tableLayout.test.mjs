import assert from "node:assert/strict";
import { test } from "node:test";
import { cellWidth, columnWidths, displayColumns, fitColumns } from "../src/tableLayout.ts";

const metrics = { charWidth: 7, padding: 20, minColumn: 56, maxColumn: 200 };

test("CJK and fullwidth characters take two display columns", () => {
  assert.equal(displayColumns("uid"), 3);
  assert.equal(displayColumns("时间"), 4);
  assert.equal(displayColumns("342783 prompt（341632 缓存）"), 13 + 2 + 7 + 4 + 2);
  assert.equal(displayColumns(""), 0);
});

test("columns size to their longest cell, between the minimum and the maximum", () => {
  const widths = columnWidths(
    ["时间", "uid", "actual_model", "用量"],
    [
      ["19:29:27", "174239", "zai_glm-5.3-flashx", "342783 prompt（341632 缓存）/ 281 completion"],
      ["19:29:40", "179427", "tdpsk…vision-exp", "27027 prompt / 1377 completion"],
    ],
    metrics,
  );
  assert.equal(widths[0], 8 * 7 + 20);
  assert.equal(widths[1], 6 * 7 + 20);
  assert.equal(widths[2], 18 * 7 + 20);
  assert.equal(widths[3], 200, "a long cell wraps at the maximum");
  assert.equal(columnWidths(["a"], [["b"]], metrics)[0], 56, "a short column keeps the minimum");
});

test("a narrow table spreads over its space, a wide one keeps its widths", () => {
  assert.deepEqual(fitColumns([100, 100], 300), [150, 150]);
  const fitted = fitColumns([100, 50, 70], 333);
  assert.equal(fitted.reduce((sum, width) => sum + width, 0), 333);
  assert.deepEqual(fitColumns([200, 200], 300), [200, 200]);
  assert.deepEqual(fitColumns([], 300), []);
});

test("inline code in a cell counts at the monospace width", () => {
  const mono = { ...metrics, monoWidth: 8 };
  assert.equal(cellWidth("abc", mono), 21);
  assert.equal(cellWidth([{ text: "ab" }, { text: "seq", mono: true }], mono), 2 * 7 + 3 * 8);
  assert.equal(cellWidth([{ text: "x", mono: true }], metrics), 7, "without a monospace width code counts as text");
  assert.equal(columnWidths([[{ text: "Key" }]], [[[{ text: "transcript:<id>", mono: true }]]], mono)[0], 15 * 8 + 20);
});

test("wide characters take their own width when the metrics give one", () => {
  const cjk = { ...metrics, wideWidth: 10 };
  assert.equal(cellWidth("时间ab", cjk), 2 * 10 + 2 * 7);
  assert.equal(cellWidth("时间ab", metrics), 4 * 7 + 2 * 7);
});
