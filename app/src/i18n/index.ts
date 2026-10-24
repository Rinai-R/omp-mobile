/**
 * The app's text in English and Simplified Chinese.
 *
 * Pure TypeScript (no React Native import), so the helpers that compose text
 * outside components (rows, probes, groups) and the node tests use it as is.
 * The language is one module-level value: `setLanguage` changes it and tells
 * subscribers, and the app re-renders its whole tree on a change (App.tsx).
 * Text from OMP or the daemon (model names, tool output, its errors) is never
 * passed through here.
 */
import { en, type Key, type Message } from "./en.ts";
import { zhCN } from "./zh-CN.ts";

export type { Key, Message } from "./en.ts";

/** A language the app has text for. */
export type Language = "en" | "zh-CN";
/** The user's choice in Settings: follow the phone, or one language. */
export type LanguagePreference = "system" | Language;

export const LANGUAGES: readonly Language[] = ["en", "zh-CN"];

export const CATALOGS: Readonly<Record<Language, Readonly<Record<Key, Message>>>> = { en, "zh-CN": zhCN };

/** Values for `{name}` placeholders; `count` also picks the plural form. */
export type Params = Readonly<Record<string, string | number>>;

/** The language for a system locale (`zh-Hans-CN`, `zh_TW`, `en-US`, …): any Chinese is zh-CN, else English. */
export function languageOfLocale(locale: string | undefined | null): Language {
  return typeof locale === "string" && /^zh(?:[-_]|$)/i.test(locale.trim()) ? "zh-CN" : "en";
}

/** The language a preference resolves to on a phone whose locale is `systemLocale`. */
export function resolveLanguage(preference: LanguagePreference | undefined, systemLocale: string | undefined | null): Language {
  if (preference === "en" || preference === "zh-CN") return preference;
  return languageOfLocale(systemLocale);
}

/** Whether a stored value is a preference this version knows. */
export function isLanguagePreference(value: unknown): value is LanguagePreference {
  return value === "system" || value === "en" || value === "zh-CN";
}

/** English has one and other; Chinese has no plural forms (a plain string serves every count). */
function pluralForm(language: Language, count: number): "one" | "other" {
  return language === "en" && count === 1 ? "one" : "other";
}

function fill(template: string, params: Params | undefined): string {
  if (params === undefined) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => {
    const value = params[name];
    return value === undefined ? whole : String(value);
  });
}

/** The text of `key` in `language`, with `params` filled in. */
export function translate(language: Language, key: Key, params?: Params): string {
  const message = CATALOGS[language][key] ?? en[key];
  if (typeof message === "string") return fill(message, params);
  const count = typeof params?.count === "number" ? params.count : Number(params?.count ?? 0);
  return fill(message[pluralForm(language, count)], params);
}

/** Every `{name}` placeholder a message uses, across its plural forms. */
export function placeholders(message: Message): string[] {
  const forms = typeof message === "string" ? [message] : [message.one, message.other];
  const names = new Set<string>();
  for (const form of forms) for (const match of form.matchAll(/\{(\w+)\}/g)) names.add(match[1] as string);
  return [...names].sort();
}

let current: Language = "en";
const listeners = new Set<() => void>();

export function getLanguage(): Language {
  return current;
}

/** Switch the app's language; subscribers re-render. */
export function setLanguage(language: Language): void {
  if (language === current) return;
  current = language;
  for (const listener of [...listeners]) listener();
}

/** @returns unsubscribe. */
export function subscribeLanguage(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The text of `key` in the app's current language. */
export function t(key: Key, params?: Params): string {
  return translate(current, key, params);
}

/** The separator between list items: ", " in English, "，" in Chinese. */
export function listSeparator(): string {
  return t("common.listSeparator");
}
