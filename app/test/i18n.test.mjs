import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CATALOGS,
  getLanguage,
  isLanguagePreference,
  languageOfLocale,
  placeholders,
  resolveLanguage,
  setLanguage,
  subscribeLanguage,
  t,
  translate,
} from "../src/i18n/index.ts";
import { activityLabel, turnLabel } from "../src/rows.ts";
import { age } from "../src/sessionGroups.ts";

const en = CATALOGS.en;
const zh = CATALOGS["zh-CN"];

test("both catalogs have the same keys", () => {
  assert.deepEqual(Object.keys(zh).sort(), Object.keys(en).sort());
});

test("both catalogs use the same placeholders for each key", () => {
  for (const key of Object.keys(en)) {
    assert.deepEqual(placeholders(zh[key]), placeholders(en[key]), key);
  }
});

test("no message is empty, and a counted message uses {count}", () => {
  for (const [language, catalog] of Object.entries(CATALOGS)) {
    for (const [key, message] of Object.entries(catalog)) {
      const forms = typeof message === "string" ? [message] : [message.one, message.other];
      for (const form of forms) if (key !== "common.listSeparator") assert.ok(form.trim() !== "", `${language} ${key}`);
      if (typeof message !== "string") assert.ok(placeholders(message).includes("count"), `${language} ${key}`);
    }
  }
});

test("the Chinese catalog is translated, not copied", () => {
  // Product names, technical terms and pure formats read the same in both languages.
  const allowed = new Set([
    "settings.about.app",
    "machine.daemon",
    "machines.addSheet.token",
    "machines.addSheet.tokenPlaceholder",
  ]);
  const same = Object.keys(en).filter((key) => JSON.stringify(en[key]) === JSON.stringify(zh[key]) && /[A-Za-z]{2,}/.test(JSON.stringify(en[key])));
  assert.deepEqual(same.filter((key) => !allowed.has(key)), []);
});

test("interpolation and plurals", () => {
  assert.equal(translate("en", "probe.sessions", { count: 1 }), "1 session");
  assert.equal(translate("en", "probe.sessions", { count: 0 }), "0 sessions");
  assert.equal(translate("en", "probe.sessions", { count: 5 }), "5 sessions");
  assert.equal(translate("zh-CN", "probe.sessions", { count: 1 }), "1个会话");
  assert.equal(translate("zh-CN", "probe.sessions", { count: 5 }), "5个会话");
  assert.equal(translate("en", "home.cantReach", { name: "mac" }), "Can't reach mac");
  assert.equal(translate("zh-CN", "home.cantReach", { name: "mac" }), "连不上 mac");
  // A missing value leaves its placeholder visible rather than printing "undefined".
  assert.equal(translate("en", "home.cantReach"), "Can't reach {name}");
});

test("the language follows the system locale unless the user chose one", () => {
  assert.equal(languageOfLocale("zh_CN_#Hans"), "zh-CN");
  assert.equal(languageOfLocale("zh-Hant-TW"), "zh-CN");
  assert.equal(languageOfLocale("zh"), "zh-CN");
  assert.equal(languageOfLocale("en_US"), "en");
  assert.equal(languageOfLocale("ja-JP"), "en");
  assert.equal(languageOfLocale("zu-ZA"), "en");
  assert.equal(languageOfLocale(undefined), "en");
  assert.equal(resolveLanguage("system", "zh-CN"), "zh-CN");
  assert.equal(resolveLanguage(undefined, "fr-FR"), "en");
  assert.equal(resolveLanguage("en", "zh-CN"), "en");
  assert.equal(resolveLanguage("zh-CN", "en-US"), "zh-CN");
  assert.equal(isLanguagePreference("system"), true);
  assert.equal(isLanguagePreference("fr"), false);
});

test("switching the language tells subscribers and changes composed text", () => {
  let calls = 0;
  const off = subscribeLanguage(() => {
    calls += 1;
  });
  try {
    setLanguage("zh-CN");
    assert.equal(getLanguage(), "zh-CN");
    assert.equal(t("group.waiting"), "需要你");
    const read = (id, path) => ({ kind: "tool", tool: { kind: "tool", id, name: "read", args: { path }, status: "done" } });
    const run = (id) => ({ kind: "tool", tool: { kind: "tool", id, name: "bash", args: { command: "ls" }, status: "done" } });
    assert.equal(activityLabel([run("a"), run("b"), read("c", "/a"), read("d", "/b")]), "执行了命令、读取了文件");
    assert.equal(turnLabel({ end: "done", startedAt: 0, endedAt: 192_000 }), "已完成，用时 3分12秒");
    assert.equal(turnLabel({ end: "failed", startedAt: 0, endedAt: 1 }), "处理失败");
    const now = new Date(2026, 9, 24, 12).getTime();
    assert.equal(age(now - 5 * 60_000, now), "5分钟");
    assert.equal(age(new Date(2026, 8, 3).getTime(), now), "9月3日");
    setLanguage("zh-CN");
    assert.equal(calls, 1, "the same language again is not a change");
  } finally {
    setLanguage("en");
    off();
  }
  assert.equal(calls, 2);
  assert.equal(age(new Date(2026, 8, 3).getTime(), new Date(2026, 9, 24, 12).getTime()), "Sep 3");
});
