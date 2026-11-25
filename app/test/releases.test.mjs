import assert from "node:assert/strict";
import { test } from "node:test";
import { findUpdates, isNewerVersion, notesFor } from "../src/releases.ts";

const sha256 = "a".repeat(64);

function release(version, { apk = true, ...rest } = {}) {
  const tag = `v${version}`;
  return {
    tag_name: tag,
    draft: false,
    prerelease: false,
    body: `notes for ${version}`,
    published_at: "2026-11-24T06:31:05Z",
    assets: apk ? [{ name: `OMP-Mobile-${tag}.apk`, state: "uploaded", digest: `sha256:${sha256}`, size: 61_234_567 }] : [],
    ...rest,
  };
}

test("offers the newest APK with the official download URL, digest and size", () => {
  const offer = findUpdates("0.9.9", [release("0.10.0")]);
  assert.deepEqual(offer?.target, {
    version: "0.10.0",
    url: "https://github.com/Rinai-R/omp-mobile/releases/download/v0.10.0/OMP-Mobile-v0.10.0.apk",
    sha256,
    bytes: 61_234_567,
  });
  assert.ok(findUpdates("0.10.0-rc.1", [release("0.10.0")]));
  assert.equal(findUpdates("0.10.0", [release("0.10.0")]), null);
  assert.equal(findUpdates("1.0.0", [release("0.10.0")]), null);
});

test("lists every skipped release newest first, numerically, and nothing installed or older", () => {
  const payload = [release("0.8.3"), release("0.10.0"), release("0.9.0"), release("0.8.2"), release("0.8.1")];
  const offer = findUpdates("0.8.2", payload);
  assert.deepEqual(offer?.versions.map((entry) => entry.version), ["0.10.0", "0.9.0", "0.8.3"]);
  assert.equal(offer?.versions[0]?.notes, "notes for 0.10.0");
  assert.equal(offer?.versions[0]?.publishedAt, Date.parse("2026-11-24T06:31:05Z"));
});

test("a newer release whose APK is not uploaded yet is neither offered nor listed", () => {
  const offer = findUpdates("0.8.2", [release("0.8.4", { apk: false }), release("0.8.3")]);
  assert.equal(offer?.target.version, "0.8.3");
  assert.deepEqual(offer?.versions.map((entry) => entry.version), ["0.8.3"]);
  assert.equal(findUpdates("0.8.2", [release("0.8.3", { apk: false })]), null);
});

test("ignores drafts, prereleases, unverifiable assets and a mismatched APK name", () => {
  const base = release("0.10.0");
  const none = (value) => assert.equal(findUpdates("0.9.9", [value]), null);
  none({ ...base, draft: true });
  none({ ...base, prerelease: true });
  none({ ...base, tag_name: "v0.10.0-rc.1", assets: [{ ...base.assets[0], name: "OMP-Mobile-v0.10.0-rc.1.apk" }] });
  none({ ...base, assets: [{ ...base.assets[0], state: "open" }] });
  none({ ...base, assets: [{ ...base.assets[0], digest: null }] });
  none({ ...base, tag_name: "v0.10.1" });
  assert.equal(findUpdates("0.9.9", { not: "a list" }), null);
});

const BODY = `A conversation held by a terminal can be read from the phone.
- Opening a held session shows its history.

### 中文
- 终端占用的会话，现在能在手机上先读历史。

## What's Changed
* Read a held session by @Rinai-R in https://github.com/Rinai-R/omp-mobile/pull/90

**Full Changelog**: https://github.com/Rinai-R/omp-mobile/compare/v0.8.2...v0.8.3`;

test("release notes keep only the reader's language and drop GitHub's generated list", () => {
  assert.equal(notesFor(BODY, "en"), "A conversation held by a terminal can be read from the phone.\n- Opening a held session shows its history.");
  assert.equal(notesFor(BODY, "zh-CN"), "- 终端占用的会话，现在能在手机上先读历史。");
});

test("a release without a Chinese part shows its English notes to a Chinese reader", () => {
  assert.equal(notesFor("- Solid chrome again.\n\n**Full Changelog**: https://example.com", "zh-CN"), "- Solid chrome again.");
  assert.equal(notesFor("", "zh-CN"), "");
});


test("saved downloads restore only for a newer version, including a stable release over its prerelease", () => {
  assert.equal(isNewerVersion("0.10.0", "0.9.9"), true);
  assert.equal(isNewerVersion("0.8.7", "0.8.7-rc.1"), true);
  assert.equal(isNewerVersion("0.8.7", "0.8.7"), false);
  assert.equal(isNewerVersion("0.8.6", "0.8.7"), false);
  assert.equal(isNewerVersion("invalid", "0.8.7"), false);
});
