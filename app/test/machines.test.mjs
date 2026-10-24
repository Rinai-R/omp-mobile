import assert from "node:assert/strict";
import { test } from "node:test";
import { cleanLabel, displayName, hostOf, machineLabel, shortName } from "../src/machines.ts";

const m = (url, name, label) => ({ id: url, url, token: "t", name, os: "darwin", version: "0.2.0", cwd: "/w", label });

test("a computer is called by the user's name for it, else its host name without .local", () => {
  assert.equal(shortName("RinaideMacBook-Pro.local"), "RinaideMacBook-Pro");
  assert.equal(displayName(m("http://a", "box.local")), "box");
  assert.equal(displayName(m("http://a", "box.local", "  Work Mac ")), "Work Mac");
  assert.equal(displayName(m("http://a", "box.local", "   ")), "box");
});

test("computers with the same name are told apart by their address", () => {
  const one = m("http://100.68.127.23:7390", "mac.local");
  const two = m("http://10.0.2.2:7391", "mac.local");
  const three = m("http://100.1.1.1:7390", "other");
  assert.equal(machineLabel(one, [one, two, three]), "mac · 100.68.127.23");
  assert.equal(machineLabel(two, [one, two, three]), "mac · 10.0.2.2");
  assert.equal(machineLabel(three, [one, two, three]), "other");
  assert.equal(machineLabel({ ...two, label: "Emulator host" }, [one, { ...two, label: "Emulator host" }]), "Emulator host");
  assert.equal(hostOf("http://box.tail1.ts.net:7390/x"), "box.tail1.ts.net");
});

test("a typed name is trimmed to one bounded line; empty restores the host name", () => {
  assert.equal(cleanLabel("  Work\n Mac  "), "Work Mac");
  assert.equal(cleanLabel("   "), undefined);
  assert.equal(cleanLabel("x".repeat(60)).length, 40);
});
