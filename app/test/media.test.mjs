import assert from "node:assert/strict";
import { test } from "node:test";
import { imageUri } from "../src/media.ts";

const machine = { id: "http://10.0.0.2:7390", url: "http://10.0.0.2:7390", token: "tök", name: "m", os: "darwin", version: "1", cwd: "/" };
const sha = "b".repeat(64);

test("a blob reference becomes the daemon's authenticated blob URL", () => {
  assert.equal(
    imageUri(machine, { data: `blob:sha256:${sha}`, mimeType: "image/webp" }),
    `http://10.0.0.2:7390/blobs/${sha}?token=t%C3%B6k`,
  );
});

test("inline base64 becomes a data URI, keeping its mime type", () => {
  assert.equal(imageUri(machine, { data: "AAAA", mimeType: "image/png" }), "data:image/png;base64,AAAA");
  assert.equal(imageUri(machine, { data: "data:image/gif;base64,AAAA" }), "data:image/gif;base64,AAAA");
});

test("an image the daemon cannot resolve is left out instead of rendered broken", () => {
  assert.equal(imageUri(machine, { data: "blob:sha256:not-a-hash" }), undefined);
  assert.equal(imageUri(machine, { data: "blob:sha1:abc" }), undefined);
});
