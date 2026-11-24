import AsyncStorage from "@react-native-async-storage/async-storage";
import { requireOptionalNativeModule, type NativeModule } from "expo";
import * as FileSystem from "expo-file-system/legacy";
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, AppState, Platform, ToastAndroid } from "react-native";
import { t } from "./i18n/index.ts";
import { findApkUpdate, LATEST_RELEASE_URL, type ApkUpdate } from "./releases";

const CHECK_INTERVAL = 24 * 60 * 60 * 1000;
const REQUEST_TIMEOUT = 10_000;

interface UpdatesModule extends NativeModule {
  verifyApk(sha256: string): Promise<boolean>;
  installApk(): Promise<boolean>;
  openInstallSettings(): Promise<void>;
}

const installer = requireOptionalNativeModule<UpdatesModule>("OmpUpdates");

export function useApkUpdate(ready: boolean, version: string) {
  const supported = Platform.OS === "android" && !__DEV__ && installer !== null;
  const [checking, setChecking] = useState(false);
  const [downloadPercent, setDownloadPercent] = useState<number | null>(null);
  const [downloaded, setDownloaded] = useState(false);
  const downloading = useRef(false);
  const pendingInstall = useRef(false);
  const installing = useRef(false);
  const inFlight = useRef(false);
  const lastCheck = useRef(0);

  const install = useCallback(async () => {
    if (installer === null || installing.current) return;
    installing.current = true;
    try {
      if (await installer.installApk()) return;
      Alert.alert(t("settings.updates.permission"), t("settings.updates.permissionDetail"), [
        { text: t("settings.updates.later"), style: "cancel" },
        {
          text: t("settings.updates.openSettings"),
          onPress: () => {
            void installer.openInstallSettings().catch(() => Alert.alert(t("settings.updates.installFailed")));
          },
        },
      ]);
    } catch {
      setDownloaded(false);
      Alert.alert(t("settings.updates.installFailed"));
    } finally {
      installing.current = false;
    }
  }, []);

  const offerInstall = useCallback(() => {
    if (!pendingInstall.current || AppState.currentState !== "active") return;
    pendingInstall.current = false;
    Alert.alert(t("settings.updates.ready"), undefined, [
      { text: t("settings.updates.later"), style: "cancel" },
      { text: t("settings.updates.install"), onPress: () => void install() },
    ]);
  }, [install]);

  const download = useCallback(async (update: ApkUpdate) => {
    if (installer === null || FileSystem.cacheDirectory === null || downloading.current) return;
    downloading.current = true;
    setDownloadPercent(0);
    ToastAndroid.show(t("settings.updates.downloadStarted"), ToastAndroid.SHORT);
    const uri = `${FileSystem.cacheDirectory}omp-update.apk`;
    try {
      const task = FileSystem.createDownloadResumable(update.url, uri, {}, ({ totalBytesWritten, totalBytesExpectedToWrite }) => {
        if (totalBytesExpectedToWrite > 0) setDownloadPercent(Math.floor(100 * totalBytesWritten / totalBytesExpectedToWrite));
      });
      const result = await task.downloadAsync();
      if (result?.status !== 200 || !(await installer.verifyApk(update.sha256))) throw new Error("Invalid APK");
      setDownloaded(true);
      pendingInstall.current = true;
      offerInstall();
    } catch {
      await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
      if (AppState.currentState === "active") Alert.alert(t("settings.updates.downloadFailed"));
    } finally {
      downloading.current = false;
      setDownloadPercent(null);
    }
  }, [offerInstall]);

  const check = useCallback(async (manual: boolean) => {
    if (!supported || downloaded || downloading.current || inFlight.current || AppState.currentState !== "active") return;
    const elapsed = Date.now() - lastCheck.current;
    if (!manual && elapsed >= 0 && elapsed < CHECK_INTERVAL) return;
    inFlight.current = true;
    const key = `omp.apk-update.last-check.${version}`;
    try {
      if (!manual) {
        const stored = Number(await AsyncStorage.getItem(key).catch(() => null));
        const sinceStored = Date.now() - stored;
        if (sinceStored >= 0 && sinceStored < CHECK_INTERVAL) {
          lastCheck.current = stored;
          return;
        }
      }
      if (AppState.currentState !== "active") return;
      lastCheck.current = Date.now();
      setChecking(true);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
      let payload: unknown;
      try {
        const response = await fetch(LATEST_RELEASE_URL, {
          headers: { Accept: "application/vnd.github+json" },
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`GitHub returned ${response.status}`);
        payload = await response.json();
      } finally {
        clearTimeout(timeout);
      }

      if (AppState.currentState !== "active") {
        lastCheck.current = 0;
        return;
      }

      const update = findApkUpdate(version, payload);
      void AsyncStorage.setItem(key, String(lastCheck.current)).catch(() => {});
      if (update) {
        Alert.alert(t("settings.updates.available", { version: update.version }), t("settings.updates.description"), [
          { text: t("settings.updates.later"), style: "cancel" },
          {
            text: t("settings.updates.download"),
            onPress: () => void download(update),
          },
        ]);
      } else if (manual) {
        Alert.alert(t("settings.updates.current"));
      }
    } catch {
      if (manual && AppState.currentState === "active") Alert.alert(t("settings.updates.failed"));
    } finally {
      inFlight.current = false;
      setChecking(false);
    }
  }, [download, downloaded, supported, version]);

  useEffect(() => {
    if (!ready || !supported) return;
    void check(false);
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active") return;
      offerInstall();
      void check(false);
    });
    return () => subscription.remove();
  }, [check, offerInstall, ready, supported]);

  const busy = checking || downloadPercent !== null;
  const label = downloadPercent !== null
    ? t("settings.updates.downloading", { percent: downloadPercent })
    : t(downloaded ? "settings.updates.install" : checking ? "settings.updates.checking" : "settings.updates.check");
  return {
    label,
    busy,
    action: supported ? () => void (downloaded ? install() : check(true)) : undefined,
  };
}
