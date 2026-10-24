import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { setLanguage } from "../src/i18n/index.ts";
import { canTakeOver, confirmBody, heldDetail, heldLine, ownerOf } from "../src/takeover.ts";

const idle = { pid: 1, busy: false, terminal: true };
const busy = { pid: 1, busy: true, terminal: true };

afterEach(() => setLanguage("en"));

test("takeover is offered only for a held session on a daemon that offers it", () => {
  assert.equal(canTakeOver(409, ["prompt-images", "takeover"]), true);
  assert.equal(canTakeOver(409, ["prompt-images"]), false, "an older daemon");
  assert.equal(canTakeOver(404, ["takeover"]), false);
  assert.equal(canTakeOver(500, ["takeover"]), false);
});

test("a turn in progress on the computer is said before the user confirms", () => {
  setLanguage("en");
  assert.equal(heldLine(idle), "A terminal on the computer has this session open.");
  assert.equal(heldLine(busy), "A terminal on the computer is working in this session.");
  assert.equal(confirmBody(undefined), confirmBody(idle));
  assert.match(confirmBody(idle), /closes/);
  assert.match(confirmBody(busy), /turn stops/);
  assert.equal(heldDetail(busy), "working in a terminal");
  assert.equal(heldDetail(undefined), "open in a terminal");
  setLanguage("zh-CN");
  assert.match(confirmBody(busy), /停下/);
  assert.equal(heldDetail(busy), "正在终端中运行");
});

test("an owner is read only from what looks like one", () => {
  assert.deepEqual(ownerOf({ pid: 7, busy: true, terminal: false }), { pid: 7, busy: true, terminal: false });
  assert.deepEqual(ownerOf({ pid: 7 }), { pid: 7, busy: false, terminal: false });
  assert.equal(ownerOf({ pid: "7" }), undefined);
  assert.equal(ownerOf(null), undefined);
  assert.equal(ownerOf("x"), undefined);
});
