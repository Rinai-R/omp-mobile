import assert from "node:assert/strict";
import { test } from "node:test";
import { setLanguage } from "../src/i18n/index.ts";
import {
  FileDownloadError,
  downloadError,
  downloadErrorKey,
  downloadErrorMessage,
  downloadTarget,
  fileName,
  humanSize,
  isUnder,
  mentionedPaths,
  mimeType,
  normalizePath,
  progressLabel,
  replyFiles,
  resolvePath,
  writtenPaths,
} from "../src/files.ts";
import { layoutRows } from "../src/rows.ts";

const tool = (name, args, extra = {}) => ({ kind: "tool", id: `t-${name}`, name, args, status: "done", ...extra });

test("mentions: paths in prose, relative or absolute, not URLs, directories or bare words", () => {
  const cwd = "/work/app";
  const text = [
    "Wrote `docs/report.md` and ./out/data.csv, see /work/app/build/app.apk.",
    "Also README.md: line 3, and src/main.ts:12.",
    "已写入summary.txt，另见 中文/说明.md。",
    "Docs at https://example.com/guide.html and file:///work/app/x.txt",
    "The dir src/ and the word version and ../other/leak.txt and /etc/hosts.",
  ].join("\n");
  assert.deepEqual(mentionedPaths(text, cwd), [
    "/work/app/docs/report.md",
    "/work/app/out/data.csv",
    "/work/app/build/app.apk",
    "/work/app/README.md",
    "/work/app/src/main.ts",
    "/work/app/已写入summary.txt",
    "/work/app/summary.txt",
    "/work/app/中文/说明.md",
  ]);
});

test("mentions are deduplicated, home paths and numbers skipped, a trailing slash on the cwd ignored", () => {
  assert.deepEqual(mentionedPaths("a.txt then ./a.txt then ~/notes.md and 1.5 and v2.0 and x/../a.txt", "/w/"), ["/w/a.txt", "/w/v2.0"]);
  assert.deepEqual(mentionedPaths("", "/w"), []);
  assert.deepEqual(mentionedPaths("report.md", ""), [], "no cwd: nothing is under it");
});

test("written paths: write, legacy and hashline edits with renames; failed calls left out", () => {
  assert.deepEqual(writtenPaths(tool("write", { path: "/tmp/out.bin", content: "x" })), ["/tmp/out.bin"]);
  assert.deepEqual(writtenPaths(tool("write", { file_path: "rel/a.txt" })), ["rel/a.txt"]);
  assert.deepEqual(writtenPaths(tool("edit", { path: "src/b.ts", old_string: "a", new_string: "b" })), ["src/b.ts"]);
  assert.deepEqual(writtenPaths(tool("multi_edit", { path: "src/m.ts", edits: [] })), ["src/m.ts"]);
  assert.deepEqual(writtenPaths(tool("edit", { input: "[src/c.ts#7D03]\nPUT 1.=1:\n+x\n[lib/d.ts#ABCD]\nMV \"lib/e.ts\"\n[docs/a b.md#00ff]\nMV other.md\n" })), [
    "src/c.ts",
    "lib/d.ts",
    "lib/e.ts",
    "docs/a b.md",
    "other.md",
  ]);
  assert.deepEqual(writtenPaths(tool("write", { path: "/etc/passwd" }, { status: "error" })), []);
  assert.deepEqual(writtenPaths(tool("read", { path: "/work/app/secret.txt" })), []);
  assert.deepEqual(writtenPaths(tool("bash", { command: "cat > made.txt" })), []);
  assert.deepEqual(writtenPaths(tool("write", null)), []);
  assert.deepEqual(writtenPaths(tool("edit", { input: "not a header\n[x.ts#12]\n" })), [], "a header needs four hex digits");
  assert.deepEqual(
    writtenPaths(
      tool("apply_patch", {
        input: "*** Begin Patch\n*** Add File: docs/new.md\n+hello\n*** Update File: src/old.ts\n*** Move to: src/moved.ts\n@@\n-a\n+b\n*** Delete File: gone.txt\n*** End Patch\n",
      }),
    ),
    ["docs/new.md", "src/old.ts", "src/moved.ts"],
    "apply_patch: added, updated and moved files, as the daemon counts them",
  );
  assert.deepEqual(writtenPaths(tool("apply_patch", { input: "*** Add File: a.md\n" }, { status: "error" })), []);
});

test("paths resolve against the cwd, POSIX-normalized; home paths stay unresolved", () => {
  assert.equal(normalizePath("/a/./b//c/../d/"), "/a/b/d");
  assert.equal(normalizePath("/../x"), "/x");
  assert.equal(resolvePath("src/a.ts", "/w"), "/w/src/a.ts");
  assert.equal(resolvePath("./src/../b.ts", "/w/"), "/w/b.ts");
  assert.equal(resolvePath("/abs/c.ts", "/w"), "/abs/c.ts");
  assert.equal(resolvePath("~/notes.md", "/w"), undefined);
  assert.equal(resolvePath("", "/w"), undefined);
  assert.equal(resolvePath("rel.txt", ""), undefined, "a relative path needs a cwd");
  assert.equal(isUnder("/w/a", "/w"), true);
  assert.equal(isUnder("/w", "/w"), false);
  assert.equal(isUnder("/wx/a", "/w"), false);
  assert.equal(isUnder("/w/a", "/"), true);
});

test("a reply's files: the turn's writes always, its mentions only when listed and present", () => {
  const cwd = "/w";
  const list = [
    { path: "/w/notes/summary.txt", name: "summary.txt", source: "mentioned", exists: true, size: 7 },
    { path: "/w/docs/report.md", name: "report.md", source: "written", exists: true, size: 9 },
    { path: "/w/gone.txt", name: "gone.txt", source: "written", exists: false },
    { path: "/w/listed-gone.md", name: "listed-gone.md", source: "mentioned", exists: false },
  ];
  const cards = replyFiles(["docs/report.md", "/w/gone.txt", "~/x.txt", "docs/report.md"], "See notes/summary.txt, docs/report.md, missing.md and listed-gone.md.", cwd, list);
  assert.deepEqual(
    cards.map((card) => [card.path, card.name, card.entry?.exists]),
    [
      ["/w/docs/report.md", "report.md", true],
      ["/w/gone.txt", "gone.txt", false],
      ["/w/notes/summary.txt", "summary.txt", true],
    ],
  );
  // Before the list arrives: the writes only, nothing known about them.
  assert.deepEqual(
    replyFiles(["docs/report.md"], "See notes/summary.txt", cwd, null).map((card) => [card.path, card.entry]),
    [["/w/docs/report.md", undefined]],
  );
});

test("a finished turn's tail carries the paths its successful calls wrote", () => {
  const rows = layoutRows([
    { kind: "message", id: "u1", role: "user", text: "go" },
    tool("write", { path: "a.txt" }),
    { ...tool("edit", { input: "[b.ts#ABCD]\n" }), id: "t2" },
    { ...tool("write", { path: "c.txt" }, { status: "error" }), id: "t3" },
    { kind: "message", id: "r1", role: "assistant", text: "Done." },
  ]);
  const tail = rows.find((row) => row.kind === "tail");
  assert.deepEqual(tail.written, ["a.txt", "b.ts"]);
});

test("names, types and sizes", () => {
  assert.equal(fileName("/w/docs/report.md"), "report.md");
  assert.equal(fileName("report.md"), "report.md");
  assert.equal(mimeType("a.PDF"), "application/pdf");
  assert.equal(mimeType("x.png"), "image/png");
  assert.equal(mimeType("notes.md"), "text/markdown");
  assert.equal(mimeType("data.csv"), "text/csv");
  assert.equal(mimeType("app.apk"), "application/vnd.android.package-archive");
  assert.equal(mimeType("main.ts"), "text/plain");
  assert.equal(mimeType("blob.unknownext"), "application/octet-stream");
  assert.equal(mimeType("Makefile"), "application/octet-stream");
  assert.equal(humanSize(0), "0 B");
  assert.equal(humanSize(512), "512 B");
  assert.equal(humanSize(1536), "1.5 KB");
  assert.equal(humanSize(20 * 1024), "20 KB");
  assert.equal(humanSize(100 * 1024 * 1024), "100 MB");
  assert.equal(humanSize(1.25 * 1024 * 1024 * 1024), "1.3 GB");
  assert.equal(progressLabel(512, 1024), "50%");
  assert.equal(progressLabel(2048, undefined), "2 KB");
  assert.equal(progressLabel(5000, 0), "4.9 KB");
  assert.equal(progressLabel(4096, 1024), "100%", "never past the whole");
});

test("a download lands in its own directory under the cache, by the file's name", () => {
  assert.equal(downloadTarget("file:///data/cache/", "/w/docs/report.md", "k1"), "file:///data/cache/files/k1/report.md");
  assert.equal(downloadTarget("file:///data/cache", "/w/a b.txt", "k2"), "file:///data/cache/files/k2/a%20b.txt");
  assert.equal(downloadTarget("file:///c/", "/w/中文.md", "k3"), `file:///c/files/k3/${encodeURIComponent("中文.md")}`);
});

test("a refused download is read from the daemon's JSON answer", () => {
  const big = downloadError(413, JSON.stringify({ error: "too large", code: "too_large", limit: 20, size: 30, relay: true }));
  assert.ok(big instanceof FileDownloadError);
  assert.deepEqual([big.status, big.code, big.relay, big.limit, big.size], [413, "too_large", true, 20, 30]);
  assert.equal(downloadErrorKey(big), "files.error.tooLargeRelay");
  assert.equal(downloadErrorKey(downloadError(413, JSON.stringify({ error: "x", code: "too_large", relay: false }))), "files.error.tooLarge");
  assert.equal(downloadErrorKey(downloadError(404, JSON.stringify({ error: "gone", code: "gone" }))), "files.error.gone");
  assert.equal(downloadErrorKey(downloadError(403, JSON.stringify({ error: "x", code: "sensitive" }))), "files.error.sensitive");
  assert.equal(downloadErrorKey(downloadError(403, JSON.stringify({ error: "x", code: "not_session_file" }))), "files.error.notSessionFile");
  assert.equal(downloadErrorKey(downloadError(403, JSON.stringify({ error: "x", code: "outside_cwd" }))), "files.error.outsideCwd");
  assert.equal(downloadErrorKey(downloadError(400, JSON.stringify({ error: "x", code: "not_file" }))), "files.error.notFile");
  assert.equal(downloadErrorKey(downloadError(400, JSON.stringify({ error: "x", code: "bad_path" }))), "files.error.badPath");
  assert.equal(downloadErrorKey(downloadError(404, JSON.stringify({ error: "unknown session" }))), "files.error.session");
  assert.equal(downloadErrorKey(downloadError(500, "<html>")), "files.error.http");
  assert.equal(downloadError(500, "<html>").message, "HTTP 500");
  assert.equal(downloadErrorKey(new Error("Network request failed")), "files.error.network");
  assert.equal(downloadErrorMessage(big), "File too large for the relay; download it on your local network");
  assert.equal(downloadErrorMessage(downloadError(413, JSON.stringify({ code: "too_large", limit: 100 * 1024 * 1024, relay: false }))), "Too large to download (over 100 MB)");
  setLanguage("zh-CN");
  try {
    assert.equal(downloadErrorMessage(big), "文件太大，需在局域网下载");
  } finally {
    setLanguage("en");
  }
});
