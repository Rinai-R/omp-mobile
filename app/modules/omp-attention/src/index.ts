/**
 * Background notifications: an Android foreground service that keeps one
 * `/events` stream per paired computer and posts approvals, questions and
 * finished turns as system notifications (modules/omp-attention/android).
 *
 * iOS has no such service; there (and in any build without the native module)
 * every call is a no-op, so the app builds and runs unchanged.
 */
import { requireOptionalNativeModule, type NativeModule } from "expo";

/** A computer the service follows: its daemon base URL and bearer token. */
export interface AttentionMachine {
  id: string;
  name: string;
  url: string;
  token: string;
}

/** A notification tap: open this session on this machine. */
export interface OpenSession {
  machineId: string;
  sessionId: string;
}

export type AttentionKind = "approval" | "question" | "resolved" | "done" | "failed";

/** A frame while the app is open, for a session not on screen: shown as an in-app banner. */
export interface Attention {
  machineId: string;
  machineName: string;
  kind: AttentionKind;
  key: string;
  sessionId: string;
  sessionTitle: string;
  text: string;
  time: number;
}

// Expo's `EventsMap` is an index-signature type, which an interface does not satisfy.
type Events = {
  onOpenSession: (payload: OpenSession) => void;
  onAttention: (payload: Attention) => void;
};

declare class OmpAttentionModule extends NativeModule<Events> {
  setMachines(json: string): void;
  setEnabled(enabled: boolean): void;
  isEnabled(): boolean;
  setStrings(json: string): void;
  setOnScreen(machineId: string, sessionId: string): void;
  takePendingOpen(): OpenSession | null;
  notificationsAllowed(): boolean;
  isBatteryRestricted(): boolean;
  requestBatteryExemption(): void;
  openNotificationSettings(): void;
}

const native = requireOptionalNativeModule<OmpAttentionModule>("OmpAttention");

/** Whether this build can notify in the background (Android with the native module). */
export const isSupported = (): boolean => native !== null;

/** The computers to follow; the service restarts only the streams whose address or token changed. */
export function setMachines(machines: readonly AttentionMachine[]): void {
  native?.setMachines(JSON.stringify(machines.map(({ id, name, url, token }) => ({ id, name, url, token }))));
}

/** Turn background notifications on or off; persisted natively so they resume after a reboot. */
export function setEnabled(enabled: boolean): void {
  native?.setEnabled(enabled);
}

/**
 * The text the service writes into notifications, in the app's language (key → text,
 * `{name}` placeholders left for it to fill); persisted for the boot receiver.
 */
export function setStrings(strings: Readonly<Record<string, string>>): void {
  native?.setStrings(JSON.stringify(strings));
}

export function isEnabled(): boolean {
  return native?.isEnabled() ?? false;
}

/** The session on screen (`""`, `""` for none): its frames are not notified, and its notifications are cleared. */
export function setOnScreen(machineId: string, sessionId: string): void {
  native?.setOnScreen(machineId, sessionId);
}

/** A notification tap not handled yet — the one that launched the app — consumed once. */
export function takePendingOpen(): OpenSession | null {
  return native?.takePendingOpen() ?? null;
}

/** Whether the system lets the app post notifications (the permission and the app's switch). */
export function notificationsAllowed(): boolean {
  return native?.notificationsAllowed() ?? false;
}

/** Whether Android may stop the service to save battery. */
export function isBatteryRestricted(): boolean {
  return native?.isBatteryRestricted() ?? false;
}

/** Ask Android to exempt the app from battery optimization. */
export function requestBatteryExemption(): void {
  native?.requestBatteryExemption();
}

/** Open the app's notification settings. */
export function openNotificationSettings(): void {
  native?.openNotificationSettings();
}

/**
 * A notification was tapped while the app runs.
 * @returns unsubscribe.
 */
export function onOpenSession(listener: (open: OpenSession) => void): () => void {
  if (native === null) return () => undefined;
  const subscription = native.addListener("onOpenSession", (open) => {
    // The tap is also kept for `takePendingOpen` (the listener may not have existed); it is handled now.
    native.takePendingOpen();
    listener(open);
  });
  return () => subscription.remove();
}

/**
 * A frame for a session not on screen arrived while the app is in the foreground.
 * @returns unsubscribe.
 */
export function onAttention(listener: (attention: Attention) => void): () => void {
  if (native === null) return () => undefined;
  const subscription = native.addListener("onAttention", listener);
  return () => subscription.remove();
}
