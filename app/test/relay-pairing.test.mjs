import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { test } from "node:test";
import { keyFingerprint, loginWithAccount, pairingProof, parsePairingTicket } from "../src/relay/pairing.ts";

// The fixed vector ds-harness-remote publishes for every phone implementation.
const vector = JSON.parse(readFileSync(new URL("./fixtures/relay-pairing-proof.json", import.meta.url), "utf8"));

test("the mobile pairing proof matches the published vector", () => {
  const mobile = vector.vectors.find((item) => item.side === "mobile");
  assert.equal(
    pairingProof(vector.devicePrivateKey, vector.serverPublicKey, vector.sessionId, mobile.path, mobile.body),
    mobile.proof,
  );
});

test("the proof covers the exact body text, not its JSON value", () => {
  const mobile = vector.vectors.find((item) => item.side === "mobile");
  assert.notEqual(pairingProof(vector.devicePrivateKey, vector.serverPublicKey, vector.sessionId, mobile.path, "{ }"), mobile.proof);
});

test("a pairing code is read only in its exact form", () => {
  const ticket = "A".repeat(42) + "A";
  assert.deepEqual(parsePairingTicket(`https://dsh.r2049.cn/pair#v1.${ticket}`), { serverUrl: "https://dsh.r2049.cn", ticket });
  assert.deepEqual(parsePairingTicket(`http://127.0.0.1:8080/pair#v1.${ticket}`)?.serverUrl, "http://127.0.0.1:8080");
  for (const bad of [
    `http://dsh.r2049.cn/pair#v1.${ticket}`, // plain http on the internet
    `https://dsh.r2049.cn/pair?x=1#v1.${ticket}`,
    `https://user@dsh.r2049.cn/pair#v1.${ticket}`,
    `https://dsh.r2049.cn/pair/#v1.${ticket}`,
    `https://dsh.r2049.cn/pair#v2.${ticket}`,
    `https://dsh.r2049.cn/pair#v1.${ticket.slice(1)}`,
    // 43 characters whose last one carries bits a canonical encoding never sets.
    `https://dsh.r2049.cn/pair#v1.${"A".repeat(42)}B`,
    "omp-mobile://pair?url=http%3A%2F%2F100.64.0.1%3A7390&token=x",
  ]) {
    assert.equal(parsePairingTicket(bad), undefined, bad);
  }
});

test("a fingerprint is the lowercase hex SHA-256 of the key", () => {
  assert.match(keyFingerprint(vector.devicePublicKey), /^[0-9a-f]{64}$/);
});

test("account login registers the phone with the account bearer token", async (t) => {
  const account = "user@example.test";
  const token = "account-token-123456";
  const tokens = {
    accessToken: "device-access-123456",
    accessTokenExpiresAt: 1000,
    refreshToken: "device-refresh-123456",
    refreshTokenExpiresAt: 2000,
  };
  const phone = { deviceId: "phone", name: "Phone", publicKey: "public", privateKey: "private" };
  const fetchMock = t.mock.method(globalThis, "fetch", async (url, options) => {
    const body = JSON.parse(options.body);
    if (url.endsWith("/api/v1/auth/login")) {
      assert.deepEqual(body, { email: account, password: "test-password" });
      return Response.json({ account, token });
    }
    assert.equal(url, "https://relay.example.test/api/v1/devices/register");
    assert.equal(new Headers(options.headers).get("authorization"), `Bearer ${token}`);
    assert.equal(new Headers(options.headers).get("x-dsh-pairing-proof"), null);
    assert.deepEqual(body, {
      v: 1,
      device: { deviceId: "phone", name: "Phone", role: "client", platform: "android", identityKey: "public", clientVersion: "0.8.2" },
    });
    // The flat shape apps/server sends, and the only one the schema accepts.
    return Response.json(tokens);
  });

  assert.deepEqual(
    await loginWithAccount("https://relay.example.test", ` ${account} `, "test-password", phone, "0.8.2"),
    { account, tokens },
  );
  assert.equal(fetchMock.mock.callCount(), 2);
});

test("a rejected relay account login surfaces the error without registering or saving the phone", async (t) => {
  const unexpected = '() => { throw new Error("A rejected login must not touch relay storage or open a tunnel"); }';
  const appModules = {
    "./hosts": ["phoneFor", "relayHosts", "saveAccountToken", "saveCredentials", "saveLogin", "savedRelayAccount"],
    "./tunnel": ["relayFetch"],
  };
  const pairUrl = new URL("../src/relay/pair.ts", import.meta.url).href;
  // Load the real App login entry point with its native dependencies stubbed.
  const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
      if (context.parentURL !== pairUrl) return nextResolve(specifier, context);
      if (Object.hasOwn(appModules, specifier)) {
        const source = appModules[specifier].map((name) => `export const ${name} = ${unexpected};`).join("\n");
        return { url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true };
      }
      if (specifier === "../../app.json") {
        return { url: "data:text/javascript,export default {};", shortCircuit: true };
      }
      return nextResolve(["\./account", "\./pairing", "\./server"].includes(specifier) ? `${specifier}.ts` : specifier, context);
    },
  });
  t.after(() => hooks.deregister());

  const fetchMock = t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(url, "https://relay.example.test/api/v1/auth/login");
    assert.equal(options.method, "POST");
    return Response.json({ error: { code: "AUTH_INVALID", message: "Invalid account or password" } }, { status: 401 });
  });

  const { loginRelay } = await import("../src/relay/pair.ts");
  await assert.rejects(
    loginRelay("https://relay.example.test", "user@example.test", "wrong-password", []),
    { name: "PairingError", code: "AUTH_INVALID", message: "Invalid account or password" },
  );
  assert.equal(fetchMock.mock.callCount(), 1);
});
