import * as Haptics from "expo-haptics";

/**
 * The few touches the app answers with a tap of the motor: a light one for
 * sending and pressing primary buttons, a selection tick for segments and
 * choices, and a notification buzz when OMP asks for an approval. A device
 * without a motor (or with haptics off) rejects; that is not worth reporting.
 */
function quiet(run: () => Promise<void>): void {
  run().catch(() => undefined);
}

export const haptic = {
  tap: () => quiet(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)),
  press: () => quiet(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)),
  select: () => quiet(() => Haptics.selectionAsync()),
  ask: () => quiet(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)),
  done: () => quiet(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)),
};
