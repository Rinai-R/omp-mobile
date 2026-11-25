import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { WebSocketServer } from "ws";
import { RELAY_HEADER, RelayHost, createTunnelRouter } from "../src/relay.mjs";

const TOKEN = "t".repeat(48);
let server;
let port;
/** What the daemon side saw of the last request. */
let seen;
const IMAGE = Buffer.from(Array.from({ length: 2_000_001 }, (_, index) => index % 251));

before(async () => {
  server = createServer((req, res) => {
    seen = { url: req.url, authorization: req.headers.authorization, relay: req.headers[RELAY_HEADER] };
    if (req.url === "/image") {
      res.writeHead(200, { "content-type": "image/png", "content-length": IMAGE.length });
      res.end(IMAGE);
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, text: "é".repeat(10) }));
  });
  const sockets = new WebSocketServer({ server });
  sockets.on("connection", (socket, req) => {
    seen = { url: req.url, relay: req.headers[RELAY_HEADER] };
    socket.on("message", (data) => socket.send(`echo:${data}`));
    socket.send("x".repeat(2_500_000));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = server.address().port;
});

after(() => server.close());

/** A router with its events collected per handle. */
function phone() {
  const events = [];
  const router = createTunnelRouter({ port, token: TOKEN }, async (message) => {
    events.push(message.payload.data);
  });
  let next = 0;
  const call = async (method, params) => {
    next += 1;
    const answer = await router.handle({ id: `r${next}`, type: "rpc.request", payload: { method, params } });
    if (answer.type === "rpc.error") throw Object.assign(new Error(answer.payload.message), { code: answer.payload.code });
    return answer.payload.result;
  };
  const until = async (check) => {
    for (let i = 0; i < 200 && !check(); i += 1) await new Promise((resolve) => setTimeout(resolve, 10));
    assert.ok(check(), "timed out");
  };
  return { events, call, until, router };
}

test("a request reaches the daemon with its token and the relay mark, never the phone's own credentials", async () => {
  const { events, call, until } = phone();
  const head = await call("omp.http.open", { id: "a", method: "GET", path: "/sessions?x=1", headers: { authorization: "Bearer phone", accept: "application/json" } });
  assert.equal(head.status, 200);
  await until(() => events.some((event) => event.done));
  assert.deepEqual(seen, { url: "/sessions?x=1", authorization: `Bearer ${TOKEN}`, relay: "1" });
  assert.deepEqual(JSON.parse(events.map((event) => event.text ?? "").join("")), { ok: true, text: "é".repeat(10) });
});

test("a binary answer arrives as base64 parts that join into the original bytes, its length announced first", async () => {
  const { events, call, until } = phone();
  const head = await call("omp.http.open", { id: "b", method: "GET", path: "/image" });
  assert.deepEqual(head.headers, { "content-type": "image/png", "content-length": String(IMAGE.length) }, "the phone can show progress");
  await until(() => events.some((event) => event.done));
  const parts = events.filter((event) => event.data !== undefined);
  assert.ok(parts.length > 1);
  assert.deepEqual(Buffer.from(parts.map((event) => event.data).join(""), "base64"), IMAGE);
});

test("relay control and other origins are not reachable through the tunnel", async () => {
  const { call } = phone();
  await assert.rejects(call("omp.http.open", { id: "c", path: "/relay/pair" }), { code: "METHOD_NOT_ALLOWED" });
  await assert.rejects(call("omp.http.open", { id: "d", path: "//evil.example/x" }), { code: "INVALID_MESSAGE" });
  await assert.rejects(call("omp.http.open", { id: "e", path: "http://evil.example/x" }), { code: "INVALID_MESSAGE" });
});

test("a WebSocket carries the token in its query, splits large messages and echoes what the phone sends", async () => {
  const { events, call, until, router } = phone();
  await call("omp.ws.open", { id: "w", path: "/sessions/abc/ws?since=3&token=phone" });
  const url = new URL(seen.url, "http://x");
  assert.equal(url.searchParams.get("token"), TOKEN);
  assert.equal(url.searchParams.get("since"), "3");
  assert.equal(seen.relay, "1");
  await until(() => events.some((event) => event.text !== undefined && event.more !== true));
  const first = [];
  for (const event of events) {
    first.push(event.text);
    if (event.more !== true) break;
  }
  assert.ok(first.length > 1);
  assert.equal(first.join(""), "x".repeat(2_500_000));
  await call("omp.ws.send", { id: "w", text: "hi" });
  await until(() => events.some((event) => event.text === "echo:hi"));
  router.closePeerStreams();
});

test("start never waits for a password: stored tokens connect and none means unpaired", async () => {
  const dir = mkdtempSync(join(tmpdir(), "omp-relay-start-"));
  const host = new RelayHost({
    // Nothing listens here: any network call would reject, so an unpaired start proves none was made.
    serverUrl: "http://127.0.0.1:9",
    dir,
    name: "test host",
    version: "0.0.0",
    port: () => 1,
    token: TOKEN,
    log: () => undefined,
  });
  // Must resolve: a background start (launchd) has no terminal to ask for a password.
  await host.start();
  const status = await host.status();
  assert.equal(status.paired, false);
  assert.equal(status.online, false);
  await host.close();
});

test("status reports an account login, and logout clears it and the stored tokens", async () => {
  const { writeFileSync } = await import("node:fs");
  const dir = mkdtempSync(join(tmpdir(), "omp-relay-logout-"));
  const host = new RelayHost({
    serverUrl: "http://127.0.0.1:9",
    dir,
    name: "test host",
    version: "0.0.0",
    port: () => 1,
    token: TOKEN,
    log: () => undefined,
  });
  // Identity first: the credential file is keyed by this host's device id.
  await host.start();
  const before = await host.status();
  assert.equal(before.paired, false);
  assert.equal(before.account, undefined);

  const { join: joinPath } = await import("node:path");
  const credentials = joinPath(dir, "server-credentials.json");
  writeFileSync(credentials, JSON.stringify({
    schemaVersion: 1,
    serverUrl: "http://127.0.0.1:9",
    deviceId: before.deviceId,
    authorizationMethod: "account",
    account: "user@example.com",
    accessToken: "a".repeat(24),
    accessTokenExpiresAt: Date.now() + 3_600_000,
    refreshToken: "r".repeat(24),
    refreshTokenExpiresAt: Date.now() + 3_600_000,
  }), { mode: 0o600 });
  const signedIn = await host.status();
  assert.equal(signedIn.paired, true);
  assert.equal(signedIn.account, "user@example.com");

  // The server is unreachable, so the revoke fails and the local tokens must go anyway.
  await host.logout();
  const after = await host.status();
  assert.equal(after.paired, false);
  assert.equal(after.account, undefined);
  await host.close();
});
