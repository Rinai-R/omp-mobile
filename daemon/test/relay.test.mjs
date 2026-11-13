import assert from "node:assert/strict";
import { createServer } from "node:http";
import { after, before, test } from "node:test";
import { WebSocketServer } from "ws";
import { RELAY_HEADER, createTunnelRouter } from "../src/relay.mjs";

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
      res.writeHead(200, { "content-type": "image/png" });
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

test("a binary answer arrives as base64 parts that join into the original bytes", async () => {
  const { events, call, until } = phone();
  await call("omp.http.open", { id: "b", method: "GET", path: "/image" });
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
