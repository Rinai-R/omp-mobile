import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { RpcSession, compactModel } from "../src/rpc-session.mjs";
import { Daemon, blobType } from "../src/server.mjs";

const fake = `#!${process.execPath}
const readline = require("node:readline");
const lines = readline.createInterface({ input: process.stdin });
const send = (value) => process.stdout.write(JSON.stringify(value) + "\\n");
send({ type: "ready", protocolVersion: 1, supportedProtocolVersions: [1, 2] });
let model = { provider: "fake", id: "fake-1", name: "Fake One" };
lines.on("line", (line) => {
  const command = JSON.parse(line);
  if (command.type === "get_available_models") {
    send({ id: command.id, type: "response", command: command.type, success: true, data: { models: [{
      provider: "fake", id: "fake-1", name: "Fake One", reasoning: true, input: ["text", "image"],
      contextWindow: 200000, cost: { input: 1, output: 2 },
      thinking: { mode: "effort", efforts: ["low", "high"] }, baseUrl: "https://example.invalid", compat: { huge: true },
    }] } });
  } else if (command.type === "set_model") {
    if (command.provider !== "fake" || command.modelId !== "fake-2") {
      send({ id: command.id, type: "response", command: command.type, success: false, error: "Model not found: " + command.provider + "/" + command.modelId });
    } else {
      model = { provider: "fake", id: "fake-2", name: "Fake Two" };
      send({ id: command.id, type: "response", command: command.type, success: true, data: model });
    }
  } else if (command.type === "get_available_thinking_levels") {
    send({ id: command.id, type: "response", command: command.type, success: true, data: { levels: ["off", "low", "high"] } });
  } else if (command.type === "set_thinking_level") {
    send({ id: command.id, type: "response", command: command.type, success: true, data: { level: command.level } });
  } else if (command.type === "get_state") {
    send({ id: command.id, type: "response", command: command.type, success: true, data: { sessionId: "s", model, thinkingLevel: "low" } });
  }
});
`;

function fakeOmp() {
  const dir = mkdtempSync(join(tmpdir(), "omp-mobile-models-"));
  const path = join(dir, "omp");
  writeFileSync(path, fake, { mode: 0o755 });
  chmodSync(path, 0o755);
  return path;
}

test("the model catalog is cut to what the phone lists", () => {
  const compact = compactModel({
    provider: "fake",
    id: "fake-1",
    name: "Fake One",
    reasoning: true,
    input: ["text", "image", 7],
    contextWindow: 200000,
    cost: { input: 1, output: 2, cacheRead: 0 },
    thinking: { mode: "effort", efforts: ["low", "high", 3] },
    baseUrl: "https://example.invalid",
    compat: { huge: true },
  });
  assert.deepEqual(compact, {
    provider: "fake",
    id: "fake-1",
    name: "Fake One",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 200000,
    cost: { input: 1, output: 2 },
    efforts: ["low", "high"],
  });
  assert.deepEqual(compactModel({ id: "only-id" }), {
    provider: "",
    id: "only-id",
    name: "only-id",
    reasoning: false,
    input: [],
    contextWindow: undefined,
    cost: undefined,
    efforts: undefined,
  });
});

test("RPC carries the catalog, the switch and the thinking levels", async () => {
  const rpc = new RpcSession({ cwd: tmpdir(), ompBin: fakeOmp() });
  await rpc.start();
  const models = await rpc.availableModels();
  assert.equal(models.length, 1);
  assert.equal(models[0].name, "Fake One");
  assert.equal(models[0].baseUrl, undefined);
  assert.deepEqual(await rpc.availableThinkingLevels(), { levels: ["off", "low", "high"] });
  const state = await rpc.setModel("fake", "fake-2");
  assert.equal(state.model.id, "fake-2");
  await assert.rejects(rpc.setModel("fake", "missing"), /Model not found/);
  assert.equal((await rpc.setThinkingLevel("high")).thinkingLevel, "low");
  rpc.close();
});

/** A daemon with no listener, for driving single socket frames. */
function daemon() {
  const dir = mkdtempSync(join(tmpdir(), "omp-mobile-daemon-"));
  return new Daemon({ registryFile: join(dir, "sessions.json"), ompHome: dir }, "secret");
}

function harness(rpc) {
  const frames = [];
  const broadcasts = [];
  const entry = {
    rpc,
    state: { model: { provider: "fake", id: "fake-1" }, thinkingLevel: "low" },
    updatedAt: 0,
    broadcast: (payload) => broadcasts.push(payload),
  };
  const ws = { send: (text) => frames.push(JSON.parse(text)) };
  return { entry, ws, frames, broadcasts };
}

test("the socket answers models and thinking levels, and applies a switch", async () => {
  const fakeRpc = {
    availableModels: async () => [{ provider: "fake", id: "fake-1", name: "Fake One", reasoning: true, input: ["text"] }],
    availableThinkingLevels: async () => ({ levels: ["off", "low"] }),
    setModel: async (provider, modelId) => ({ model: { provider, id: modelId }, thinkingLevel: "low" }),
    setThinkingLevel: async (level) => ({ model: { provider: "fake", id: "fake-1" }, thinkingLevel: level }),
  };
  const server = daemon();
  const { entry, ws, frames, broadcasts } = harness(fakeRpc);
  await server.handleClientMessage(entry, ws, JSON.stringify({ type: "models" }));
  await server.handleClientMessage(entry, ws, JSON.stringify({ type: "thinking_levels" }));
  assert.equal(frames[0].type, "models");
  assert.equal(frames[0].models[0].name, "Fake One");
  assert.deepEqual(frames[1], { type: "thinking_levels", levels: ["off", "low"], current: "low" });

  await server.handleClientMessage(entry, ws, JSON.stringify({ type: "set_model", provider: "fake", modelId: "fake-2" }));
  assert.deepEqual(frames[2], { type: "accepted", command: "set_model" });
  assert.equal(entry.state.model.id, "fake-2");
  assert.equal(broadcasts[0].type, "state");

  await server.handleClientMessage(entry, ws, JSON.stringify({ type: "set_thinking_level", level: "high" }));
  assert.deepEqual(frames[3], { type: "accepted", command: "set_thinking_level" });
  assert.equal(entry.state.thinkingLevel, "high");
  assert.equal(broadcasts[1].type, "state");
});

test("a bad switch answers an error frame and leaves the state alone", async () => {
  const fakeRpc = { setModel: async () => Promise.reject(new Error("Model not found: fake/nope")) };
  const server = daemon();
  const { entry, ws, frames } = harness(fakeRpc);
  await server.handleClientMessage(entry, ws, JSON.stringify({ type: "set_model", provider: "fake" }));
  assert.equal(frames[0].type, "error");
  assert.match(frames[0].error, /provider and modelId/);
  await server.handleClientMessage(entry, ws, JSON.stringify({ type: "set_model", provider: "fake", modelId: "nope" }));
  assert.equal(frames[1].error, "Model not found: fake/nope");
  assert.equal(entry.state.model.id, "fake-1");
});

test("blob content type comes from the bytes, not a name", () => {
  assert.equal(blobType(Buffer.from("RIFF\x00\x00\x00\x00WEBPVP8 ", "binary")), "image/webp");
  assert.equal(blobType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), "image/png");
  assert.equal(blobType(Buffer.from([0xff, 0xd8, 0xff, 0xe0])), "image/jpeg");
  assert.equal(blobType(Buffer.from("GIF89a")), "image/gif");
  assert.equal(blobType(Buffer.from("plain text")), "application/octet-stream");
});
