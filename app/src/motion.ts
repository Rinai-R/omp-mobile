/**
 * The app's motion vocabulary, in one place so every surface moves alike
 * (Apple's "Designing Fluid Interfaces", via Reanimated 4):
 *
 * - Springs take Apple's two parameters: `dampingRatio` (1 = no overshoot)
 *   and a perceived `duration`. Critically damped by default; a little bounce
 *   only after a gesture that carried momentum (a flick, a drag release).
 * - Anything a finger moves tracks it 1:1, then hands its release velocity to
 *   a spring; where it lands is chosen from the projected endpoint, not the
 *   release point, so a short flick commits.
 * - Everything starts from the value on screen, so it can be caught mid-flight.
 */
import { Easing, ReduceMotion, type WithSpringConfig, type WithTimingConfig } from "react-native-reanimated";

/** Strong ease-out for entering and leaving; on-screen moves; the iOS sheet curve. Never ease-in on UI. */
export const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);
export const EASE_IN_OUT = Easing.bezier(0.77, 0, 0.175, 1);
export const EASE_SHEET = Easing.bezier(0.32, 0.72, 0, 1);

/** Critically damped settle: menus, reveals, anything not thrown. */
export const SPRING_SETTLE: WithSpringConfig = { duration: 400, dampingRatio: 1, reduceMotion: ReduceMotion.System };
/** Screen push/pop and sheets after a drag: the velocity of the finger carries into it. */
export const SPRING_SHEET: WithSpringConfig = { duration: 340, dampingRatio: 0.9, reduceMotion: ReduceMotion.System };
export const SPRING_SCREEN: WithSpringConfig = { duration: 380, dampingRatio: 1, reduceMotion: ReduceMotion.System };
/** Snap back after a drag that did not commit: quick, a touch of give. */
export const SPRING_SNAP: WithSpringConfig = { duration: 320, dampingRatio: 0.85, reduceMotion: ReduceMotion.System };

/** Press feedback: in fast, out a little slower. */
export const PRESS_IN: WithTimingConfig = { duration: 110, easing: EASE_OUT, reduceMotion: ReduceMotion.System };
export const PRESS_OUT: WithTimingConfig = { duration: 180, easing: EASE_OUT, reduceMotion: ReduceMotion.System };
/** How far a pressed surface sinks: buttons and rows 0.97, large cards 0.985. */
export const PRESS_SCALE = 0.97;

/** Small state changes: a chip, a toggle, a segment's pill. */
export const QUICK: WithTimingConfig = { duration: 220, easing: EASE_IN_OUT, reduceMotion: ReduceMotion.System };

/**
 * Where a fling would come to rest (Apple's exponential decay; 0.998 is the
 * scroll-view rate). Choose a snap point from `position + project(velocity)`.
 */
export function project(velocity: number, decelerationRate = 0.998): number {
  "worklet";
  return ((velocity / 1000) * decelerationRate) / (1 - decelerationRate);
}

/** Past a boundary the element follows less and less: resistance, not a wall. */
export function rubberband(overshoot: number, dimension: number, constant = 0.55): number {
  "worklet";
  return (overshoot * dimension * constant) / (dimension + constant * Math.abs(overshoot));
}
