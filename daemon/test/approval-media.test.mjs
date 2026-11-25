import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { approvalImages } from "../src/approval-media.mjs";
test("only local image references present in the form are exposed; remote images stay remote", () => {
  const cwd = mkdtempSync(join(tmpdir(), "omp-form-media-"));
  writeFileSync(
    join(cwd, "diagram.svg"),
    '<svg xmlns="http://www.w3.org/2000/svg"><circle r="1"/></svg>',
  );
  writeFileSync(join(cwd, "private.txt"), "not an image");
  const r = {
    id: "f",
    method: "form",
    html: '<form><img src="diagram.svg" alt="Diagram"><img src="https://example.com/p.png"><img src="private.txt"><img src="missing.png"><input name="answer"></form>',
  };
  const view = approvalImages(r, cwd);
  assert.deepEqual(Object.keys(view.images), ["diagram.svg"]);
  assert.equal(view.images["diagram.svg"].mimeType, "image/svg+xml");
  assert.match(
    Buffer.from(view.images["diagram.svg"].data, "base64").toString(),
    /<circle/,
  );
  assert.equal(view.html, r.html);
  assert.equal(r.images, undefined);
});
