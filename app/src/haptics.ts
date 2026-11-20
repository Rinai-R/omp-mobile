import * as Haptics from "expo-haptics";

/**
 * The motor answers events, never touches: OMP asking for an approval
 * (`ask`), a live turn finishing and a computer pairing (`done`). Presses,
 * tabs, segments, sends and gestures stay silent; the motion already confirms
 * them, and a buzz on every touch reads as a stutter. A device without a
 * motor (or with haptics off) rejects; that is not worth reporting.
 */
function quiet(run: () => Promise<void>): void {
  run().catch(() => undefined);
}

export const haptic = {
  ask: () => quiet(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)),
  done: () => quiet(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)),
};
