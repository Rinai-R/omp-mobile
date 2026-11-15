import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { launchOf } from "../src/restart.mjs";
import { Daemon, SessionEntry } from "../src/server.mjs";

test("a restart starts the daemon again with the arguments and directory it recorded", () => {
  const argv = ["--relay", "--cwd", "/Users/me/my project", "--no-qr"];
  assert.deepEqual(launchOf({ pid: process.pid, argv, cwd: "/Users/me" }), { argv, cwd: "/Users/me" });
});

test("GET /status counts the sessions running a turn, which a restart waits for", async () => {
  const dir = mkdtempSync(join(tmpdir(), "omp-mobile-restart-"));
  const token = "restart-token-0123456789";
  const daemon = new Daemon({ host: "127.0.0.1", port: 0, cwd: dir, registryFile: join(dir, "sessions.json") }, token);
  const rpc = Object.assign(new EventEmitter(), {
    getState: async () => ({ sessionId: "s1", isStreaming: false }),
    getMessages: async () => ({ messages: [] }),
    close() {},
  });
  const entry = new SessionEntry(dir, rpc);
  await entry.hydrate();
  entry.bind();
  daemon.sessions.set(entry.id, entry);
  await daemon.listen();
  const status = async () =>
    (await (await fetch(`http://127.0.0.1:${daemon.server.address().port}/status`, { headers: { authorization: `Bearer ${token}` } })).json()).busySessions;
  try {
    assert.equal(await status(), 0);
    rpc.emit("event", { type: "agent_start" });
    assert.equal(await status(), 1);
  } finally {
    await daemon.close();
  }
});
