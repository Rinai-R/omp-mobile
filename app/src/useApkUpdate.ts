import { requireOptionalNativeModule, type NativeModule } from "expo";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as FileSystem from "expo-file-system/legacy";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Platform } from "react-native";
import { t } from "./i18n/index.ts";
import { findUpdates, isNewerVersion, isReleaseAssetUrl, RELEASES_URL, type UpdateOffer } from "./releases";

/** Two checks closer than this are the same look at the releases (a launch reports "active" more than once). */
const CHECK_GAP_MS = 20_000;
const REQUEST_TIMEOUT = 10_000;
const DOWNLOAD_OFFER_KEY = "apk-download-offer";

interface UpdatesModule extends NativeModule {
  startDownload(url: string, sha256: string): Promise<void>;
  downloadStatus(sha256: string): Promise<{ kind: "missing" | "downloading" | "complete" | "failed"; percent?: number | null }>;
  discardDownload(): Promise<void>;
  verifyApk(sha256: string): Promise<boolean>;
  installApk(): Promise<boolean>;
  openInstallSettings(): Promise<void>;
}

const installer = requireOptionalNativeModule<UpdatesModule>("OmpUpdates");

/** What the update sheet shows: what it found, how far a download is, and what to do next. */
export type UpdateStatus =
  | { kind: "checking" }
  | { kind: "offer"; offer: UpdateOffer }
  | { kind: "current" }
  | { kind: "checkFailed" }
  | { kind: "downloading"; offer: UpdateOffer; percent: number | null }
  | { kind: "downloadFailed"; offer: UpdateOffer }
  | { kind: "ready"; offer: UpdateOffer }
  | { kind: "permission"; offer: UpdateOffer }
  | { kind: "installFailed"; offer: UpdateOffer };

export interface ApkUpdateState {
  /** The Settings row's label. */
  label: string;
  busy: boolean;
  /** A newer release is waiting (found, downloading, or ready to install). */
  waiting: boolean;
  /** The Settings row's action: check now, or open the sheet when something is waiting. */
  action?: () => void;
  sheet: { visible: boolean; status: UpdateStatus; onClose: () => void; onPrimary: () => void };
}

/**
 * Looks for a newer release on every launch and every return to the foreground,
 * and keeps what it found: the notes of each version the phone skipped, and the
 * newest APK with a digest to verify. Download and install stay deliberate taps.
 */
export function useApkUpdate(ready: boolean, version: string): ApkUpdateState {
  const supported = Platform.OS === "android" && !__DEV__ && installer !== null;
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [visible, setVisible] = useState(false);
  const statusRef = useRef<UpdateStatus | null>(null);
  statusRef.current = status;
  const checking = useRef(false);
  const downloading = useRef(false);
  const installing = useRef(false);
  const lastCheck = useRef(0);
  /** A sheet the user closed stays closed until the next foreground, then shows what still waits. */
  const dismissed = useRef(false);

  const check = useCallback(async (manual: boolean) => {
    if (!supported || checking.current || downloading.current) return;
    const now = Date.now();
    if (!manual && now - lastCheck.current < CHECK_GAP_MS) return;
    if (AppState.currentState !== "active") return;
    checking.current = true;
    lastCheck.current = now;
    if (manual) {
      setStatus({ kind: "checking" });
      setVisible(true);
    }
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
      let payload: unknown;
      try {
        const response = await fetch(RELEASES_URL, {
          headers: { Accept: "application/vnd.github+json" },
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`GitHub returned ${response.status}`);
        payload = await response.json();
      } finally {
        clearTimeout(timeout);
      }
      if (AppState.currentState !== "active") {
        // The answer arrived while the app was away: the next foreground asks again.
        lastCheck.current = 0;
        return;
      }
      const offer = findUpdates(version, payload);
      if (offer === null) {
        // Only a check the user asked for says "up to date"; a background one stays quiet.
        if (manual) setStatus({ kind: "current" });
        return;
      }
      dismissed.current = false;
      // An APK this release already downloaded and verified (before the app was restarted) is not fetched again.
      const cached = statusRef.current !== null && "offer" in statusRef.current ? false : await cachedApkMatches(offer.target.sha256);
      // A download under way or done for the same APK is kept: a re-check only refreshes the notes.
      setStatus((current) =>
        current !== null && "offer" in current && current.kind !== "offer" && current.offer.target.sha256 === offer.target.sha256
          ? { ...current, offer }
          : { kind: cached ? "ready" : "offer", offer },
      );
      setVisible(true);
    } catch {
      if (manual) setStatus({ kind: "checkFailed" });
    } finally {
      checking.current = false;
    }
  }, [supported, version]);

  const download = useCallback(async (offer: UpdateOffer) => {
    if (installer === null || FileSystem.cacheDirectory === null || downloading.current) return;
    downloading.current = true;
    try {
      if (!isReleaseAssetUrl(offer.target.url) || !/^[a-f0-9]{64}$/i.test(offer.target.sha256)) {
        throw new Error("Invalid APK source");
      }
      await AsyncStorage.setItem(DOWNLOAD_OFFER_KEY, JSON.stringify(offer));
      await installer.startDownload(offer.target.url, offer.target.sha256);
      setStatus({ kind: "downloading", offer, percent: 0 });
    } catch {
      setStatus({ kind: "downloadFailed", offer });
      downloading.current = false;
    }
  }, []);

  // Poll only while visible. The system task continues independently of JS.
  useEffect(() => {
    if (status?.kind !== "downloading" || installer === null) return;
    const offer = status.offer;
    let current = true;
    let polling = false;
    const poll = async () => {
      if (polling || AppState.currentState !== "active") return;
      polling = true;
      try {
        const result = await installer.downloadStatus(offer.target.sha256);
        if (!current) return;
        if (result.kind === "downloading") {
          setStatus({ kind: "downloading", offer, percent: result.percent ?? null });
          return;
        }
        if (result.kind === "complete") {
          if (!(await installer.verifyApk(offer.target.sha256))) {
            await installer.discardDownload();
            throw new Error("Invalid APK");
          }
          if (current) setStatus({ kind: "ready", offer });
        } else {
          setStatus({ kind: "downloadFailed", offer });
        }
        downloading.current = false;
      } catch {
        if (current) {
          downloading.current = false;
          setStatus({ kind: "downloadFailed", offer });
        }
      } finally {
        polling = false;
      }
    };
    void poll();
    const timer = setInterval(() => void poll(), 1_000);
    const subscription = AppState.addEventListener("change", () => void poll());
    return () => {
      current = false;
      clearInterval(timer);
      subscription.remove();
    };
  }, [status?.kind]);

  const install = useCallback(async (offer: UpdateOffer) => {
    if (installer === null || installing.current) return;
    installing.current = true;
    try {
      if (!(await installer.installApk())) {
        setStatus({ kind: "permission", offer });
        return;
      }
      // Android's installer is in front now; the sheet closes behind it.
      setVisible(false);
    } catch {
      setStatus({ kind: "installFailed", offer });
    } finally {
      installing.current = false;
    }
  }, []);

  const openSettings = useCallback(async (offer: UpdateOffer) => {
    await installer?.openInstallSettings().catch(() => setStatus({ kind: "installFailed", offer }));
  }, []);

  useEffect(() => {
    if (!ready || !supported) return undefined;
    let mounted = true;
    // Recover the offer and task after Android has reclaimed the app process.
    void (async () => {
      try {
        const saved = await AsyncStorage.getItem(DOWNLOAD_OFFER_KEY);
        if (saved !== null) {
          const offer = JSON.parse(saved) as UpdateOffer;
          if (offer.target?.sha256 && isNewerVersion(offer.target.version, version)) {
            const task = await installer!.downloadStatus(offer.target.sha256);
            if (mounted && (task.kind === "downloading" || task.kind === "complete")) {
              downloading.current = true;
              setStatus({ kind: "downloading", offer, percent: task.percent ?? null });
              setVisible(true);
              return;
            }
          }
        }
      } catch {
        // A missing task or unreadable saved offer falls back to a release check.
      }
      if (mounted) void check(false);
    })();
    let previous = AppState.currentState;
    const subscription = AppState.addEventListener("change", (state) => {
      const wasAway = previous !== "active";
      previous = state;
      if (state !== "active") return;
      // Back in the app: what still waits is shown again, then the releases are looked at.
      const current = statusRef.current;
      if (wasAway && current?.kind === "permission") {
        // Back from Android's "install unknown apps" setting: carry on with the install.
        setVisible(true);
        void install(current.offer);
        return;
      }
      if (wasAway && dismissed.current && current !== null && "offer" in current) {
        dismissed.current = false;
        setVisible(true);
      }
      void check(false);
    });
    return () => { mounted = false; subscription.remove(); };
  }, [ready, supported, check, install]);

  const close = useCallback(() => {
    dismissed.current = true;
    setVisible(false);
  }, []);

  const onPrimary = useCallback(() => {
    const current = statusRef.current;
    if (current === null) {
      void check(true);
      return;
    }
    switch (current.kind) {
      case "checking":
      case "downloading":
        return;
      case "offer":
      case "downloadFailed":
        void download(current.offer);
        return;
      case "ready":
      case "permission":
        void (current.kind === "ready" ? install(current.offer) : openSettings(current.offer));
        return;
      case "installFailed":
        setStatus({ kind: "ready", offer: current.offer });
        return;
      case "current":
      case "checkFailed":
        void check(true);
        return;
    }
  }, [check, download, install, openSettings]);

  const waiting = status !== null && "offer" in status;
  return {
    label: waiting ? t("settings.updates.waiting", { version: newestOf(status) }) : t("settings.updates.check"),
    busy: status?.kind === "checking" || status?.kind === "downloading",
    waiting,
    action: supported ? () => (waiting ? setVisible(true) : void check(true)) : undefined,
    sheet: { visible, status: status ?? { kind: "checking" }, onClose: close, onPrimary },
  };
}

function newestOf(status: UpdateStatus): string {
  return "offer" in status ? status.offer.versions[0]?.version ?? "" : "";
}

/** Whether the cache holds an APK with this digest; a missing or unreadable file is no match. */
async function cachedApkMatches(sha256: string): Promise<boolean> {
  if (installer === null || FileSystem.cacheDirectory === null) return false;
  const info = await FileSystem.getInfoAsync(`${FileSystem.cacheDirectory}omp-update.apk`).catch(() => null);
  if (info?.exists !== true) return false;
  return installer.verifyApk(sha256).catch(() => false);
}
