#!/usr/bin/env node
/**
 * A fake `hc connect` for tests: herdr-core's JSON-RPC lines over stdio, its
 * terminals read from the JSON file FAKE_HC_STATE (re-read on every call, so a
 * test changes the world by rewriting it), every call appended to FAKE_HC_LOG.
 * `events.subscribe` answers with a snapshot, then reports each change of a
 * terminal it sees in the file as an event, with a heartbeat.
 * Never talks to a real herdr-core.
 */
import { appendFileSync, readFileSync } from "node:fs";
import { createInterface } from "node:readline";

if (process.argv[2] !== "connect") {
  process.stderr.write("fake hc: only `connect`\n");
  process.exit(2);
}
const stateFile = process.env.FAKE_HC_STATE;
const logFile = process.env.FAKE_HC_LOG;
const METHODS = ["hello", "terminal.list", "terminal.get", "terminal.read", "terminal.send", "terminal.keys", "terminal.interrupt", "terminal.put", "events.subscribe"];

const world = () => JSON.parse(readFileSync(stateFile, "utf8"));
const out = (value) => process.stdout.write(`${JSON.stringify(value)}\n`);
const find = (name) => world().terminals.find((terminal) => terminal.address === name || terminal.name === name);
let seq = 0;
let watching;

createInterface({ input: process.stdin }).on("line", (line) => {
  const { id, method, params = {} } = JSON.parse(line);
  if (logFile) appendFileSync(logFile, `${JSON.stringify({ method, params })}\n`);
  const ok = (result) => out({ jsonrpc: "2.0", id, result });
  const fail = (kind, message) => out({ jsonrpc: "2.0", id, error: { kind, message } });
  const state = world();
  if (state.down === true) {
    process.exit(1);
  }
  switch (method) {
    case "hello":
      return ok({ generation: state.generation ?? 1, methods: state.methods ?? METHODS, features: ["events", "status"], core: { id: "fake", name: "fake" } });
    case "terminal.list":
      return ok({ terminals: state.terminals, machines: [], hidden_finished: 0 });
    case "terminal.get": {
      const terminal = find(params.terminal);
      return terminal ? ok(terminal) : fail("not_found", `no terminal ${params.terminal}`);
    }
    case "terminal.read":
      return ok({ text: state.screens?.[params.terminal] ?? "", complete: true, how: "screen" });
    case "terminal.send": {
      const terminal = find(params.terminal);
      if (terminal?.status?.state === "blocked" && params.force !== true) return fail("blocked", "it is blocked");
      return ok({ turn: terminal?.turn ?? 0, status: terminal?.status?.state ?? null, started: true });
    }
    case "terminal.keys":
      return ok({ turn: find(params.terminal)?.turn ?? 0, status: find(params.terminal)?.status?.state ?? null });
    case "terminal.interrupt":
      return ok({ key: "esc", outcome: "stopped" });
    case "events.subscribe": {
      ok({ seq: ++seq, channel: null, terminals: state.terminals });
      let last = new Map(state.terminals.map((terminal) => [terminal.address, JSON.stringify(terminal)]));
      clearInterval(watching);
      watching = setInterval(() => {
        let now;
        try {
          now = world();
        } catch {
          return;
        }
        if (now.down === true) process.exit(1);
        const next = new Map(now.terminals.map((terminal) => [terminal.address, JSON.stringify(terminal)]));
        for (const [address, text] of next) {
          if (last.get(address) !== text) out({ jsonrpc: "2.0", method: "event", params: { seq: ++seq, terminal: address, type: last.has(address) ? "status" : "created", data: JSON.parse(text).status ?? null } });
        }
        for (const address of last.keys()) {
          if (!next.has(address)) out({ jsonrpc: "2.0", method: "event", params: { seq: ++seq, terminal: address, type: "removed", data: null } });
        }
        last = next;
      }, 30);
      return undefined;
    }
    default:
      return fail("unknown_method", method);
  }
});
