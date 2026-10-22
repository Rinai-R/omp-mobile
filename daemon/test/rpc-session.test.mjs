import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { RpcSession } from "../src/rpc-session.mjs";

const fake = `#!${process.execPath}
const readline = require("node:readline");
const lines = readline.createInterface({ input: process.stdin });
const send = (value) => process.stdout.write(JSON.stringify(value) + "\\n");
send({ type: "ready", protocolVersion: 1, supportedProtocolVersions: [1, 2] });
const state = {
  sessionId: "fake-session",
  sessionName: "Fake session",
  isStreaming: false,
  model: { provider: "fake", id: "fake-model", name: "Fake model" },
  sessionFile: "/tmp/fake.jsonl",
  systemPrompt: ["too large for a phone"],
  dumpTools: [{ name: "secret" }],
};
const messages = [{ role: "user", content: "hello" }];
lines.on("line", (line) => {
  const command = JSON.parse(line);
  if (command.type === "get_state") send({ id: command.id, type: "response", command: "get_state", success: true, data: state });
  else if (command.type === "get_messages") send({ id: command.id, type: "response", command: "get_messages", success: true, data: { messages } });
  else if (command.type === "prompt") {
    send({ id: command.id, type: "response", command: "prompt", success: true, data: { agentInvoked: true } });
    send({ type: "message_end", message: { role: "assistant", content: "Hello from fake" } });
  } else if (command.type === "abort") send({ id: command.id, type: "response", command: "abort", success: true });
  else if (command.type === "extension_ui_response") send({ type: "notice", level: "info", message: "approved" });
});
`;

function fakeOmp() {
  const dir = mkdtempSync(join(tmpdir(), "omp-mobile-test-"));
  const path = join(dir, "omp");
  writeFileSync(path, fake, { mode: 0o755 });
  chmodSync(path, 0o755);
  return path;
}

test("starts, hydrates a session, strips the system prompt, and streams events", async () => {
  const rpc = new RpcSession({ cwd: tmpdir(), ompBin: fakeOmp() });
  const events = [];
  rpc.on("event", (event) => events.push(event));
  await rpc.start();
  const state = await rpc.getState();
  assert.equal(state.sessionId, "fake-session");
  assert.equal(state.systemPrompt, undefined);
  assert.equal(state.dumpTools, undefined);
  const { messages } = await rpc.getMessages();
  assert.equal(messages.length, 1);
  await rpc.prompt("hi");
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(events.at(-1).message.content, "Hello from fake");
  rpc.close();
});
