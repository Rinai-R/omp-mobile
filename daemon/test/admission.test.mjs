import assert from "node:assert/strict";
import { connect } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Admission, Tailscale } from "../src/admission.mjs";
import { Daemon } from "../src/server.mjs";

const SELF = {
  ips: ["100.64.0.1", "fd7a:115c:a1e0::1"],
  dnsName: "laptop.tail1234.ts.net",
  userId: 42,
  loginName: "alice@github",
};

/** Fake `tailscale whois` over a fixed table; records every lookup. */
function fakeTailscale(table) {
  const calls = [];
  return {
    calls,
    async whois(ip) {
      calls.push(ip);
      const found = table[ip];
      if (found === undefined) throw new Error(`no such peer ${ip}`);
      return { tags: [], node: "", ...found };
    },
  };
}

const PEERS = {
  "100.64.0.5": { userId: 42, loginName: "alice@github", node: "phone" },
  "100.64.0.6": { userId: 7, loginName: "mallory@github", node: "other-phone" },
  "100.64.0.7": { userId: 999, loginName: "tagged-devices", tags: ["tag:server"], node: "ci" },
};

function admission(tailscale, extra = {}) {
  return new Admission({ self: SELF, bindHost: "100.64.0.1", tailscale, ...extra });
}

function req(host, remoteAddress) {
  return { headers: { host }, socket: { remoteAddress } };
}

test("a Host that does not name this node is misdirected (421), before any whois", async () => {
  const ts = fakeTailscale(PEERS);
  const verdict = await admission(ts).check(req("evil.example", "100.64.0.5"));
  assert.equal(verdict.ok, false);
  assert.equal(verdict.status, 421);
  assert.match(verdict.error, /evil\.example/);
  assert.deepEqual(ts.calls, []);
});

test("the MagicDNS name with a port, any case, trailing dot, is this node", async () => {
  const a = admission(fakeTailscale(PEERS));
  assert.equal((await a.check(req("laptop.tail1234.ts.net:7390", "100.64.0.5"))).ok, true);
  assert.equal((await a.check(req("LAPTOP.tail1234.ts.net.:7390", "100.64.0.5"))).ok, true);
  assert.equal((await a.check(req("[fd7a:115c:a1e0::1]:7390", "100.64.0.5"))).ok, true);
});

test("a device of another tailnet user is forbidden (403)", async () => {
  const verdict = await admission(fakeTailscale(PEERS)).check(req("100.64.0.1:7390", "100.64.0.6"));
  assert.equal(verdict.status, 403);
  assert.match(verdict.error, /mallory@github/);
});

test("a tagged device has no user and is forbidden (403)", async () => {
  const verdict = await admission(fakeTailscale(PEERS)).check(req("100.64.0.1:7390", "100.64.0.7"));
  assert.equal(verdict.status, 403);
  assert.match(verdict.error, /tagged/);
});

test("a tagged device is forbidden even when whois reports this node's user id", async () => {
  const ts = fakeTailscale({ "100.64.0.8": { userId: 42, loginName: "alice@github", tags: ["tag:ci"] } });
  const verdict = await admission(ts).check(req("100.64.0.1", "100.64.0.8"));
  assert.equal(verdict.status, 403);
});

test("an address outside the tailnet (whois fails) is forbidden (403)", async () => {
  const verdict = await admission(fakeTailscale(PEERS)).check(req("100.64.0.1", "192.168.1.20"));
  assert.equal(verdict.status, 403);
});

test("a device of the same user is admitted", async () => {
  const verdict = await admission(fakeTailscale(PEERS)).check(req("100.64.0.1:7390", "100.64.0.5"));
  assert.deepEqual(verdict, { ok: true, ip: "100.64.0.5", user: "alice@github" });
});

test("this node's own Tailscale IP is admitted without a whois", async () => {
  const ts = fakeTailscale({});
  const verdict = await admission(ts).check(req("100.64.0.1:7390", "100.64.0.1"));
  assert.equal(verdict.ok, true);
  assert.deepEqual(ts.calls, []);
});

test("whois answers are cached per address: two checks, one lookup", async () => {
  const ts = fakeTailscale(PEERS);
  const a = admission(ts);
  assert.equal((await a.check(req("100.64.0.1", "100.64.0.5"))).ok, true);
  assert.equal((await a.check(req("100.64.0.1", "100.64.0.5"))).ok, true);
  assert.deepEqual(ts.calls, ["100.64.0.5"]);
});

test("cached identities live 60 s; failures only 5 s", async () => {
  let now = 1_000_000;
  const table = {};
  const ts = fakeTailscale(table);
  const a = admission(ts, { now: () => now });
  assert.equal((await a.check(req("100.64.0.1", "100.64.0.5"))).status, 403);
  // The peer appears: the failure is remembered briefly, then retried.
  table["100.64.0.5"] = PEERS["100.64.0.5"];
  now += 4_000;
  assert.equal((await a.check(req("100.64.0.1", "100.64.0.5"))).status, 403);
  now += 2_000;
  assert.equal((await a.check(req("100.64.0.1", "100.64.0.5"))).ok, true);
  assert.equal(ts.calls.length, 2);
  // The peer changes owner: the identity stays cached for 60 s.
  table["100.64.0.5"] = PEERS["100.64.0.6"];
  now += 59_000;
  assert.equal((await a.check(req("100.64.0.1", "100.64.0.5"))).ok, true);
  now += 2_000;
  assert.equal((await a.check(req("100.64.0.1", "100.64.0.5"))).status, 403);
  assert.equal(ts.calls.length, 3);
});

test("an IPv4-mapped IPv6 source is normalized before whois and the own-IP check", async () => {
  const ts = fakeTailscale(PEERS);
  const a = admission(ts);
  const verdict = await a.check(req("100.64.0.1", "::ffff:100.64.0.5"));
  assert.deepEqual(verdict, { ok: true, ip: "100.64.0.5", user: "alice@github" });
  assert.deepEqual(ts.calls, ["100.64.0.5"]);
  assert.equal((await a.check(req("100.64.0.1", "::ffff:100.64.0.1"))).ok, true);
  assert.deepEqual(ts.calls, ["100.64.0.5"]);
});

test("whois disabled keeps the Host check but admits any source", async () => {
  const ts = fakeTailscale({});
  const a = admission(ts, { whois: false });
  assert.equal((await a.check(req("100.64.0.1", "100.64.0.6"))).ok, true);
  assert.equal((await a.check(req("evil.example", "100.64.0.6"))).status, 421);
  assert.deepEqual(ts.calls, []);
});

test("Tailscale parses status and whois JSON from the CLI", async () => {
  const outputs = {
    "status --json": {
      BackendState: "Running",
      Self: { TailscaleIPs: ["100.68.0.2", "fd7a::2"], DNSName: "box.tail.ts.net.", UserID: 11 },
      User: { 11: { ID: 11, LoginName: "bob@github" } },
    },
    "whois --json 100.68.0.9": {
      Node: { Name: "ci.tail.ts.net.", User: 12, Tags: ["tag:ci"] },
      UserProfile: { ID: 12, LoginName: "tagged-devices" },
    },
  };
  const seen = [];
  const ts = new Tailscale({
    binary: "/opt/ts",
    run: async (binary, args) => {
      seen.push(binary);
      return JSON.stringify(outputs[args.join(" ")]);
    },
  });
  assert.deepEqual(await ts.status(), {
    ips: ["100.68.0.2", "fd7a::2"],
    dnsName: "box.tail.ts.net",
    userId: 11,
    loginName: "bob@github",
  });
  assert.deepEqual(await ts.whois("100.68.0.9"), {
    userId: 12,
    loginName: "tagged-devices",
    tags: ["tag:ci"],
    node: "ci.tail.ts.net",
  });
  assert.deepEqual(seen, ["/opt/ts", "/opt/ts"]);
});

test("on macOS a missing `tailscale` falls back to the app bundle binary", async () => {
  const seen = [];
  const ts = new Tailscale({
    platform: "darwin",
    run: async (binary) => {
      seen.push(binary);
      if (binary === "tailscale") throw Object.assign(new Error("not found"), { code: "ENOENT" });
      return JSON.stringify({ Self: { TailscaleIPs: [], UserID: 1 }, User: {} });
    },
  });
  await ts.status();
  await ts.status();
  assert.deepEqual(seen, ["tailscale", "/Applications/Tailscale.app/Contents/MacOS/Tailscale", "/Applications/Tailscale.app/Contents/MacOS/Tailscale"]);
});

/** Start a daemon on loopback with an injected admission whose self is 127.0.0.1. */
async function startDaemon(table) {
  const dir = mkdtempSync(join(tmpdir(), "omp-mobile-admission-"));
  const self = { ips: [], dnsName: "laptop.tail1234.ts.net", userId: 42, loginName: "alice@github" };
  const a = new Admission({ self, bindHost: "127.0.0.1", tailscale: fakeTailscale(table) });
  const daemon = new Daemon(
    { host: "127.0.0.1", port: 0, cwd: dir, registryFile: join(dir, "sessions.json") },
    "test-token-0123456789",
    { admission: a, user: "alice@github" },
  );
  await daemon.listen();
  const { port } = daemon.server.address();
  return {
    port,
    async stop() {
      await daemon.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

function rawRequest(port, text) {
  return new Promise((resolveRaw, reject) => {
    const socket = connect(port, "127.0.0.1", () => socket.write(text));
    let data = "";
    socket.on("data", (chunk) => (data += chunk));
    socket.on("close", () => resolveRaw(data));
    socket.on("error", reject);
  });
}

test("the daemon applies admission to /hello and reports the user", async () => {
  const daemon = await startDaemon({ "127.0.0.1": { userId: 42, loginName: "alice@github" } });
  try {
    const ok = await fetch(`http://127.0.0.1:${daemon.port}/hello`);
    assert.equal(ok.status, 200);
    const hello = await ok.json();
    assert.equal(hello.user, "alice@github");
    assert.equal(hello.protocol, 1);
    const reply = await rawRequest(daemon.port, "GET /hello HTTP/1.1\r\nHost: evil.example\r\nConnection: close\r\n\r\n");
    assert.match(reply, /^HTTP\/1\.1 421 /);
    assert.match(reply, /"error":"misdirected request/);
  } finally {
    await daemon.stop();
  }
});

test("the daemon refuses a WebSocket upgrade from another user with a status line, before the token", async () => {
  const daemon = await startDaemon({ "127.0.0.1": { userId: 7, loginName: "mallory@github" } });
  try {
    const reply = await rawRequest(
      daemon.port,
      "GET /sessions/x/ws?token=test-token-0123456789 HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n" +
        "Sec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n",
    );
    assert.equal(reply, "HTTP/1.1 403 Forbidden\r\n\r\n");
    const res = await fetch(`http://127.0.0.1:${daemon.port}/sessions`, {
      headers: { authorization: "Bearer test-token-0123456789" },
    });
    assert.equal(res.status, 403);
    assert.match((await res.json()).error, /mallory@github/);
  } finally {
    await daemon.stop();
  }
});
