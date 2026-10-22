import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { linkText, probeMachine, reasonText, summaryOf } from "../src/probe.ts";

const MACHINE = { url: "http://100.64.0.1:7390", token: "secret" };
const HELLO = { name: "studio", os: "darwin", version: "0.1.0", protocol: 1, sessionCount: 2, cwd: "/work" };
const realFetch = globalThis.fetch;

function reply(status, body) {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Stub fetch with one handler per path; records each call. */
function stub(routes) {
  const calls = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    calls.push({ path: url.pathname, init });
    const route = routes[url.pathname];
    if (route === undefined) throw new Error(`unexpected ${url.pathname}`);
    return route(init);
  };
  return calls;
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("probeMachine", () => {
  it("is online with the session count, the running ones and the hello's name", async () => {
    let clock = 1_000;
    const calls = stub({
      "/hello": () => {
        clock += 34;
        return reply(200, HELLO);
      },
      "/sessions": () =>
        reply(200, {
          sessions: [
            { id: "a", status: "streaming" },
            { id: "b", status: "idle" },
          ],
        }),
    });
    const probe = await probeMachine(MACHINE, { now: () => clock });
    assert.deepEqual(probe, {
      state: "online",
      latencyMs: 34,
      sessionCount: 2,
      running: 1,
      name: "studio",
      version: "0.1.0",
    });
    assert.deepEqual(
      calls.map((call) => call.path),
      ["/hello", "/sessions"],
    );
    // /hello is public; /sessions carries the token.
    assert.equal(calls[0].init.headers?.authorization, undefined);
    assert.equal(calls[1].init.headers.authorization, "Bearer secret");
  });

  it("is a timeout when fetch rejects with an AbortError", async () => {
    stub({
      "/hello": () => {
        throw new DOMException("The operation was aborted.", "AbortError");
      },
    });
    assert.deepEqual(await probeMachine(MACHINE), { state: "unreachable", reason: "timeout" });
  });

  it("aborts a hello that never answers after the timeout", async () => {
    stub({
      "/hello": (init) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener("abort", () => reject(new Error("aborted by signal")));
        }),
    });
    const started = Date.now();
    assert.deepEqual(await probeMachine(MACHINE, { timeoutMs: 30 }), { state: "unreachable", reason: "timeout" });
    assert.ok(Date.now() - started < 2_000);
  });

  it("is unauthorized when /sessions answers 401", async () => {
    stub({ "/hello": () => reply(200, HELLO), "/sessions": () => reply(401, { error: "unauthorized" }) });
    assert.deepEqual(await probeMachine(MACHINE), { state: "unreachable", reason: "unauthorized" });
  });

  it("is not-omp when /hello answers another shape or protocol", async () => {
    for (const body of [{ hello: "world" }, { ...HELLO, protocol: 2 }, "<html>nginx</html>"]) {
      const calls = stub({ "/hello": () => reply(200, body), "/sessions": () => reply(200, { sessions: [] }) });
      assert.deepEqual(await probeMachine(MACHINE), { state: "unreachable", reason: "not-omp" }, JSON.stringify(body));
      // The token is not sent to something that is not the daemon.
      assert.equal(calls.length, 1);
    }
  });

  it("is not-omp when /hello is not 200", async () => {
    stub({ "/hello": () => reply(404, "not found") });
    assert.deepEqual(await probeMachine(MACHINE), { state: "unreachable", reason: "not-omp" });
  });

  it("is network when fetch throws otherwise", async () => {
    stub({
      "/hello": () => {
        throw new TypeError("Network request failed");
      },
    });
    assert.deepEqual(await probeMachine(MACHINE), { state: "unreachable", reason: "network" });
  });
});

describe("summaryOf", () => {
  const NOW = 10 * 60 * 60_000;
  const online = { state: "online", latencyMs: 34, sessionCount: 2, running: 0, name: "s", version: "0.1.0" };

  it("says Checking… before the first probe", () => {
    assert.deepEqual(summaryOf(undefined, NOW - 1_000, NOW), { dot: "checking", text: "Checking…" });
  });

  it("names the link and the sessions when online", () => {
    assert.deepEqual(summaryOf(online, NOW, NOW), { dot: "online", text: "Tailscale · 2 sessions" });
    assert.equal(summaryOf({ ...online, sessionCount: 1 }, undefined, NOW).text, "Tailscale · 1 session");
    assert.equal(summaryOf({ ...online, sessionCount: 0 }, undefined, NOW).text, "Tailscale · no sessions");
  });

  it("prefers running sessions over the count", () => {
    assert.equal(summaryOf({ ...online, running: 1 }, undefined, NOW).text, "Tailscale · 1 running");
  });

  it("says why it is unreachable and when it was last seen", () => {
    const down = { state: "unreachable", reason: "timeout" };
    assert.deepEqual(summaryOf(down, NOW - 5 * 60_000, NOW), { dot: "down", text: "No reply · seen 5 min ago" });
    assert.equal(summaryOf(down, NOW - 10_000, NOW).text, "No reply · seen just now");
    assert.equal(summaryOf(down, NOW - 3 * 60 * 60_000, NOW).text, "No reply · seen 3 h ago");
    assert.equal(summaryOf({ state: "unreachable", reason: "network" }, undefined, NOW).text, "Off tailnet");
  });

  it("has a word for every reason", () => {
    assert.equal(reasonText("timeout"), "No reply");
    assert.equal(reasonText("unauthorized"), "Token rejected");
    assert.equal(reasonText("not-omp"), "Not omp-mobile");
    assert.equal(reasonText("network"), "Off tailnet");
  });

  it("gives the sheet's link line", () => {
    assert.equal(linkText(online), "Online · 34 ms");
    assert.equal(linkText({ state: "unreachable", reason: "timeout" }), "Unreachable: No reply");
    assert.equal(linkText(undefined), "Checking…");
  });
});
