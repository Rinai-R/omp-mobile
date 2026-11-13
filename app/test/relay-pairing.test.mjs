import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { keyFingerprint, pairingProof, parsePairingTicket } from "../src/relay/pairing.ts";

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
