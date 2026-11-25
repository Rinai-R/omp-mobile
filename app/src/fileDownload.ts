/**
 * Downloading a session's file to the phone and handing it to the share sheet.
 * Over the tailnet the file streams to the cache with the token; through a
 * relay it arrives whole as base64 and is written there. Every card for one
 * file (under a reply, in a step's sheet, in the files sheet) shows the same
 * download: its state lives here, keyed by machine, session and path.
 */
import * as FileSystem from "expo-file-system/legacy";
import { useCallback, useSyncExternalStore } from "react";
import { shareFile } from "../modules/omp-share/src";
import { downloadError, downloadErrorMessage, downloadTarget, mimeType, progressLabel } from "./files";
import { t } from "./i18n/index.ts";
import { relayDownload } from "./link";
import type { Machine } from "./types";

export type DownloadState =
  | { phase: "idle" }
  | { phase: "downloading"; received: number; total: number | undefined }
  /** `uri`: a copy already on the phone, when only the share sheet failed. */
  | { phase: "failed"; message: string; uri?: string }
  | { phase: "done"; uri: string };

const IDLE: DownloadState = { phase: "idle" };

/**
 * Download `path` of the session into its own directory under the cache;
 * resolves to the local `file://` URI. `expected`: the size the daemon listed,
 * the whole for progress when the answer does not say.
 */
export async function downloadSessionFile(
  machine: Machine,
  sessionId: string,
  path: string,
  expected: number | undefined,
  onProgress: (received: number, total: number | undefined) => void,
): Promise<string> {
  const cache = FileSystem.cacheDirectory;
  if (cache === null) throw new Error("No cache directory.");
  const route = `/sessions/${encodeURIComponent(sessionId)}/file?path=${encodeURIComponent(path)}`;
  const target = downloadTarget(cache, path, `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`);
  const directory = target.slice(0, target.lastIndexOf("/") + 1);
  await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
  try {
    if (machine.relay !== undefined) {
      const answer = await relayDownload(machine.relay, route, (received, total) => onProgress(received, total ?? expected));
      if (!answer.ok) throw downloadError(answer.status, await answer.text());
      await FileSystem.writeAsStringAsync(target, answer.base64, { encoding: FileSystem.EncodingType.Base64 });
      return target;
    }
    const task = FileSystem.createDownloadResumable(
      `${machine.url}${route}`,
      target,
      { headers: { authorization: `Bearer ${machine.token}` } },
      (progress) => onProgress(progress.totalBytesWritten, progress.totalBytesExpectedToWrite > 0 ? progress.totalBytesExpectedToWrite : expected),
    );
    const result = await task.downloadAsync();
    if (result === undefined) throw new Error("The download stopped.");
    // A refusal is written to the target like a file: it is the daemon's JSON reason.
    if (result.status < 200 || result.status >= 300) throw downloadError(result.status, await FileSystem.readAsStringAsync(target).catch(() => ""));
    return result.uri;
  } catch (error) {
    await FileSystem.deleteAsync(directory, { idempotent: true }).catch(() => undefined);
    throw error;
  }
}

const states = new Map<string, DownloadState>();
const listeners = new Map<string, Set<() => void>>();
/** Downloads in flight, set before the first await so a second tap does not start another. */
const running = new Set<string>();

function setState(key: string, state: DownloadState): void {
  states.set(key, state);
  for (const listener of listeners.get(key) ?? []) listener();
}

async function share(key: string, uri: string, name: string): Promise<void> {
  try {
    await shareFile(uri, mimeType(name), t("files.shareTitle", { name }));
    setState(key, { phase: "done", uri });
  } catch {
    setState(key, { phase: "failed", message: t("files.error.share"), uri });
  }
}

/** A tap on a file: share the copy on the phone, else download it (once at a time) and then share it. */
async function openFile(key: string, machine: Machine, sessionId: string, path: string, name: string, size: number | undefined): Promise<void> {
  if (running.has(key)) return;
  running.add(key);
  try {
    const current = states.get(key) ?? IDLE;
    const copy = current.phase === "done" || current.phase === "failed" ? current.uri : undefined;
    if (copy !== undefined && (await FileSystem.getInfoAsync(copy).catch(() => ({ exists: false }))).exists) {
      await share(key, copy, name);
      return;
    }
    setState(key, { phase: "downloading", received: 0, total: size });
    let shown = "";
    let uri: string;
    try {
      uri = await downloadSessionFile(machine, sessionId, path, size, (received, total) => {
        // Only when the label changes: progress callbacks come far more often than the card can say anything new.
        const label = progressLabel(received, total);
        if (label === shown) return;
        shown = label;
        setState(key, { phase: "downloading", received, total });
      });
    } catch (error) {
      setState(key, { phase: "failed", message: downloadErrorMessage(error) });
      return;
    }
    await share(key, uri, name);
  } finally {
    running.delete(key);
  }
}

/** One file's download as every card for it shows it, and what a tap on it does. */
export function useFileDownload(
  machine: Machine,
  sessionId: string,
  path: string,
  name: string,
  size: number | undefined,
): { state: DownloadState; open: () => void } {
  const key = `${machine.id}\n${sessionId}\n${path}`;
  const subscribe = useCallback(
    (listener: () => void) => {
      let set = listeners.get(key);
      if (set === undefined) {
        set = new Set();
        listeners.set(key, set);
      }
      set.add(listener);
      return () => {
        set.delete(listener);
        if (set.size === 0) listeners.delete(key);
      };
    },
    [key],
  );
  const state = useSyncExternalStore(subscribe, () => states.get(key) ?? IDLE);
  const open = useCallback(() => void openFile(key, machine, sessionId, path, name, size), [key, machine, sessionId, path, name, size]);
  return { state, open };
}
