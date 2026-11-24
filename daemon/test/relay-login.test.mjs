/**
 * Account login and logout against a fake self-hosted relay.
 *
 * These cover the paths the reviewer asked for: login storing account
 * credentials, logout revoking on the server, and — the case logout exists for —
 * logout finishing locally when the relay is gone.
 */
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { RelayHost } from "../src/relay.mjs";
import { Daemon } from "../src/server.mjs";

const TOKEN = "l".repeat(48);

/** A fake apps/server: account login, device register, self revoke, memberships. */
async function fakeRelay({ password = "right-password", revokeRefuses = false } = {}) {
  const seen = { logins: 0, registers: 0, revokes: 0, lastLogin: undefined, codeRegisters: [] };
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      const send = (code, obj) => {
        res.writeHead(code, { "content-type": "application/json" });
        res.end(JSON.stringify(obj));
      };
      if (req.url === "/api/v1/auth/login") {
        seen.logins += 1;
        seen.lastLogin = JSON.parse(body || "{}");
        if (seen.lastLogin.password !== password) {
          send(401, { error: { code: "INVALID_CREDENTIALS", message: "wrong password" } });
          return;
        }
        send(200, { token: "account-token-1234567890", account: seen.lastLogin.email, expiresAt: Date.now() + 3_600_000, isAdmin: false });
        return;
      }
      if (req.url === "/api/v1/devices/register") {
        seen.registers += 1;
        send(200, {
          accessToken: "device-access-1234567890",
          accessTokenExpiresAt: Date.now() + 3_600_000,
          refreshToken: "device-refresh-1234567890",
          refreshTokenExpiresAt: Date.now() + 3_600_000,
        });
        return;
      }
      if (req.url === "/api/v1/devices/register-with-code") {
        const request = JSON.parse(body || "{}");
        seen.codeRegisters.push(request);
        if (request.code !== "K7QM-4XPA") {
          send(409, { error: { code: "HOST_REGISTRATION_CODE_CONSUMED", message: "code already used", retryable: false } });
          return;
        }
        send(200, {
          accessToken: "device-access-1234567890",
          accessTokenExpiresAt: Date.now() + 3_600_000,
          refreshToken: "device-refresh-1234567890",
          refreshTokenExpiresAt: Date.now() + 3_600_000,
        });
        return;
      }
      if (req.url === "/api/v1/devices/self") {
        seen.revokes += 1;
        if (revokeRefuses) {
          send(409, { error: { code: "DEVICE_REVOKED", message: "unknown device" } });
          return;
        }
        send(200, { ok: true });
        return;
      }
      if (req.url.startsWith("/api/v1/device-memberships")) {
        send(200, { items: [] });
        return;
      }
      send(404, { error: { code: "NOT_FOUND", message: req.url } });
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    seen,
    url: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

async function hostOn(relay) {
  const dir = mkdtempSync(join(tmpdir(), "omp-relay-login-"));
  const host = new RelayHost({
    serverUrl: relay.url,
    dir,
    name: "test host",
    version: "0.0.0",
    port: () => 1,
    token: TOKEN,
    log: () => undefined,
  });
  await host.start();
  return { host, dir };
}

test("login stores account credentials owner-only, with no password in the file", async () => {
  const relay = await fakeRelay();
  const { host, dir } = await hostOn(relay);
  try {
    await host.login("user@example.com", "right-password");
    assert.equal(relay.seen.logins, 1);
    assert.equal(relay.seen.registers, 1);
    assert.equal((await host.storedAccount()), "user@example.com");

    const file = join(dir, "server-credentials.json");
    assert.ok(existsSync(file));
    const written = readFileSync(file, "utf8");
    assert.equal((await import("node:fs")).statSync(file).mode & 0o777, 0o600);
    assert.ok(!written.includes("right-password"), "the password must not be stored");
    assert.equal(JSON.parse(written).authorizationMethod, "account");
  } finally {
    await host.close();
    await relay.close();
  }
});

test("a wrong password fails, and nothing is stored", async () => {
  const relay = await fakeRelay();
  const { host, dir } = await hostOn(relay);
  try {
    await assert.rejects(host.login("user@example.com", "wrong-password"));
    assert.equal(relay.seen.registers, 0, "register must not run after a refused login");
    assert.equal(await host.storedAccount(), undefined);
    assert.equal(existsSync(join(dir, "server-credentials.json")), false);
  } finally {
    await host.close();
    await relay.close();
  }
});

test("logout revokes the device on the server and drops the tokens", async () => {
  const relay = await fakeRelay();
  const { host, dir } = await hostOn(relay);
  try {
    await host.login("user@example.com", "right-password");
    assert.equal(await host.storedAccount(), "user@example.com");

    await host.logout();
    assert.equal(relay.seen.revokes, 1);
    assert.equal(await host.storedAccount(), undefined);
    assert.equal(existsSync(join(dir, "server-credentials.json")), false);
  } finally {
    await host.close();
    await relay.close();
  }
});

test("logout still drops the tokens when the relay is gone", async () => {
  const relay = await fakeRelay();
  const { host, dir } = await hostOn(relay);
  // Sign in while the server is up, then take it away: this is the case logout exists for.
  await host.login("user@example.com", "right-password");
  await relay.close();

  await host.logout();
  assert.equal(await host.storedAccount(), undefined);
  assert.equal(existsSync(join(dir, "server-credentials.json")), false);
  await host.close();
});

test("logout still drops the tokens when the server refuses the revoke", async () => {
  const relay = await fakeRelay({ revokeRefuses: true });
  const { host, dir } = await hostOn(relay);
  try {
    await host.login("user@example.com", "right-password");
    assert.equal(await host.storedAccount(), "user@example.com");

    await host.logout();
    assert.equal(relay.seen.revokes, 1);
    assert.equal(await host.storedAccount(), undefined);
    assert.equal(existsSync(join(dir, "server-credentials.json")), false);
  } finally {
    await host.close();
    await relay.close();
  }
});

test("storedAccount ignores an unreadable credential file instead of throwing", async () => {
  const relay = await fakeRelay();
  const { host, dir } = await hostOn(relay);
  try {
    writeFileSync(join(dir, "server-credentials.json"), JSON.stringify({ schemaVersion: 1 }), { mode: 0o644 });
    assert.equal(await host.storedAccount(), undefined);
  } finally {
    await host.close();
    await relay.close();
  }
});


/**
 * The endpoint is what `omp-mobile relay logout` and `/mobile logout` call, and
 * the reviewer's point: it must not ask the server anything before clearing the
 * tokens, or it fails exactly when it is needed.
 */
async function daemonPointingAt(relayUrl, dir) {
  const daemon = new Daemon(
    { host: "127.0.0.1", port: 0, cwd: dir, registryFile: join(dir, "sessions.json"), relay: relayUrl, relayDir: join(dir, "relay") },
    TOKEN,
  );
  await daemon.listen();
  return daemon;
}

function callLogout(daemon) {
  return fetch(`http://127.0.0.1:${daemon.server.address().port}/relay/logout`, {
    method: "POST",
    headers: { authorization: `Bearer ${TOKEN}` },
  });
}

test("POST /relay/logout clears the tokens even with the relay unreachable", async () => {
  const relay = await fakeRelay();
  const dir = mkdtempSync(join(tmpdir(), "omp-relay-endpoint-"));
  const daemon = await daemonPointingAt(relay.url, dir);
  try {
    await daemon.relay.login("user@example.com", "right-password");
    assert.equal(await daemon.relay.storedAccount(), "user@example.com");

    // The relay goes away: this is when logout has to still work.
    await relay.close();
    const response = await callLogout(daemon);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.account, "user@example.com");
    assert.equal(await daemon.relay.storedAccount(), undefined);
    assert.equal(existsSync(join(dir, "relay", "server-credentials.json")), false);
  } finally {
    await daemon.close();
  }
});

test("POST /relay/logout answers 409 when only anonymous pairing exists", async () => {
  const relay = await fakeRelay();
  const dir = mkdtempSync(join(tmpdir(), "omp-relay-nologin-"));
  const daemon = await daemonPointingAt(relay.url, dir);
  try {
    const response = await callLogout(daemon);
    assert.equal(response.status, 409);
    assert.match((await response.json()).error, /not signed in to a relay account/);
  } finally {
    await daemon.close();
    await relay.close();
  }
});


test("GET /relay cannot answer when the relay is down, which is why logout must not ask it", async () => {
  const relay = await fakeRelay();
  const dir = mkdtempSync(join(tmpdir(), "omp-relay-getrelay-"));
  const daemon = await daemonPointingAt(relay.url, dir);
  try {
    await daemon.relay.login("user@example.com", "right-password");
    await relay.close();
    // This is the reported failure: the pre-check itself errors, so a logout that
    // needed it would never reach the code that clears the tokens.
    const response = await fetch(`http://127.0.0.1:${daemon.server.address().port}/relay`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    assert.equal(response.status, 502);
    // And the tokens are still there, so the daemon still has something to end.
    assert.equal(await daemon.relay.storedAccount(), "user@example.com");
  } finally {
    await daemon.close();
  }
});


function relayPost(daemon, path, body) {
  return fetch(`http://127.0.0.1:${daemon.server.address().port}${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("a daemon started without the relay turns it on and joins the phone's account with its code", async () => {
  const relay = await fakeRelay();
  const dir = mkdtempSync(join(tmpdir(), "omp-relay-code-"));
  const daemon = await daemonPointingAt(undefined, dir);
  try {
    assert.equal((await relayPost(daemon, "/relay/login", { code: "K7QM-4XPA" })).status, 409, "no relay yet");
    const enabled = await relayPost(daemon, "/relay/enable", { server: relay.url });
    assert.equal(enabled.status, 200);
    // Typed the way people do: lower case, no dash.
    const joined = await relayPost(daemon, "/relay/login", { code: "k7qm4xpa" });
    assert.equal(joined.status, 200);
    assert.equal(relay.seen.codeRegisters.length, 1);
    assert.equal(relay.seen.codeRegisters[0].code, "K7QM-4XPA");
    assert.equal(relay.seen.codeRegisters[0].device.role, "host");
    assert.equal(relay.seen.logins, 0, "no password login");
    // Joined with a code is an account sign-in too: logout can end it.
    assert.equal((await callLogout(daemon)).status, 200);
    assert.equal(existsSync(join(dir, "relay", "server-credentials.json")), false);
  } finally {
    await daemon.close();
    await relay.close();
  }
});

test("enabling a second, different relay is refused; the same one again is a no-op", async () => {
  const relay = await fakeRelay();
  const dir = mkdtempSync(join(tmpdir(), "omp-relay-enable-"));
  const daemon = await daemonPointingAt(relay.url, dir);
  try {
    assert.equal((await relayPost(daemon, "/relay/enable", { server: `${relay.url}/` })).status, 200);
    const other = await relayPost(daemon, "/relay/enable", { server: "https://relay.example.com" });
    assert.equal(other.status, 409);
    assert.match((await other.json()).error, /already serves/);
  } finally {
    await daemon.close();
    await relay.close();
  }
});

test("a refused code passes the relay's reason on and stores nothing", async () => {
  const relay = await fakeRelay();
  const dir = mkdtempSync(join(tmpdir(), "omp-relay-badcode-"));
  const daemon = await daemonPointingAt(relay.url, dir);
  try {
    const response = await relayPost(daemon, "/relay/login", { code: "ZZZZ-9999" });
    assert.equal(response.status, 502);
    assert.equal((await response.json()).code, "HOST_REGISTRATION_CODE_CONSUMED");
    assert.equal(await daemon.relay.storedAccount(), undefined);
    assert.equal((await relayPost(daemon, "/relay/login", { code: "nope" })).status, 400);
  } finally {
    await daemon.close();
    await relay.close();
  }
});
