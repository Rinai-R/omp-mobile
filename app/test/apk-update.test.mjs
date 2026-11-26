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
    saved, starts: 0, discarded: 0, paused: 0, resumed: 0, valid: true, checks: 0, statusReads: 0,
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
    async downloadStatus() { env.statusReads++; return env.task; },
    async verifyApk() { return env.valid; },
    async discardDownload() { env.discarded++; },
    async pauseDownload() { env.paused++; },
    async resumeDownload() { env.resumed++; },
  };
  vm.runInNewContext(source, {
    exports, __DEV__: false, AbortController, setTimeout, clearTimeout,
    setInterval(fn) { timers.add(fn); return fn; },
    clearInterval(fn) { timers.delete(fn); },
    fetch: async () => {
      env.checks++;
      return { ok: true, json: async () => [release] };
    },
    require(name) {
      if (name === "react") return react;
      if (name === "react-native") return { AppState: env.app, Platform: { OS: "android" } };
      if (name === "expo") return { requireOptionalNativeModule: () => native };
      if (name === "@react-native-async-storage/async-storage") return {
        __esModule: true, default: { getItem: async (key) => env.saved.get(key) ?? null, setItem: async (key, value) => { env.saved.set(key, value); }, removeItem: async (key) => { env.saved.delete(key); }, multiRemove: async (keys) => { keys.forEach((key) => env.saved.delete(key)); } },
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
    pause() { result.sheet.onPause?.(); },
    resume() { result.sheet.onResume?.(); },
    cancel() { result.sheet.onCancel?.(); },
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

test("repeated taps while a download is being queued start one transfer", async () => {
  const env = environment();
  const app = mount(env);
  await settle();
  for (let i = 0; i < 5; i++) app.primary();
  await settle();
  assert.equal(env.starts, 1);
  assert.equal(app.status.kind, "downloading");
  app.unmount();
});

test("cancelling a download discards the APK and its saved offer, then offers it again", async () => {
  const env = environment();
  const app = mount(env);
  await settle();
  app.primary();
  await settle();
  assert.equal(app.status.kind, "downloading");
  assert.equal(env.saved.size, 1);
  app.cancel();
  await settle();
  assert.equal(env.discarded, 1);
  assert.equal(env.saved.size, 0);
  assert.equal(app.status.kind, "offer");
  const restored = mount(env);
  await settle();
  assert.equal(restored.status.kind, "offer", "a cancelled download is not restored after a restart");
  assert.equal(env.starts, 1);
  restored.unmount();
  app.unmount();
});

test("pausing keeps the partial APK and resuming restarts the transfer from it", async () => {
  const env = environment();
  const first = mount(env);
  await settle();
  first.primary();
  await settle();
  first.pause();
  await settle();
  assert.equal(env.paused, 1);
  assert.equal(first.status.kind, "paused");
  assert.equal(first.status.percent, 42);
  assert.equal(env.saved.size, 2, "the offer and the resume point are both saved");
  first.unmount();
  // The native task is gone once paused; the JS mock must reflect that.
  env.task = { kind: "missing" };
  const restored = mount(env);
  await settle();
  assert.equal(restored.status.kind, "paused", "a paused transfer survives a restart");
  env.task = { kind: "downloading", percent: 42 };
  assert.equal(restored.status.offer.target.version, "0.8.7", "the paused offer is restored for use");
  restored.resume();
  await settle();
  assert.equal(env.resumed, 1);
  assert.equal(restored.status.kind, "downloading");
  restored.unmount();
});

test("cancelling a paused download removes the saved partial APK", async () => {
  const env = environment();
  const app = mount(env);
  await settle();
  app.primary();
  await settle();
  app.pause();
  await settle();
  app.cancel();
  await settle();
  assert.equal(env.discarded, 1);
  assert.equal(env.saved.size, 0);
  assert.equal(app.status.kind, "offer");
  app.unmount();
});

test("a verified private APK restores after the system task has been removed", async () => {
  const env = environment();
  const first = mount(env);
  await settle();
  first.primary();
  await settle();
  env.task = { kind: "complete" }; // Native cached state remains after task removal.
  first.tick();
  await settle();
  assert.equal(first.status.kind, "ready");
  first.unmount();
  const restored = mount(env);
  await settle();
  assert.equal(restored.status.kind, "ready");
  assert.equal(env.starts, 1);
  restored.unmount();
});

for (const savedVersion of ["0.8.6", "0.8.5"]) {
  test(`a saved ${savedVersion} download is skipped on installed 0.8.6 and releases are checked`, async () => {
    const env = environment();
    const initial = mount(env);
    await settle();
    initial.primary();
    await settle();
    initial.unmount();
    const [key, value] = [...env.saved.entries()][0];
    const offer = JSON.parse(value);
    offer.target.version = savedVersion;
    env.saved.set(key, JSON.stringify(offer));
    env.task = { kind: "complete" };
    env.checks = 0;
    env.statusReads = 0;

    const restored = mount(env);
    await settle();
    assert.equal(env.statusReads, 0);
    assert.equal(env.checks, 1);
    assert.equal(restored.status.kind, "offer");
    assert.equal(restored.status.offer.target.version, "0.8.7");
    restored.unmount();
  });
}

for (const invalid of [
  { url: "http://github.com/app.apk" },
  { url: "https://example.com/app.apk" },
  { url: "https://github.com.example.com/app.apk" },
  { sha256: "invalid" },
]) {
  test(`download rejects ${JSON.stringify(invalid)} before saving or starting a native task`, async () => {
    const env = environment();
    const app = mount(env);
    await settle();
    Object.assign(app.status.offer.target, invalid);
    app.primary();
    await settle();
    assert.equal(app.status.kind, "downloadFailed");
    assert.equal(env.starts, 0);
    assert.equal(env.saved.size, 0);
    app.unmount();
  });
}
