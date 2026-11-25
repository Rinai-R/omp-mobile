import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { approvalImages } from "../src/approval-media.mjs";
const form = (sources) => ({
  id: "f",
  method: "form",
  html: `<form>${sources.map((src) => `<img src="${src}">`).join("")}<input name="answer"></form>`,
});
test("local context images load, but missing files and non-images stay unavailable", () => {
  const cwd = mkdtempSync(join(tmpdir(), "omp-form-media-"));
  writeFileSync(
    join(cwd, "diagram.svg"),
    '<svg xmlns="http://www.w3.org/2000/svg"><circle r="1"/></svg>',
  );
  writeFileSync(join(cwd, "private.txt"), "not an image");
  const request = form(["diagram.svg", "private.txt", "missing.png"]);
  const view = approvalImages(request, cwd);
  assert.deepEqual(Object.keys(view.images), ["diagram.svg"]);
  assert.equal(view.images["diagram.svg"].mimeType, "image/svg+xml");
  assert.match(
    Buffer.from(view.images["diagram.svg"].data, "base64").toString(),
    /<circle/,
  );
  assert.equal(view.html, request.html);
  assert.equal(request.images, undefined);
});
test("URL-looking local filenames must not turn a remote form reference into file bytes", () => {
  const cwd = mkdtempSync(join(tmpdir(), "omp-form-remote-"));
  const urls = [
    "http://example.com/pixel.png",
    "https://example.com/track.svg",
  ];
  for (const url of urls) {
    const path = resolve(cwd, url);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, "URL-shaped local fixture");
  }
  const request = form(urls);
  assert.equal(approvalImages(request, cwd), request);
});
test("realpath confinement rejects absolute, file-URL, parent and symlink escapes but accepts OMP blob root", () => {
  const root = mkdtempSync(join(tmpdir(), "omp-form-roots-")),
    cwd = join(root, "cwd"),
    blobs = join(root, "omp-blobs");
  mkdirSync(cwd);
  mkdirSync(blobs);
  const outside = join(root, "outside.png"),
    allowed = join(cwd, "inside.png"),
    blob = join(blobs, "context.png");
  for (const path of [outside, allowed, blob]) writeFileSync(path, "fixture");
  symlinkSync(outside, join(cwd, "escape.png"));
  const request = form([
    outside,
    pathToFileURL(outside).href,
    "../outside.png",
    "escape.png",
    allowed,
    pathToFileURL(allowed).href,
    blob,
  ]);
  const view = approvalImages(request, cwd, blobs);
  assert.deepEqual(Object.keys(view.images), [
    allowed,
    pathToFileURL(allowed).href,
    blob,
  ]);
  const noBlobPermission = approvalImages(form([blob]), cwd);
  assert.equal(noBlobPermission.images, undefined);
});
