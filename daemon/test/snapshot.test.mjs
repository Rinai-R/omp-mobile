import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { existsSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import WebSocket from "ws";
import { Daemon, SessionEntry, phoneMessage, pruneBlobCache } from "../src/server.mjs";

/** A PNG-ish payload big enough to be stashed. */
const bytes = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(8_000, 7)]);
const base64 = bytes.toString("base64");
const hash = createHash("sha256").update(bytes).digest("hex");

test("a snapshot message carries images as blob references and only the details the app reads", () => {
  const blobDir = mkdtempSync(join(tmpdir(), "omp-mobile-blobs-"));
  const message = {
    role: "toolResult",
    toolName: "edit",
    content: [
      { type: "text", text: "ok" },
      { type: "image", data: base64, mimeType: "image/png" },
      { type: "image", data: "aGVsbG8=", mimeType: "image/png" },
    ],
    details: { diff: "+1 a", oldText: "x".repeat(10_000), newText: "y".repeat(10_000), totalLines: 3, displayContent: "z" },
  };
  const phone = phoneMessage(message, blobDir);
  assert.equal(phone.content[1].data, `blob:sha256:${hash}`);
  assert.equal(phone.content[1].mimeType, "image/png");
  assert.deepEqual(readFileSync(join(blobDir, hash)), bytes, "the image is in the cache under its hash");
  assert.equal(phone.content[2].data, "aGVsbG8=", "a tiny image stays inline");
  assert.deepEqual(phone.details, { diff: "+1 a", totalLines: 3 });
  // The message OMP gave is untouched (live events keep sending it whole).
  assert.equal(message.content[1].data, base64);
  assert.equal(message.details.oldText.length, 10_000);
  // Already a reference, a user message's details, no cache dir: left alone.
  assert.equal(phoneMessage({ role: "user", content: [{ type: "image", data: `blob:sha256:${hash}` }] }, blobDir).content[0].data, `blob:sha256:${hash}`);
  assert.deepEqual(phoneMessage({ role: "assistant", details: { a: 1 } }, blobDir).details, { a: 1 });
  assert.equal(phoneMessage(message, undefined).content[1].data, base64);
});

test("old stashed images are pruned; recent ones stay", () => {
  const blobDir = mkdtempSync(join(tmpdir(), "omp-mobile-blobs-"));
  const old = "a".repeat(64);
  const fresh = "b".repeat(64);
  writeFileSync(join(blobDir, old), "x");
  writeFileSync(join(blobDir, fresh), "y");
  const longAgo = (Date.now() - 40 * 24 * 60 * 60_000) / 1000;
  utimesSync(join(blobDir, old), longAgo, longAgo);
  assert.equal(pruneBlobCache(blobDir), 1);
  assert.equal(existsSync(join(blobDir, old)), false);
  assert.equal(existsSync(join(blobDir, fresh)), true);
});

test("a hydrated session holds the slim messages; /blobs serves the stashed image; the socket is deflated", async () => {
  const dir = mkdtempSync(join(tmpdir(), "omp-mobile-snapshot-"));
  const token = "snapshot-token-0123456789";
  const daemon = new Daemon({ host: "127.0.0.1", port: 0, cwd: dir, ompHome: dir, registryFile: join(dir, "sessions.json") }, token);
  const rpc = Object.assign(new EventEmitter(), {
    extensionRequests: new Map(),
    getState: async () => ({ sessionId: "s1", isStreaming: false }),
    getMessages: async () => ({
      messages: [{ role: "toolResult", toolName: "read", content: [{ type: "image", data: base64, mimeType: "image/png" }], details: { displayContent: "big" } }],
    }),
    close() {},
  });
  const entry = new SessionEntry(dir, rpc);
  entry.blobDir = daemon.blobDir;
  await entry.hydrate();
  entry.bind();
  daemon.sessions.set("s1", entry);
  assert.equal(entry.messages[0].content[0].data, `blob:sha256:${hash}`);
  assert.deepEqual(entry.messages[0].details, {});

  await daemon.listen();
  const base = `http://127.0.0.1:${daemon.server.address().port}`;
  const socket = new WebSocket(`${base.replace("http", "ws")}/sessions/s1/ws?token=${token}`);
  try {
    const blob = await fetch(`${base}/blobs/${hash}?token=${token}`);
    assert.equal(blob.status, 200);
    assert.equal(blob.headers.get("content-type"), "image/png");
    assert.deepEqual(Buffer.from(await blob.arrayBuffer()), bytes);

    const snapshot = await new Promise((resolve) => {
      socket.on("message", (data) => {
        const frame = JSON.parse(String(data));
        if (frame.type === "snapshot") resolve(frame);
      });
    });
    assert.match(socket.extensions, /permessage-deflate/, "the daemon accepted compression");
    assert.equal(snapshot.messages[0].content[0].data, `blob:sha256:${hash}`);

    // A message that ends live goes to the snapshot slim as well.
    rpc.emit("event", { type: "message_end", message: { role: "toolResult", content: [{ type: "image", data: base64, mimeType: "image/png" }], details: { diff: "d", proc: "p" } } });
    assert.equal(entry.messages[1].content[0].data, `blob:sha256:${hash}`);
    assert.deepEqual(entry.messages[1].details, { diff: "d" });
  } finally {
    socket.terminate();
    await daemon.close();
  }
});
