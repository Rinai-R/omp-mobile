import assert from "node:assert/strict";
import { test } from "node:test";
import { findApkUpdate } from "../src/releases.ts";

const sha256 = "a".repeat(64);
const release = {
  tag_name: "v0.10.0",
  draft: false,
  prerelease: false,
  assets: [{ name: "OMP-Mobile-v0.10.0.apk", state: "uploaded", digest: `sha256:${sha256}` }],
};

test("offers a newer APK with the official download URL and digest", () => {
  const expected = {
    version: "0.10.0",
    url: "https://github.com/Rinai-R/omp-mobile/releases/download/v0.10.0/OMP-Mobile-v0.10.0.apk",
    sha256,
  };
  assert.deepEqual(findApkUpdate("0.9.9", release), expected);
  assert.deepEqual(findApkUpdate("0.10.0-rc.1", release), expected);
  assert.equal(findApkUpdate("0.10.0", release), null);
  assert.equal(findApkUpdate("0.10.1", release), null);
  assert.equal(findApkUpdate("1.0.0", release), null);
});

test("ignores drafts, prereleases, and releases without the matching uploaded APK", () => {
  assert.equal(findApkUpdate("0.9.9", { ...release, draft: true }), null);
  assert.equal(findApkUpdate("0.9.9", { ...release, prerelease: true }), null);
  assert.equal(findApkUpdate("0.9.9", { ...release, assets: [] }), null);
  assert.equal(findApkUpdate("0.9.9", { ...release, assets: [{ ...release.assets[0], state: "open" }] }), null);
  assert.equal(findApkUpdate("0.9.9", { ...release, assets: [{ ...release.assets[0], digest: null }] }), null);
  assert.equal(findApkUpdate("0.9.9", { ...release, tag_name: "v0.10.1" }), null);
});
