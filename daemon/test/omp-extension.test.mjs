import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { pairingContent, pairingWidget, readState, tokenOf } from "../src/omp-extension.mjs";
import { Daemon, parseArgs } from "../src/server.mjs";

const dir = mkdtempSync(join(tmpdir(), "omp-mobile-ext-"));
after(() => rmSync(dir, { recursive: true, force: true }));

const pair = `omp-mobile://pair?url=${encodeURIComponent("http://100.64.0.5:7390")}&token=${"a".repeat(48)}`;
const state = { pid: process.pid, version: "0.0.0", url: "http://100.64.0.5:7390", pair, startedAt: 0 };

test("the state file counts only while its daemon process is alive", () => {
  const file = join(dir, "daemon.json");
  writeFileSync(file, JSON.stringify(state));
  assert.equal(readState(file)?.pid, process.pid);
  // A pid far above any real one: the daemon that wrote it is gone.
  writeFileSync(file, JSON.stringify({ ...state, pid: 2 ** 30 }));
  assert.equal(readState(file), undefined);
  writeFileSync(file, "{not json");
  assert.equal(readState(file), undefined);
  assert.equal(readState(join(dir, "missing.json")), undefined);
});

test("the pairing link's token is what /mobile authenticates with", () => {
  assert.equal(tokenOf(pair), "a".repeat(48));
});

test("the widget draws the whole code when it fits and never cuts it", () => {
  const content = pairingContent(state);
  const render = pairingWidget(content)().render;
  const codeWidth = Math.max(...content.code.map((line) => line.length)) + 1;
  const wide = render(codeWidth);
  assert.ok(wide.length > content.code.length, "title, code and notes");
  assert.ok(content.code.every((line) => wide.includes(` ${line}`)), "every code row intact");
  assert.ok(wide.every((line) => line.length <= codeWidth), "nothing wider than the terminal");
  const narrow = render(codeWidth - 1);
  assert.equal(narrow.length, 1);
  assert.match(narrow[0], /widen the terminal/);
  assert.ok(narrow[0].length <= codeWidth - 1);
});

test("/status reports a phone only for requests that are not /mobile's own probe", async () => {
  const options = { ...parseArgs(["--port", "0", "--registry-file", join(dir, "registry.json"), "--omp-home", dir]) };
  const daemon = new Daemon(options, "t".repeat(24));
  await daemon.listen();
  const { port } = daemon.server.address();
  const status = (headers = {}) =>
    fetch(`http://127.0.0.1:${port}/status`, { headers: { authorization: `Bearer ${"t".repeat(24)}`, ...headers } }).then((r) =>
      r.json(),
    );
  try {
    assert.equal((await status({ "x-omp-mobile-probe": "1" })).lastPhone, null);
    await fetch(`http://127.0.0.1:${port}/sessions`, { headers: { authorization: `Bearer ${"t".repeat(24)}` } });
    const seen = await status({ "x-omp-mobile-probe": "1" });
    assert.equal(seen.lastPhone.address, "127.0.0.1");
    assert.equal(seen.pid, process.pid);
    // A wrong token is not a phone.
    const before = seen.lastPhone.at;
    await fetch(`http://127.0.0.1:${port}/sessions`, { headers: { authorization: "Bearer nope" } });
    assert.equal((await status({ "x-omp-mobile-probe": "1" })).lastPhone.at, before);
  } finally {
    await daemon.close();
  }
});
