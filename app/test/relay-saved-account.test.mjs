import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";

function mockRelayStorage(t) {
  const storage = new Map();
  const storageModule = "data:text/javascript," + encodeURIComponent(`
    export default {
      getItem: (...args) => globalThis.__relayTestStorage.getItem(...args),
      setItem: (...args) => globalThis.__relayTestStorage.setItem(...args),
    };
  `);
  globalThis.__relayTestStorage = {
    async getItem(key) { return storage.get(key) ?? null; },
    async setItem(key, value) { storage.set(key, value); },
  };
  t.after(() => { delete globalThis.__relayTestStorage; });
  const hooks = registerHooks({
    resolve(specifier, context, next) {
      if (specifier === "@react-native-async-storage/async-storage") return { url: storageModule, shortCircuit: true };
      if (specifier === "./connection" && context.parentURL.includes("/relay/hosts.ts")) {
        return { url: "data:text/javascript,export class RelayConnection {}", shortCircuit: true };
      }
      if (context.parentURL?.endsWith("/relay/pair.ts")) {
        if (specifier === "./tunnel") return { url: "data:text/javascript,export const relayFetch = null", shortCircuit: true };
        if (specifier === "../../app.json") return { url: "data:text/javascript,export default { expo: { version: '0.8.4' } }", shortCircuit: true };
        if (["./hosts", "./pairing", "./selection", "./server"].includes(specifier)) return next(`${specifier}.ts`, context);
      }
      if (specifier === "./server" && context.parentURL.includes("/relay/hosts.ts")) return next("./server.ts", context);
      return next(specifier, context);
    },
  });
  t.after(() => hooks.deregister());
  return storage;
}

test("saved account discovery refreshes credentials, survives reload and preserves them on failures", async (t) => {
  const storage = mockRelayStorage(t);
  const { saveLogin, saveCredentials, savedAccountRelays, relayHosts } = await import("../src/relay/hosts.ts");
  const phone = { deviceId: "saved-phone", name: "Phone", publicKey: "public", privateKey: "private" };
  const tokens = {
    accessToken: "old-access-token-123456",
    accessTokenExpiresAt: 1,
    refreshToken: "refresh-token-123456",
    refreshTokenExpiresAt: Date.now() + 86400000,
  };
  await saveLogin("https://account.test", phone, { account: "user@example.test", tokens });
  await saveCredentials("https://anonymous.test", phone, { account: "anonymous", tokens });
  assert.deepEqual(await savedAccountRelays([]), [{ serverUrl: "https://account.test", account: "user@example.test" }]);
  const renewed = { ...tokens, accessToken: "new-access-token-123456", accessTokenExpiresAt: Date.now() + 3600000 };
  const host = { deviceId: "new-host", name: "Computer B", platform: "linux", role: "host", membershipId: "membership", online: true };
  const requests = [];
  const fetchMock = t.mock.method(globalThis, "fetch", async (url, options) => {
    requests.push(url);
    if (url.endsWith("/api/v1/auth/refresh")) {
      assert.deepEqual(JSON.parse(options.body), { deviceId: phone.deviceId, refreshToken: tokens.refreshToken });
      return Response.json(renewed);
    }
    assert.equal(url, "https://account.test/api/v1/devices");
    assert.equal(options.headers.authorization, "Bearer " + renewed.accessToken);
    return Response.json({ items: [host] });
  });
  assert.deepEqual(await relayHosts("https://account.test"), [host]);
  assert.equal(requests.length, 2);
  assert.equal(JSON.parse(storage.get("omp.relay.v1"))["https://account.test"].tokens.accessToken, renewed.accessToken);

  // A fresh module instance reads the persisted login after an App restart.
  const reloaded = await import("../src/relay/hosts.ts?restart");
  assert.deepEqual(await reloaded.savedAccountRelays([]), [{ serverUrl: "https://account.test", account: "user@example.test" }]);
  // An older account login has no method marker, but its machine carries the account.
  const legacyStore = JSON.parse(storage.get("omp.relay.v1"));
  delete legacyStore["https://account.test"].authorizationMethod;
  storage.set("omp.relay.v1", JSON.stringify(legacyStore));
  const legacy = await import("../src/relay/hosts.ts?legacy");
  assert.deepEqual(await legacy.savedAccountRelays([{
    relay: { serverUrl: "https://account.test", hostDeviceId: "existing-host", account: "user@example.test" },
  }]), [{ serverUrl: "https://account.test", account: "user@example.test" }]);
  assert.equal(JSON.parse(storage.get("omp.relay.v1"))["https://anonymous.test"].authorizationMethod, undefined);
  const saved = storage.get("omp.relay.v1");
  fetchMock.mock.mockImplementation(async () => { throw new TypeError("Network unavailable"); });
  await assert.rejects(reloaded.relayHosts("https://account.test"), /Network unavailable/);
  assert.equal(storage.get("omp.relay.v1"), saved);
  fetchMock.mock.mockImplementation(async () => Response.json({}, { status: 401 }));
  await assert.rejects(reloaded.relayHosts("https://account.test"), { name: "RemoteServerError", status: 401 });
  assert.equal(storage.get("omp.relay.v1"), saved);
  fetchMock.mock.mockImplementation(async (url) => Response.json({}, { status: url.endsWith("/auth/refresh") ? 404 : 401 }));
  await assert.rejects(reloaded.relayHosts("https://account.test"), { name: "RemoteServerError", status: 401 });
  assert.equal(storage.get("omp.relay.v1"), saved);
  fetchMock.mock.mockImplementation(async () => Response.json({ items: [host] }));
  assert.deepEqual(await reloaded.relayHosts("https://account.test"), [host]);
  assert.deepEqual(await reloaded.savedAccountRelays([]), [{ serverUrl: "https://account.test", account: "user@example.test" }]);
});

for (const rejected of [false, true]) {
  test(rejected ? "account login registers again after saved credentials return 401" : "account login reuses valid device credentials without registering again", async (t) => {
    const storage = mockRelayStorage(t);
    const { saveLogin } = await import("../src/relay/hosts.ts");
    const { loginRelay } = await import("../src/relay/pair.ts");
    const serverUrl = rejected ? "https://expired.test" : "https://valid.test";
    const account = "user@example.test";
    const phone = { deviceId: "saved-phone", name: "Phone", publicKey: "public", privateKey: "private" };
    const tokens = {
      accessToken: "saved-access-token-123456",
      accessTokenExpiresAt: Date.now() + 3600000,
      refreshToken: "saved-refresh-token-123456",
      refreshTokenExpiresAt: Date.now() + 86400000,
    };
    const replacement = { ...tokens, accessToken: "replacement-access-token-123456" };
    const host = { deviceId: "computer-b", name: "Computer B", platform: "linux", role: "host", membershipId: "membership", online: true };
    await saveLogin(serverUrl, phone, { account, tokens });

    const requests = [];
    t.mock.method(globalThis, "fetch", async (url, options) => {
      const path = new URL(url).pathname;
      requests.push(path);
      switch (path) {
        case "/api/v1/auth/login":
          return Response.json({ account, token: "account-token-123456" });
        case "/api/v1/auth/refresh":
          return Response.json({}, { status: 401 });
        case "/api/v1/devices/register":
          assert.equal(options.headers.authorization, "Bearer account-token-123456");
          assert.equal(JSON.parse(options.body).device.deviceId, phone.deviceId);
          return Response.json(replacement);
        case "/api/v1/devices":
          if (rejected && options.headers.authorization === `Bearer ${tokens.accessToken}`) {
            return Response.json({}, { status: 401 });
          }
          assert.equal(options.headers.authorization, `Bearer ${(rejected ? replacement : tokens).accessToken}`);
          return Response.json({ items: [host] });
        default:
          assert.fail(`Unexpected request: ${url}`);
      }
    });

    const result = await loginRelay(serverUrl, account, "test-password", []);
    assert.deepEqual(result.candidates.map(({ deviceId }) => deviceId), [host.deviceId]);
    assert.deepEqual(requests, rejected
      ? ["/api/v1/auth/login", "/api/v1/devices", "/api/v1/auth/refresh", "/api/v1/devices/register", "/api/v1/devices"]
      : ["/api/v1/auth/login", "/api/v1/devices"]);
    assert.deepEqual(JSON.parse(storage.get("omp.relay.v1"))[serverUrl].tokens, rejected ? replacement : tokens);
  });
}
