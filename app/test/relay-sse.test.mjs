import assert from "node:assert/strict";
import { test } from "node:test";
import { sseParser } from "../src/relay/sse.ts";

test("frames split across tunnel parts arrive whole; comments and the `live` marker carry none", () => {
  const frames = [];
  const feed = sseParser((data) => frames.push(data));
  for (const part of [": keepalive\n\ndata: {\"a\"", ":1}\n", "\nevent: live\ndata: {}\n\n", "data: one\r\ndata: two\r\n\r\n"]) feed(part);
  assert.deepEqual(frames, ['{"a":1}', "one\ntwo"]);
});
