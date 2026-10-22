import assert from "node:assert/strict";
import { test } from "node:test";
import { QUIET_ZONE, qrMatrix, renderQr } from "../src/qr.mjs";

const PAIR = `omp-mobile://pair?url=${encodeURIComponent("http://100.101.102.103:7390")}&token=${"a".repeat(48)}`;

test("the matrix has the module count of the smallest version that fits", () => {
  // Version 1 is 21 modules; a 112-byte pairing URI at level M needs version 7 (45).
  assert.equal(qrMatrix("hello").length, 21);
  const matrix = qrMatrix(PAIR);
  assert.equal(matrix.length, 45);
  for (const row of matrix) assert.equal(row.length, 45);
  // The top-left finder pattern: a dark 7x7 ring.
  assert.deepEqual(matrix[0].slice(0, 7), [true, true, true, true, true, true, true]);
  assert.equal(matrix[1][1], false);
});

test("every rendered line has equal width and only half blocks", () => {
  for (const text of ["hello", PAIR]) {
    const size = qrMatrix(text).length + QUIET_ZONE * 2;
    const lines = renderQr(text).split("\n");
    assert.equal(lines.length, Math.ceil(size / 2));
    for (const line of lines) {
      assert.equal([...line].length, size);
      assert.match(line, /^[ ▀▄█]+$/);
    }
  }
});

test("the quiet zone is blank on every side", () => {
  const lines = renderQr(PAIR).split("\n");
  const size = [...lines[0]].length;
  // QUIET_ZONE module rows fill the first QUIET_ZONE / 2 lines entirely.
  for (const line of lines.slice(0, QUIET_ZONE / 2)) assert.equal(line, " ".repeat(size));
  // 45 + 4 rows is odd: the last line is the bottom quiet row over an empty half.
  assert.equal(lines.at(-1), " ".repeat(size));
  for (const line of lines) {
    const chars = [...line];
    assert.equal(chars.slice(0, QUIET_ZONE).join(""), " ".repeat(QUIET_ZONE));
    assert.equal(chars.slice(-QUIET_ZONE).join(""), " ".repeat(QUIET_ZONE));
  }
  // The code itself starts right after the margin: the finder's top edge.
  assert.equal([...lines[1]][QUIET_ZONE], "█");
});
