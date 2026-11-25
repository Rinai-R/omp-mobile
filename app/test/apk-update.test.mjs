import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";

const require = createRequire(import.meta.url);
const source = ts.transpileModule(readFileSync(new URL("../src/useApkUpdate.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const digest = "a".repeat(64);
const release = {
  tag_name: "v0.8.7", draft: false, prerelease: false,
  assets: [{ name: "OMP-Mobile-v0.8.7.apk", state: "uploaded", digest: `sha256:${digest}`, size: 100 }],
};

function environment() {
  const saved = new Map();
  return {
    saved, starts: 0, discarded: 0, valid: true,
    task: { kind: "downloading", percent: 42 },
    app: { currentState: "active", addEventListener: () => ({ remove() {} }) },
  };
}

// Run the hook with persistent storage and native tasks shared across JS restarts.
function mount(env) {
  const slots = [];
  const timers = new Set();
  const exports = {};
  let index = 0;
  let queued = false;
  let active = true;
  let result;
  let effects = [];
  const renderSoon = () => {
    if (queued || !active) return;
    queued = true;
    queueMicrotask(() => { queued = false; if (active) render(); });
  };
  const react = {
    useState(initial) {
      const at = index++;
      slots[at] ??= { value: initial };
      return [slots[at].value, (next) => {
        slots[at].value = typeof next === "function" ? next(slots[at].value) : next;
        renderSoon();
      }];
    },
    useRef(value) {
      const at = index++;
      slots[at] ??= { current: value };
      return slots[at];
    },
    useCallback(fn, deps) {
      const at = index++;
      if (!slots[at] || deps.some((value, i) => !Object.is(value, slots[at].deps[i]))) {
        slots[at] = { value: fn, deps };
      }
      return slots[at].value;
    },
    useEffect(fn, deps) {
      const at = index++;
      const previous = slots[at];
      if (!previous || deps.some((value, i) => !Object.is(value, previous.deps[i]))) {
        effects.push(() => {
          previous?.cleanup?.();
          slots[at] = { deps, cleanup: fn() };
        });
      }
    },
  };
  const native = {
    async startDownload() { env.starts++; },
    async downloadStatus() { return env.task; },
    async verifyApk() { return env.valid; },
    async discardDownload() { env.discarded++; },
  };
  vm.runInNewContext(source, {
    exports, __DEV__: false, AbortController, setTimeout, clearTimeout,
    setInterval(fn) { timers.add(fn); return fn; },
    clearInterval(fn) { timers.delete(fn); },
    fetch: async () => ({ ok: true, json: async () => [release] }),
    require(name) {
      if (name === "react") return react;
      if (name === "react-native") return { AppState: env.app, Platform: { OS: "android" } };
      if (name === "expo") return { requireOptionalNativeModule: () => native };
      if (name === "@react-native-async-storage/async-storage") return {
        __esModule: true, default: { getItem: async (key) => env.saved.get(key) ?? null, setItem: async (key, value) => { env.saved.set(key, value); } },
      };
      if (name === "expo-file-system/legacy") return { cacheDirectory: "file:///cache/", getInfoAsync: async () => ({ exists: false }) };
      if (name === "./i18n/index.ts") return { t: (key) => key };
      if (name === "./releases") return require("../src/releases.ts");
      throw new Error(name);
    },
  });
  function render() {
    index = 0;
    result = exports.useApkUpdate(true, "0.8.6");
    const pending = effects;
    effects = [];
    pending.forEach((fn) => fn());
  }
  render();
  return {
    get status() { return result.sheet.status; },
    primary() { result.sheet.onPrimary(); },
    tick() { timers.forEach((fn) => fn()); },
    unmount() { active = false; slots.forEach((slot) => slot?.cleanup?.()); },
  };
}
const settle = async () => { for (let i = 0; i < 8; i++) await new Promise(setImmediate); };

test("restores the original download after a JS restart and verifies it before install", async () => {
  const env = environment();
  const first = mount(env);
  await settle();
  assert.equal(first.status.kind, "offer");
  first.primary();
  await settle();
  assert.equal(first.status.percent, 42);
  first.unmount();
  const next = mount(env);
  await settle();
  assert.equal(env.starts, 1);
  assert.equal(next.status.percent, 42);
  env.app.currentState = "background";
  env.task = { kind: "complete" };
  next.tick();
  await settle();
  assert.equal(next.status.kind, "downloading");
  env.app.currentState = "active";
  next.tick();
  await settle();
  assert.equal(next.status.kind, "ready");
  next.unmount();
});

test("rejects and removes an APK whose digest does not match", async () => {
  const env = environment();
  const app = mount(env);
  await settle();
  app.primary();
  await settle();
  env.task = { kind: "complete" };
  env.valid = false;
  app.tick();
  await settle();
  assert.equal(app.status.kind, "downloadFailed");
  assert.equal(env.discarded, 1);
  app.unmount();
});
