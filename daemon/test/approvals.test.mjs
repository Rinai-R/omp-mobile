import assert from "node:assert/strict";
import { test } from "node:test";
import { approvalAnswer, validateApproval } from "../src/approvals.mjs";
import { RpcSession } from "../src/rpc-session.mjs";
const form = {
  id: "f",
  method: "form",
  html: '<form><label><input type="radio" name="env" value="staging">Staging</label><label><input type="radio" name="env" value="prod" disabled>Prod</label><input name="code" pattern="[A-Z]{2}" required></form>',
};
test("both structured answer formats survive the shared HTTP/WebSocket boundary", () => {
  const data = { code: "AB" },
    answers = [{ id: "q", selectedOptions: ["A"] }];
  assert.deepEqual(approvalAnswer({ id: "f", data, answers, extra: "drop" }), {
    data,
    answers,
  });
  assert.deepEqual(
    approvalAnswer({ data: [], answers: "bad", cancelled: false }),
    {},
  );
});
test("computer enforces pattern v rules even when Android cannot compile them", () => {
  assert.throws(
    () => validateApproval(form, { data: { code: "ab" } }),
    /Must match/,
  );
  assert.doesNotThrow(() => validateApproval(form, { data: { code: "AB" } }));
  assert.throws(
    () => validateApproval(form, { data: { code: "AB", env: "prod" } }),
    /disabled/,
  );
  assert.throws(
    () => validateApproval(form, { data: { code: "AB", unknown: "x" } }),
    /unknown field/,
  );
});
test("a rejected answer does not consume the request; corrected answer settles once", () => {
  const rpc = new RpcSession({ cwd: process.cwd() });
  const writes = [];
  rpc.child = { stdin: { write: (s) => writes.push(JSON.parse(s)) } };
  rpc.extensionRequests.set(form.id, form);
  assert.throws(
    () => rpc.respondExtension("f", { data: { code: "ab" } }),
    /Must match/,
  );
  assert.ok(rpc.extensionRequests.has("f"));
  assert.equal(writes.length, 0);
  rpc.respondExtension("f", { data: { code: "AB" } });
  assert.equal(writes.length, 1);
  assert.ok(!rpc.extensionRequests.has("f"));
  assert.throws(
    () => rpc.respondExtension("f", { data: { code: "AB" } }),
    /unknown extension/,
  );
});
test("ask rejects reordered, duplicate or unknown answers before forwarding", () => {
  const r = {
    id: "a",
    method: "ask",
    questions: [
      {
        id: "q",
        question: "Choose",
        options: [{ label: "A" }, { label: "B" }],
      },
    ],
  };
  assert.doesNotThrow(() =>
    validateApproval(r, { answers: [{ id: "q", selectedOptions: ["B"] }] }),
  );
  assert.throws(
    () =>
      validateApproval(r, {
        answers: [{ id: "wrong", selectedOptions: ["B"] }],
      }),
    /must have id/,
  );
  assert.throws(
    () =>
      validateApproval(r, {
        answers: [{ id: "q", selectedOptions: ["B", "B"] }],
      }),
    /twice/,
  );
  assert.throws(
    () =>
      validateApproval(r, { answers: [{ id: "q", selectedOptions: ["C"] }] }),
    /unknown option/,
  );
  assert.throws(
    () =>
      validateApproval(r, {
        answers: [{ id: "q", selectedOptions: ["B"], customInput: "Other" }],
      }),
    /single-select/,
  );
});
test("cancelling unknown/unsupported dialog types remains possible without fabricating an answer", () => {
  assert.doesNotThrow(() =>
    validateApproval({ method: "future" }, { cancelled: true }),
  );
  assert.throws(
    () => validateApproval({ method: "future" }, { value: "yes" }),
    /Unsupported/,
  );
});

import { Daemon, SessionEntry } from "../src/server.mjs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocket } from "ws";
import { once } from "node:events";
test("HTTP validation leaves a form open; WebSocket forwards ask answers and identifies acknowledgements", async () => {
  const dir = mkdtempSync(join(tmpdir(), "omp-approval-integration-"));
  const writes = [];
  const rpc = new RpcSession({ cwd: dir });
  rpc.child = { stdin: { write: (s) => writes.push(JSON.parse(s)) } };
  rpc.getState = async () => ({ sessionId: "s", isStreaming: false });
  rpc.getMessages = async () => ({ messages: [] });
  rpc.close = async () => {};
  rpc.extensionRequests.set("f", form);
  const ask = {
    id: "ask",
    method: "ask",
    questions: [
      { id: "q", question: "Pick", options: [{ label: "A" }, { label: "B" }] },
    ],
  };
  rpc.extensionRequests.set("ask", ask);
  const d = new Daemon(
    {
      host: "127.0.0.1",
      port: 0,
      cwd: dir,
      ompHome: dir,
      registryFile: join(dir, "sessions.json"),
    },
    "approval-test-token",
  );
  const entry = new SessionEntry(dir, rpc);
  await entry.hydrate();
  entry.bind();
  d.sessions.set("s", entry);
  await d.listen();
  const base = `http://127.0.0.1:${d.server.address().port}`;
  let ws;
  try {
    const submit = (data) =>
      fetch(base + "/sessions/s/answer", {
        method: "POST",
        headers: {
          authorization: "Bearer approval-test-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({ id: "f", data }),
      });
    const bad = await submit({ code: "ab" });
    assert.equal(bad.status, 400);
    assert.match((await bad.json()).error, /Must match/);
    assert.ok(rpc.extensionRequests.has("f"));
    const good = await submit({ code: "AB" });
    assert.equal(good.status, 200);
    assert.deepEqual(writes[0].data, { code: "AB" });
    ws = new WebSocket(base.replace("http:", "ws:") + "/sessions/s/ws", {
      headers: { authorization: "Bearer approval-test-token" },
    });
    const frames = [];
    ws.on("message", (raw) => frames.push(JSON.parse(String(raw))));
    await once(ws, "open");
    ws.send(
      JSON.stringify({
        type: "approval",
        id: "ask",
        answers: [{ id: "q", selectedOptions: ["B"] }],
      }),
    );
    for (let i = 0; i < 50 && !frames.some((f) => f.type === "accepted"); i++)
      await new Promise((r) => setTimeout(r, 10));
    assert.deepEqual(writes[1], {
      type: "extension_ui_response",
      id: "ask",
      answers: [{ id: "q", selectedOptions: ["B"] }],
    });
    assert.ok(frames.some((f) => f.type === "accepted" && f.id === "ask"));
    assert.ok(
      frames.some((f) => f.type === "snapshot" && Array.isArray(f.approvals)),
    );
  } finally {
    ws?.terminate();
    await d.close();
  }
});

test("structured ask is enabled only by a capable socket and disabled when it leaves", async () => {
  const dir = mkdtempSync(join(tmpdir(), "omp-ask-capability-"));
  const commands = [];
  const rpc = {
    extensionRequests: new Map(),
    request: async (type, args) => {
      commands.push({ type, ...args });
    },
    getState: async () => ({ sessionId: "cap", isStreaming: false }),
    getMessages: async () => ({ messages: [] }),
    close: async () => {},
  };
  const entry = new SessionEntry(dir, rpc);
  await entry.hydrate();
  const d = new Daemon(
    {
      host: "127.0.0.1",
      port: 0,
      cwd: dir,
      ompHome: dir,
      registryFile: join(dir, "sessions.json"),
    },
    "capability-token",
  );
  d.sessions.set("cap", entry);
  await d.listen();
  const base = `ws://127.0.0.1:${d.server.address().port}/sessions/cap/ws`;
  let legacy, modern;
  try {
    legacy = new WebSocket(base, {
      headers: { authorization: "Bearer capability-token" },
    });
    await once(legacy, "open");
    await new Promise((r) => setTimeout(r, 20));
    assert.deepEqual(commands, []);
    modern = new WebSocket(base + "?dialogs=1", {
      headers: { authorization: "Bearer capability-token" },
    });
    await once(modern, "open");
    await new Promise((r) => setTimeout(r, 20));
    assert.deepEqual(commands, [{ type: "set_ask_dialog", enabled: true }]);
    modern.terminate();
    await new Promise((r) => setTimeout(r, 30));
    assert.deepEqual(commands.at(-1), {
      type: "set_ask_dialog",
      enabled: false,
    });
  } finally {
    legacy?.terminate();
    modern?.terminate();
    await d.close();
  }
});
