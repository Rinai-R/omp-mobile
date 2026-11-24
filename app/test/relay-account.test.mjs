import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_RELAY, joinCommands, oauthProviders, preferredFirst, relayUrl, startOAuth } from "../src/relay/account.ts";

const server = "https://relay.example.test";

test("only same-server, collectable browser sign-ins are offered, in the server's order", async (t) => {
  t.mock.method(globalThis, "fetch", async () =>
    Response.json({
      items: [
        { id: "zhihu", displayName: "知乎", startUrl: "/api/v1/auth/oauth/start", qrStartUrl: "/api/v1/auth/oauth/qr/start?provider=zhihu" },
        { id: "evil", displayName: "Evil", qrStartUrl: "https://evil.test/api/v1/auth/oauth/qr/start" },
        { id: "relative", displayName: "Relative", qrStartUrl: "//evil.test/api/v1/auth/x" },
        { id: "escape", displayName: "Escape", qrStartUrl: "/api/v1/auth/../../admin" },
        { id: "webonly", displayName: "Web only", startUrl: "/api/v1/auth/oauth/web/start" },
        { id: "github", displayName: "GitHub", qrStartUrl: "/api/v1/auth/oauth/qr/start?provider=github" },
        { id: "github", displayName: "Duplicate", qrStartUrl: "/api/v1/auth/oauth/qr/start?provider=github" },
      ],
    }),
  );
  assert.deepEqual((await oauthProviders(server)).map((item) => item.id), ["zhihu", "github"]);
});

test("a relay without the provider list offers none, so email and password remain", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ error: { code: "NOT_FOUND" } }, { status: 404 }));
  assert.deepEqual(await oauthProviders(server), []);
});

test("a sign-in page on another site is refused", async (t) => {
  const provider = { id: "github", name: "GitHub", start: "/api/v1/auth/oauth/qr/start?provider=github" };
  t.mock.method(globalThis, "fetch", async () => Response.json({ qrId: "q".repeat(24), scanUrl: "https://evil.test/login", expiresIn: 600 }));
  await assert.rejects(startOAuth(server, provider), /another site/);
  t.mock.restoreAll();
  t.mock.method(globalThis, "fetch", async () => Response.json({ qrId: "q".repeat(24), scanUrl: "/api/v1/auth/q/abc", expiresIn: 600 }));
  assert.equal((await startOAuth(server, provider)).page, `${server}/api/v1/auth/q/abc`);
});

test("the join command names the relay only when it is not the public one", () => {
  assert.equal(joinCommands(DEFAULT_RELAY, "K7QM-4XPA").omp, "/mobile login K7QM-4XPA");
  assert.equal(joinCommands(server, "K7QM-4XPA").terminal, `omp-mobile relay login K7QM-4XPA ${server}`);
});

test("a typed self-hosted address defaults to https, a LAN IP or localhost to http", () => {
  assert.equal(relayUrl("relay.example.com"), "https://relay.example.com");
  assert.equal(relayUrl(" relay.example.com:8443/ "), "https://relay.example.com:8443");
  assert.equal(relayUrl("192.168.1.20:18990"), "http://192.168.1.20:18990");
  assert.equal(relayUrl("localhost:8080"), "http://localhost:8080");
  assert.equal(relayUrl("http://relay.example.com"), "http://relay.example.com");
});

test("the reader's likely sign-in comes first; the rest keep the server's order", () => {
  const items = ["zhihu", "github", "google"].map((id) => ({ id, name: id, start: "/api/v1/auth/x" }));
  assert.deepEqual(preferredFirst(items, "en").map((item) => item.id), ["github", "zhihu", "google"]);
  assert.deepEqual(preferredFirst(items, "zh-CN").map((item) => item.id), ["zhihu", "github", "google"]);
});
