/**
 * The phone's side of i18n: its locale, the React hook that re-renders on a
 * language change, and the strings the native notification service composes.
 * Kept apart from index.ts, which stays free of React Native for the tests.
 */
import { useSyncExternalStore } from "react";
import { I18nManager } from "react-native";
import { CATALOGS, getLanguage, subscribeLanguage, translate, type Key, type Language } from "./index.ts";

/** The phone's locale (`zh_CN_#Hans`, `en_US`, …); the JS engine's as a fallback. */
export function systemLocale(): string | undefined {
  try {
    const fromNative = (I18nManager.getConstants() as { localeIdentifier?: string }).localeIdentifier;
    if (typeof fromNative === "string" && fromNative !== "") return fromNative;
  } catch {
    // No native module (tests, web): fall through.
  }
  try {
    return Intl.DateTimeFormat().resolvedOptions().locale;
  } catch {
    return undefined;
  }
}

/** The app's language; the component re-renders when it changes. */
export function useLanguage(): Language {
  return useSyncExternalStore(subscribeLanguage, getLanguage, getLanguage);
}

/** Keys of the text the Android service writes into its notifications (Notifier.kt reads the same names). */
const NATIVE_KEYS = [
  "common.session",
  "attention.approval",
  "attention.question",
  "attention.done",
  "attention.failed",
  "notify.channel.attention",
  "notify.channel.attention.detail",
  "notify.channel.turns",
  "notify.channel.turns.detail",
  "notify.channel.service",
  "notify.channel.service.detail",
  "notify.service.connected",
  "notify.service.partial",
] as const satisfies readonly Key[];

/**
 * The notification text in `language`, for the native module. Placeholders stay
 * as `{name}` for Kotlin to fill; the counted title comes as its two forms.
 */
export function nativeStrings(language: Language): Record<string, string> {
  const strings: Record<string, string> = {};
  for (const key of NATIVE_KEYS) strings[key] = translate(language, key);
  const title = CATALOGS[language]["notify.service.title"];
  strings["notify.service.title.one"] = typeof title === "string" ? title : title.one;
  strings["notify.service.title.other"] = typeof title === "string" ? title : title.other;
  return strings;
}
