import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isPairingLink, isTailnetHost, normalizeUrl, pairingMessage, parsePairing, readPairing } from "../src/pairing.ts";

const TOKEN = "0123456789abcdef0123456789abcdef0123456789abcdef";
/** The URI exactly as the daemon builds it. */
const pair = (url, token = TOKEN) => `omp-mobile://pair?url=${encodeURIComponent(url)}&token=${encodeURIComponent(token)}`;

describe("parsePairing", () => {
  it("reads a daemon pairing URI", () => {
    assert.deepEqual(parsePairing(pair("http://100.101.102.103:7390")), { url: "http://100.101.102.103:7390", token: TOKEN });
    // Surrounding whitespace from a paste is ignored; the host is lowercased.
    assert.deepEqual(parsePairing(`  ${pair("http://Studio.Tail1234.TS.NET:7390")}\n`), {
      url: "http://studio.tail1234.ts.net:7390",
      token: TOKEN,
    });
  });

  it("refuses a URI without a token", () => {
    assert.equal(parsePairing(`omp-mobile://pair?url=${encodeURIComponent("http://100.64.0.1:7390")}`), null);
    assert.equal(parsePairing(pair("http://100.64.0.1:7390", "")), null);
    assert.equal(readPairing(pair("http://100.64.0.1:7390", "  ")).problem, "missing-token");
  });

  it("refuses an address off the tailnet", () => {
    for (const url of ["http://192.168.1.20:7390", "http://127.0.0.1:7390", "http://example.com:7390", "http://evil.ts.net.example.com"]) {
      assert.equal(parsePairing(pair(url)), null, url);
    }
    const result = readPairing(pair("http://192.168.1.20:7390"));
    assert.deepEqual(result, { ok: false, problem: "not-tailnet", host: "192.168.1.20" });
    assert.match(pairingMessage(result.problem, result.host), /192\.168\.1\.20 is not on your tailnet/);
  });

  it("accepts a MagicDNS *.ts.net name, with or without a port", () => {
    assert.deepEqual(parsePairing(pair("https://studio.tail1234.ts.net")), { url: "https://studio.tail1234.ts.net", token: TOKEN });
    assert.deepEqual(parsePairing(pair("http://studio.tail1234.ts.net:7390/")), {
      url: "http://studio.tail1234.ts.net:7390",
      token: TOKEN,
    });
  });

  it("accepts 100.64.0.1, the bottom of 100.64.0.0/10", () => {
    assert.deepEqual(parsePairing(pair("http://100.64.0.1:7390")), { url: "http://100.64.0.1:7390", token: TOKEN });
    assert.ok(parsePairing(pair("http://100.127.255.254:7390")));
  });

  it("refuses 100.128.0.1, just past 100.64.0.0/10", () => {
    assert.equal(parsePairing(pair("http://100.128.0.1:7390")), null);
    assert.equal(parsePairing(pair("http://100.63.255.255:7390")), null);
  });

  it("refuses garbage", () => {
    for (const input of [
      "",
      "hello",
      "https://100.64.0.1:7390",
      "omp-mobile://pair",
      "omp-mobile://pair?",
      "omp-mobile://pairing?url=x&token=y",
      "kivotos://pair?url=http%3A%2F%2F100.64.0.1%3A7390",
      `omp-mobile://pair?url=%E0%A4%A&token=${TOKEN}`,
      pair("ftp://100.64.0.1:7390"),
      pair("http://100.64.0.1:7390/path"),
      pair("http://user:pass@100.64.0.1:7390"),
      pair("http://100.64.0.1:99999"),
      pair("http://100.064.0.1:7390"),
      pair("http://100.64.0.256:7390"),
      // Two addresses: which one would the phone trust?
      `${pair("http://100.64.0.1:7390")}&url=${encodeURIComponent("http://192.168.1.2:7390")}`,
    ]) {
      assert.equal(parsePairing(input), null, input);
    }
    assert.equal(readPairing("hello").problem, "not-pairing");
    assert.equal(readPairing(pair("http://100.64.0.1:7390/path")).problem, "bad-address");
  });
});

describe("isTailnetHost", () => {
  it("covers exactly 100.64.0.0/10 and *.ts.net", () => {
    assert.equal(isTailnetHost("100.64.0.0"), true);
    assert.equal(isTailnetHost("100.100.100.100"), true);
    assert.equal(isTailnetHost("100.127.255.255"), true);
    assert.equal(isTailnetHost("100.128.0.1"), false);
    assert.equal(isTailnetHost("100.63.0.1"), false);
    assert.equal(isTailnetHost("10.64.0.1"), false);
    assert.equal(isTailnetHost("box.tailnet.ts.net"), true);
    assert.equal(isTailnetHost("ts.net"), false);
    assert.equal(isTailnetHost("box.ts.net.evil.com"), false);
    assert.equal(isTailnetHost("-bad.ts.net"), false);
  });
});

describe("isPairingLink and normalizeUrl", () => {
  it("tells a pairing link from a typed address", () => {
    assert.equal(isPairingLink(" omp-mobile://pair?url=x"), true);
    assert.equal(isPairingLink("100.64.0.1:7390"), false);
    assert.equal(normalizeUrl("100.64.0.1:7390"), "http://100.64.0.1:7390");
    assert.equal(normalizeUrl("http://100.64.0.1:7390/"), "http://100.64.0.1:7390");
    assert.throws(() => normalizeUrl("http://100.64.0.1:7390/x"), /base address/);
  });
});
