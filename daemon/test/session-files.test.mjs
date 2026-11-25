import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs, { linkSync, mkdirSync, mkdtempSync, realpathSync, renameSync, rmSync, symlinkSync, truncateSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { test } from "node:test";
import { Daemon, FEATURES, SessionEntry } from "../src/server.mjs";
import { MAX_DIRECT_FILE_BYTES, MAX_RELAY_FILE_BYTES, isSensitive, mentionedPaths, sessionFileCandidates } from "../src/session-files.mjs";

const TOKEN = "{{SECRET_wt6skrba}}";

let clock = 1;
let calls = 0;
const call = (name, args, id = `call-${(calls += 1)}`) => ({ type: "toolCall", id, name, arguments: args });
function step(calls, failed = []) {
  const at = (clock += 1);
  return [
    { role: "assistant", timestamp: at, stopReason: "toolUse", content: calls },
    ...calls.map((part) => ({ role: "toolResult", timestamp: at, toolCallId: part.id, toolName: part.name, isError: failed.includes(part.id), content: [] })),
  ];
}
const reply = (text) => ({ role: "assistant", timestamp: (clock += 1), stopReason: "stop", content: [{ type: "text", text }] });

/** A live session whose fake omp has `messages`, working in `cwd`. */
async function liveSession(daemon, id, cwd, messages) {
  const rpc = Object.assign(new EventEmitter(), {
    extensionRequests: new Map(),
    getState: async () => ({ sessionId: id, isStreaming: false, sessionFile: join(cwd, `${id}.jsonl`) }),
    getMessages: async () => ({ messages }),
    close() {},
  });
  const entry = new SessionEntry(cwd, rpc);
  await entry.hydrate();
  daemon.sessions.set(entry.id, entry);
  return entry;
}

/**
 * A project directory (realpath'd, so macOS's /var -> /private/var link does not
 * count as leaving it), a directory outside it, and a daemon serving them.
 */
async function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "omp-mobile-files-")));
  const cwd = join(root, "project");
  const outside = join(root, "outside");
  mkdirSync(join(cwd, "docs"), { recursive: true });
  mkdirSync(join(cwd, ".ssh"), { recursive: true });
  mkdirSync(join(cwd, "notes"), { recursive: true });
  mkdirSync(outside, { recursive: true });
  const daemon = new Daemon({ host: "127.0.0.1", port: 0, cwd, ompHome: root, registryFile: join(root, "sessions.json") }, TOKEN);
  await daemon.listen();
  const base = `http://127.0.0.1:${daemon.server.address().port}`;
  const get = (path, headers = {}) => fetch(`${base}${path}`, { headers: { authorization: `Bearer ${TOKEN}`, ...headers } });
  const file = (session, path, headers) => get(`/sessions/${session}/file?path=${encodeURIComponent(path)}`, headers);
  return {
    root,
    cwd,
    outside,
    daemon,
    base,
    get,
    file,
    async close() {
      await daemon.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}

async function refusal(response, status, code) {
  const body = await response.json();
  assert.equal(response.status, status, JSON.stringify(body));
  assert.equal(body.code, code, JSON.stringify(body));
  return body;
}

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

test("written paths: write, legacy and hashline edits with renames, relative to the cwd, failed calls left out", () => {
  const cwd = "/work/app";
  const messages = [
    ...step([call("write", { path: "/tmp/out.bin", content: "x" }, "w1"), call("write", { path: "rel/a.txt", content: "x" }, "w2")]),
    ...step([call("edit", { path: "src/b.ts", old_string: "a", new_string: "b" }, "e1")]),
    ...step([call("edit", { input: "[src/c.ts#7D03]\nPUT 1.=1:\n+x\n[lib/d.ts#ABCD]\nMV \"lib/e.ts\"\n" }, "e2")]),
    ...step([call("write", { path: "/etc/passwd", content: "x" }, "w3")], ["w3"]),
    ...step([call("read", { path: "/work/app/secret.txt" }, "r1"), call("bash", { command: "cat > made.txt" }, "b1")]),
  ];
  const written = [...sessionFileCandidates(messages, cwd).entries()].filter(([, source]) => source === "written").map(([path]) => path);
  assert.deepEqual(written.sort(), ["/tmp/out.bin", "/work/app/lib/d.ts", "/work/app/lib/e.ts", "/work/app/rel/a.txt", "/work/app/src/b.ts", "/work/app/src/c.ts"]);
});

test("GET /sessions/:id/file serves the session's written and mentioned files", async () => {
  const f = await fixture();
  try {
    assert.ok(FEATURES.includes("files"));
    writeFileSync(join(f.cwd, "docs", "report.md"), "# report\n");
    writeFileSync(join(f.outside, "made.bin"), Buffer.from([0, 1, 2, 255]));
    writeFileSync(join(f.cwd, "rel.txt"), "relative");
    writeFileSync(join(f.cwd, "notes", "summary.txt"), "said in a reply");
    await liveSession(f.daemon, "s1", f.cwd, [
      ...step([call("write", { path: join(f.cwd, "docs", "report.md"), content: "# report\n" }), call("write", { path: join(f.outside, "made.bin") }), call("write", { path: "rel.txt" })]),
      reply("Done: see `notes/summary.txt`."),
    ]);

    assert.equal((await fetch(`${f.base}/sessions/s1/file?path=${encodeURIComponent(join(f.cwd, "rel.txt"))}`)).status, 401, "token as every route");

    const report = await f.file("s1", join(f.cwd, "docs", "report.md"));
    assert.equal(report.status, 200);
    assert.equal(report.headers.get("content-type"), "application/octet-stream", "binary, so the relay tunnel sends it as data");
    assert.equal(report.headers.get("content-length"), "9");
    assert.equal(report.headers.get("content-disposition"), "attachment; filename*=UTF-8''report.md");
    assert.equal(await report.text(), "# report\n");

    const outside = await f.file("s1", join(f.outside, "made.bin"));
    assert.equal(outside.status, 200, "a file the session wrote may lie outside its directory");
    assert.deepEqual([...new Uint8Array(await outside.arrayBuffer())], [0, 1, 2, 255]);
    assert.equal(await (await f.file("s1", join(f.cwd, "rel.txt"))).text(), "relative");
    assert.equal(await (await f.file("s1", join(f.cwd, "notes", "summary.txt"))).text(), "said in a reply");
  } finally {
    await f.close();
  }
});

test("GET /sessions/:id/file refuses anything the session did not write or mention", async () => {
  const f = await fixture();
  try {
    writeFileSync(join(f.cwd, "untouched.txt"), "never mentioned");
    writeFileSync(join(f.outside, "elsewhere.txt"), "mentioned but outside the cwd");
    writeFileSync(join(f.outside, "failed.txt"), "the write failed");
    writeFileSync(join(f.cwd, "theirs.txt"), "another session's file");
    await liveSession(f.daemon, "s1", f.cwd, [
      ...step([call("write", { path: join(f.outside, "failed.txt") }, "bad")], ["bad"]),
      ...step([call("read", { path: join(f.cwd, "untouched.txt") })]),
      reply(`See ${join(f.outside, "elsewhere.txt")} and ../outside/elsewhere.txt`),
    ]);
    await liveSession(f.daemon, "s2", f.cwd, [...step([call("write", { path: join(f.cwd, "theirs.txt") })])]);

    await refusal(await f.file("s1", join(f.cwd, "untouched.txt")), 403, "not_session_file");
    await refusal(await f.file("s1", "/etc/hosts"), 403, "not_session_file");
    await refusal(await f.file("s1", join(f.outside, "elsewhere.txt")), 403, "not_session_file");
    await refusal(await f.file("s1", join(f.outside, "failed.txt")), 403, "not_session_file");
    await refusal(await f.file("s1", join(f.cwd, "theirs.txt")), 403, "not_session_file");
    assert.equal((await f.file("s2", join(f.cwd, "theirs.txt"))).status, 200, "the session that wrote it gets it");

    await refusal(await f.file("s1", "untouched.txt"), 400, "bad_path");
    await refusal(await f.file("s1", `${f.cwd}/docs/../untouched.txt`), 400, "bad_path");
    await refusal(await f.get("/sessions/s1/file"), 400, "bad_path");
    assert.equal((await f.file("nope", join(f.cwd, "theirs.txt"))).status, 404);
  } finally {
    await f.close();
  }
});

test("GET /sessions/:id/file refuses symlinks out, sensitive files, directories and gone files", async () => {
  const f = await fixture();
  try {
    writeFileSync(join(f.outside, "target.txt"), "outside");
    symlinkSync(join(f.outside, "target.txt"), join(f.cwd, "link.txt"));
    symlinkSync(f.outside, join(f.cwd, "linkdir"));
    writeFileSync(join(f.cwd, ".env.local"), "SECRET=1");
    writeFileSync(join(f.cwd, "server.key"), "key");
    writeFileSync(join(f.cwd, ".ssh", "config"), "Host x");
    writeFileSync(join(f.cwd, "api-token"), "t");
    writeFileSync(join(f.cwd, "gone.txt"), "soon gone");
    // A directory link into a sensitive directory: the name looks harmless until resolved.
    mkdirSync(join(f.outside, ".aws"));
    writeFileSync(join(f.outside, ".aws", "config"), "[default]");
    symlinkSync(join(f.outside, ".aws"), join(f.cwd, "settings"));
    await liveSession(f.daemon, "s1", f.cwd, [
      ...step([
        call("write", { path: join(f.cwd, "link.txt") }),
        call("write", { path: join(f.cwd, ".env.local") }),
        call("write", { path: join(f.cwd, "server.key") }),
        call("write", { path: join(f.cwd, ".ssh", "config") }),
        call("write", { path: join(f.cwd, "api-token") }),
        call("write", { path: join(f.cwd, "gone.txt") }),
        call("write", { path: join(f.cwd, "settings", "config") }),
        call("write", { path: join(f.cwd, ".env.removed") }),
      ]),
      reply(`Look at linkdir/target.txt and ${join(f.cwd, "docs")}.`),
    ]);
    rmSync(join(f.cwd, "gone.txt"));

    await refusal(await f.file("s1", join(f.cwd, "link.txt")), 403, "outside_cwd");
    await refusal(await f.file("s1", join(f.cwd, "linkdir", "target.txt")), 403, "outside_cwd");
    await refusal(await f.file("s1", join(f.cwd, ".env.local")), 403, "sensitive");
    await refusal(await f.file("s1", join(f.cwd, "server.key")), 403, "sensitive");
    await refusal(await f.file("s1", join(f.cwd, ".ssh", "config")), 403, "sensitive");
    await refusal(await f.file("s1", join(f.cwd, "api-token")), 403, "sensitive");
    await refusal(await f.file("s1", join(f.cwd, "settings", "config")), 403, "sensitive");
    // Refused by name, before the disk says whether it exists.
    await refusal(await f.file("s1", join(f.cwd, ".env.removed")), 403, "sensitive");
    await refusal(await f.file("s1", join(f.cwd, "docs")), 400, "not_file");
    await refusal(await f.file("s1", join(f.cwd, "gone.txt")), 404, "gone");
  } finally {
    await f.close();
  }
});

test("GET /sessions/:id/file caps a direct download at 100 MB and a relayed one at 20 MB", async () => {
  const f = await fixture();
  try {
    const huge = join(f.cwd, "huge.bin");
    const mid = join(f.cwd, "mid.bin");
    writeFileSync(huge, "");
    truncateSync(huge, MAX_DIRECT_FILE_BYTES + 1);
    writeFileSync(mid, "");
    truncateSync(mid, MAX_RELAY_FILE_BYTES + 1);
    await liveSession(f.daemon, "s1", f.cwd, [...step([call("write", { path: huge }), call("write", { path: mid })])]);

    assert.equal(MAX_DIRECT_FILE_BYTES, 100 * 1024 * 1024);
    assert.equal(MAX_RELAY_FILE_BYTES, 20 * 1024 * 1024);
    const tooBig = await refusal(await f.file("s1", huge), 413, "too_large");
    assert.deepEqual([tooBig.limit, tooBig.size, tooBig.relay], [MAX_DIRECT_FILE_BYTES, MAX_DIRECT_FILE_BYTES + 1, false]);
    const relayed = await refusal(await f.file("s1", mid, { "x-omp-mobile-relay": "1" }), 413, "too_large");
    assert.deepEqual([relayed.limit, relayed.relay], [MAX_RELAY_FILE_BYTES, true]);

    // Direct, the same file streams whole.
    const direct = await f.file("s1", mid);
    assert.equal(direct.status, 200);
    assert.equal(direct.headers.get("content-length"), String(MAX_RELAY_FILE_BYTES + 1));
    let received = 0;
    for await (const chunk of direct.body) received += chunk.length;
    assert.equal(received, MAX_RELAY_FILE_BYTES + 1);
  } finally {
    await f.close();
  }
});

test("GET /sessions/:id/files lists what may be downloaded, newest first", async () => {
  const f = await fixture();
  try {
    writeFileSync(join(f.cwd, "docs", "report.md"), "# report\n");
    writeFileSync(join(f.cwd, "notes", "summary.txt"), "summary");
    writeFileSync(join(f.cwd, ".env"), "SECRET=1");
    writeFileSync(join(f.cwd, "old.txt"), "old");
    await liveSession(f.daemon, "s1", f.cwd, [
      ...step([call("write", { path: join(f.cwd, "old.txt") }), call("write", { path: join(f.cwd, "deleted.txt") }), call("write", { path: join(f.cwd, ".env") })]),
      ...step([call("edit", { input: "[docs/report.md#1A2B]\nPUT 1.=1:\n+# report\n" })]),
      reply("Updated docs/report.md; summary in notes/summary.txt; plan in notes/missing.md."),
    ]);
    const response = await f.get("/sessions/s1/files");
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.cwd, f.cwd);
    assert.deepEqual(
      body.files.map((file) => [file.path, file.name, file.source, file.exists]),
      [
        [join(f.cwd, "notes", "summary.txt"), "summary.txt", "mentioned", true],
        [join(f.cwd, "docs", "report.md"), "report.md", "written", true],
        [join(f.cwd, "deleted.txt"), "deleted.txt", "written", false],
        [join(f.cwd, "old.txt"), "old.txt", "written", true],
      ],
      "sensitive files and mentions of nothing are left out; a written file that is gone stays, marked",
    );
    const report = body.files.find((file) => file.name === "report.md");
    assert.equal(report.size, 9);
    assert.equal(typeof report.mtime, "number");
    assert.equal((await f.get("/sessions/nope/files")).status, 404);
  } finally {
    await f.close();
  }
});

test("a session no omp runs serves its files from its session file", async () => {
  const f = await fixture();
  try {
    const sessionFile = join(f.root, "old.jsonl");
    const lines = [
      { type: "session", version: 3, id: "old", timestamp: "2026-11-25T00:00:00.000Z", cwd: f.cwd },
      ...step([call("write", { path: join(f.cwd, "docs", "out.txt") })]).map((message, index) => ({ type: "message", id: `m${index}`, parentId: null, message })),
    ];
    writeFileSync(sessionFile, `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`);
    writeFileSync(join(f.cwd, "docs", "out.txt"), "from the file");
    f.daemon.registry.set("old", { id: "old", title: "Old", cwd: f.cwd, sessionFile, createdAt: 1, updatedAt: 1 });
    assert.deepEqual((await (await f.get("/sessions/old/files")).json()).files.map((file) => file.name), ["out.txt"]);
    assert.equal(await (await f.file("old", join(f.cwd, "docs", "out.txt"))).text(), "from the file");
    assert.equal(f.daemon.sessions.size, 0, "no omp was started");
  } finally {
    await f.close();
  }
});

/** Replace `fs[name]` (seen by the daemon's named imports too) until the returned undo runs. */
function hookFs(name, wrap) {
  const original = fs[name];
  fs[name] = wrap(original);
  syncBuiltinESMExports();
  return () => {
    fs[name] = original;
    syncBuiltinESMExports();
  };
}

test("sensitive names and directories match in any case or Unicode compatibility form", () => {
  for (const path of [
    "/w/.GIT/config",
    "/w/.Git/config",
    "/w/.SSH/config",
    "/w/.\u212Aube/config", // KELVIN SIGN, which APFS takes for K
    "/w/api-to\u212Aen.txt",
    "/w/.ENV",
    "/w/\uFF0Eenv", // FULLWIDTH FULL STOP
    "/w/SERVER.PEM",
    "/w/ID_RSA",
    "/h/.Config/GH/hosts.yml",
  ]) {
    assert.ok(isSensitive(path), path);
  }
  assert.ok(!isSensitive("/w/.Github/workflows/ci.yml"));
});

test("sensitive names: credential words wherever they sit in a name, and the agents', keychains' and browsers' stores", () => {
  for (const path of [
    "/w/tokenFile.txt",
    "/w/secretValues.yaml",
    "/w/PasswordList.csv",
    "/w/githubToken.txt",
    "/w/accessToken.json",
    "/w/GITHUB_TOKEN",
    "/w/githubtoken",
    "/w/apikey.txt",
    "/w/api_key",
    "/w/apiKeys.json",
    "/w/private_key",
    "/w/privateKey.txt",
    "/w/dbPassword.txt",
    "/w/client-secret.json",
    "/w/auth.json",
    "/w/auth.db",
    "/w/login.keychain-db",
    "/w/kubeconfig",
    "/w/.claude.json",
    "/h/.zsh_history",
    "/h/.bash_history",
    "/h/.omp/agent/mcp.json",
    "/h/.codex/config.toml",
    "/h/.claude/settings.json",
    "/h/Library/Keychains/x.db",
    "/h/Library/Cookies/Cookies.binarycookies",
    "/h/Library/Safari/History.db",
    "/h/Library/Application Support/Google/Chrome/Default/Preferences",
    "/h/Library/Application Support/Firefox/Profiles/x/places.sqlite",
    "/h/Library/Application Support/BraveSoftware/Brave-Browser/Default/Bookmarks",
    "/h/Library/Application Support/Microsoft Edge/Default/History",
    "/h/.mozilla/firefox/x/prefs.js",
    "/h/.config/google-chrome/Default/Bookmarks",
    "/h/.password-store/x.gpg",
    "/h/.local/share/keyrings/login.keyring",
  ]) {
    assert.ok(isSensitive(path), path);
  }
  for (const path of ["/w/tokenizer.ts", "/w/keyboard.md", "/w/hotkey.json", "/w/author.md", "/w/authentication.md", "/w/passwordless.md", "/w/report/summary.md", "/h/Library/Application Support/Code/User/settings.json"]) {
    assert.ok(!isSensitive(path), path);
  }
});

test("GET /sessions/:id/file refuses secrets asked for in another case or Unicode form", async () => {
  const f = await fixture();
  try {
    mkdirSync(join(f.cwd, ".git"));
    writeFileSync(join(f.cwd, ".git", "config"), "url = https://user:not-a-real-password@example.com/x.git");
    writeFileSync(join(f.cwd, ".ssh", "config"), "Host x");
    mkdirSync(join(f.cwd, ".kube"));
    writeFileSync(join(f.cwd, ".kube", "config"), "token: x");
    writeFileSync(join(f.cwd, "api-token.txt"), "t");
    writeFileSync(join(f.cwd, "githubToken.txt"), "t");
    mkdirSync(join(f.outside, ".omp", "agent"), { recursive: true });
    writeFileSync(join(f.outside, ".omp", "agent", "mcp.json"), '{"key":"x"}');
    await liveSession(f.daemon, "s1", f.cwd, [
      ...step([call("edit", { path: join(f.outside, ".omp", "agent", "mcp.json") })]),
      reply("See .GIT/config, .Git/config, .SSH/config, .\u212Aube/config, api-to\u212Aen.txt and githubToken.txt"),
    ]);
    for (const path of [".GIT/config", ".Git/config", ".SSH/config", ".\u212Aube/config", "api-to\u212Aen.txt", "githubToken.txt"]) {
      await refusal(await f.file("s1", join(f.cwd, path)), 403, "sensitive");
    }
    await refusal(await f.file("s1", join(f.outside, ".omp", "agent", "mcp.json")), 403, "sensitive");
    assert.deepEqual((await (await f.get("/sessions/s1/files")).json()).files, [], "none of them is listed");
  } finally {
    await f.close();
  }
});

test("GET /sessions/:id/file refuses a written file once a directory on its way became a link elsewhere", async () => {
  const f = await fixture();
  try {
    mkdirSync(join(f.cwd, "build"));
    writeFileSync(join(f.cwd, "build", "data.txt"), "the session's");
    mkdirSync(join(f.outside, "out"));
    writeFileSync(join(f.outside, "out", "report.txt"), "the session's");
    mkdirSync(join(f.outside, "other"));
    writeFileSync(join(f.outside, "other", "data.txt"), "someone else's");
    writeFileSync(join(f.outside, "other", "report.txt"), "someone else's");
    mkdirSync(join(f.cwd, "gen"));
    writeFileSync(join(f.cwd, "gen", "a.txt"), "the session's");
    writeFileSync(join(f.cwd, "docs", "a.txt"), "also in the project");
    writeFileSync(join(f.outside, "sys.txt"), "through the system's own links");
    // The same file by a path that goes through the OS's links (macOS: /var -> /private/var).
    const viaSystem = join(realpathSync(tmpdir()) === tmpdir() ? f.root : join(tmpdir(), basename(f.root)), "outside", "sys.txt");
    await liveSession(f.daemon, "s1", f.cwd, [
      ...step([
        call("write", { path: join(f.cwd, "build", "data.txt") }),
        call("write", { path: join(f.outside, "out", "report.txt") }),
        call("write", { path: join(f.cwd, "gen", "a.txt") }),
        call("write", { path: viaSystem }),
      ]),
    ]);
    rmSync(join(f.cwd, "build"), { recursive: true });
    symlinkSync(join(f.outside, "other"), join(f.cwd, "build"));
    rmSync(join(f.outside, "out"), { recursive: true });
    symlinkSync(join(f.outside, "other"), join(f.outside, "out"));
    rmSync(join(f.cwd, "gen"), { recursive: true });
    symlinkSync(join(f.cwd, "docs"), join(f.cwd, "gen"));

    await refusal(await f.file("s1", join(f.cwd, "build", "data.txt")), 403, "outside_cwd");
    await refusal(await f.file("s1", join(f.outside, "out", "report.txt")), 403, "outside_cwd");
    const listed = (await (await f.get("/sessions/s1/files")).json()).files.map((file) => file.path);
    assert.ok(!listed.includes(join(f.cwd, "build", "data.txt")) && !listed.includes(join(f.outside, "out", "report.txt")), "not listed either");
    // A link that stays in the project serves what lies there, as a named file would.
    assert.equal(await (await f.file("s1", join(f.cwd, "gen", "a.txt"))).text(), "also in the project");
    assert.equal(await (await f.file("s1", viaSystem)).text(), "through the system's own links");
  } finally {
    await f.close();
  }
});

test("GET /sessions/:id/file refuses a named file with other hard links; a written one is still served", async () => {
  const f = await fixture();
  try {
    writeFileSync(join(f.outside, "secret.txt"), "outside the project");
    linkSync(join(f.outside, "secret.txt"), join(f.cwd, "notes.txt"));
    writeFileSync(join(f.outside, "made.txt"), "written by the session");
    linkSync(join(f.outside, "made.txt"), join(f.cwd, "made.txt"));
    await liveSession(f.daemon, "s1", f.cwd, [...step([call("write", { path: join(f.cwd, "made.txt") })]), reply("See notes.txt")]);
    await refusal(await f.file("s1", join(f.cwd, "notes.txt")), 403, "outside_cwd");
    assert.equal(await (await f.file("s1", join(f.cwd, "made.txt"))).text(), "written by the session");
  } finally {
    await f.close();
  }
});

test("GET /sessions/:id/file does not serve a file swapped between its checks and its opening", async () => {
  const f = await fixture();
  const target = join(f.cwd, "docs", "report.md");
  let undo = () => {};
  try {
    writeFileSync(target, "checked");
    const named = join(f.cwd, "docs", "named.md");
    writeFileSync(named, "named in the reply");
    await liveSession(f.daemon, "s1", f.cwd, [...step([call("write", { path: target })]), reply("See docs/named.md")]);
    const swapBeforeOpen = (swap, at = target) =>
      hookFs("openSync", (original) => (path, ...rest) => {
        if (path === at) {
          undo();
          swap();
        }
        return original(path, ...rest);
      });

    // Another file renamed over it: a different inode.
    writeFileSync(join(f.outside, "other.md"), "swapped in");
    undo = swapBeforeOpen(() => renameSync(join(f.outside, "other.md"), target));
    let answer = await f.file("s1", target);
    undo();
    assert.equal(answer.status, 404);
    assert.doesNotMatch(await answer.text(), /swapped in/);

    // A link put in its place, to the very file that was checked (moved away): links are not followed.
    writeFileSync(target, "checked");
    undo = swapBeforeOpen(() => {
      renameSync(target, join(f.outside, "moved.md"));
      symlinkSync(join(f.outside, "moved.md"), target);
    });
    answer = await f.file("s1", target);
    undo();
    assert.equal(answer.status, 404);
    assert.doesNotMatch(await answer.text(), /checked/);

    // A hard link made to a named file after its checks: it is no longer only the project's.
    undo = swapBeforeOpen(() => linkSync(named, join(f.outside, "named-link.md")), named);
    answer = await f.file("s1", named);
    undo();
    assert.equal(answer.status, 404);
    assert.doesNotMatch(await answer.text(), /named in the reply/);
  } finally {
    undo();
    await f.close();
  }
});

test("GET /sessions/:id/file answers gone for a file removed while it is checked", async () => {
  const f = await fixture();
  const target = join(f.cwd, "docs", "brief.md");
  let undo = () => {};
  try {
    writeFileSync(target, "soon gone");
    await liveSession(f.daemon, "s1", f.cwd, [...step([call("write", { path: target })])]);
    const removeFirst = (original) => (path, ...rest) => {
      if (path === target) rmSync(target, { force: true });
      return original(path, ...rest);
    };
    undo = hookFs("realpathSync", (original) => Object.assign(removeFirst(original), { native: removeFirst(original.native) }));
    const answer = await f.file("s1", target);
    undo();
    await refusal(answer, 404, "gone");
  } finally {
    undo();
    await f.close();
  }
});
