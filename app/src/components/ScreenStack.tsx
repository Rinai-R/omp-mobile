import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { StyleSheet, useWindowDimensions, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  cancelAnimation,
  ReduceMotion,
  useAnimatedReaction,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
  type WithTimingConfig,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { EASE_OUT, project, rubberband, SPRING_SCREEN } from "../motion";

/** A screen pushed over the shell; a new `key` replaces it in place. */
export interface Layer {
  key: string;
  node: ReactNode;
}

interface Props {
  /** The shell: stays mounted, and keeps its state, under a pushed screen. */
  base: ReactNode;
  top: Layer | null;
  /** The swipe back committed: the owner pops `top`; the screen is already on its way out. */
  onSwipeBack: () => void;
}

/** How far the shell slides left under a pushed screen, of the width, and how much it dims. */
const PARALLAX = 0.28;
const DIM = 0.15;
/** A swipe whose projected end passes this share of the width goes back. */
const COMMIT = 0.4;
/** Reduced motion: a short crossfade, nothing slides. */
const FADE: WithTimingConfig = { duration: 200, easing: EASE_OUT, reduceMotion: ReduceMotion.Never };

/**
 * A two-level stack: a pushed screen slides in from the right over the shell,
 * which shifts left and dims, all derived from one `progress` (0 shell, 1
 * pushed). A pop runs the same path back; a swipe right anywhere on the pushed
 * screen tracks the finger and goes back by its projected end. Every move
 * starts from the value on screen, so a back mid-push reverses where it is.
 */
export function ScreenStack({ base, top, onSwipeBack }: Props): ReactNode {
  const { width } = useWindowDimensions();
  const reduced = useReducedMotion();
  const progress = useSharedValue(top === null ? 0 : 1);
  const start = useSharedValue(0);

  // The popped screen stays on screen until it has slid away; its latest render is kept for that.
  const topKey = top?.key ?? null;
  const last = useRef<Layer | null>(top);
  if (top !== null) last.current = top;
  const [prevKey, setPrevKey] = useState(topKey);
  const [leaving, setLeaving] = useState(false);
  if (prevKey !== topKey) {
    setPrevKey(topKey);
    setLeaving(topKey === null && prevKey !== null);
  }
  const shown = top ?? (leaving ? last.current : null);

  const topKeyRef = useRef(topKey);
  topKeyRef.current = topKey;
  /** The swipe already started the pop with the finger's velocity: the effect must not restart it. */
  const swiped = useRef(false);
  const onSwipeBackRef = useRef(onSwipeBack);
  onSwipeBackRef.current = onSwipeBack;

  const hidden = useCallback(() => {
    if (topKeyRef.current === null) setLeaving(false);
  }, []);
  const swipedBack = useCallback(() => {
    swiped.current = true;
    onSwipeBackRef.current();
  }, []);

  // Pushed from nothing, or popped: a replacement (another chat over a chat) moves nothing.
  const pushed = topKey !== null;
  useEffect(() => {
    if (!pushed) {
      if (swiped.current) {
        swiped.current = false;
        // The swipe's spring may have landed before this pop was rendered.
        if (progress.get() === 0) setLeaving(false);
        return;
      }
      progress.set(reduced ? withTiming(0, FADE) : withSpring(0, SPRING_SCREEN));
      return;
    }
    swiped.current = false;
    progress.set(reduced ? withTiming(1, FADE) : withSpring(1, SPRING_SCREEN));
    // `reduced` only picks the curve of the next move.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pushed, progress]);

  // Fully back on the shell: unmount the popped screen. Fires on the crossing, not per frame.
  useAnimatedReaction(
    () => progress.get() <= 0,
    (atRest, was) => {
      if (atRest && was === false) scheduleOnRN(hidden);
    },
  );

  const pan = useMemo(
    () =>
      Gesture.Pan()
        .enabled(pushed)
        // Rightward only, and only once clearly horizontal: lists and sideways code blocks keep their scroll.
        .activeOffsetX(15)
        .failOffsetY([-12, 12])
        .onStart(() => {
          cancelAnimation(progress);
          start.set(progress.get());
        })
        .onUpdate((e) => {
          const offset = (1 - start.get()) * width + e.translationX;
          // Past fully open the screen resists instead of uncovering the shell on the right.
          progress.set(1 - (offset < 0 ? rubberband(offset, width) : offset) / width);
        })
        .onEnd((e) => {
          const offset = (1 - progress.get()) * width;
          const velocity = -e.velocityX / width;
          if (offset + project(e.velocityX) > width * COMMIT) {
            progress.set(reduced ? withTiming(0, FADE) : withSpring(0, { ...SPRING_SCREEN, velocity, overshootClamping: true }));
            scheduleOnRN(swipedBack);
          } else {
            progress.set(reduced ? withTiming(1, FADE) : withSpring(1, { ...SPRING_SCREEN, velocity, overshootClamping: true }));
          }
        }),
    [progress, pushed, reduced, start, swipedBack, width],
  );

  const baseStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: reduced ? 0 : -PARALLAX * width * Math.min(Math.max(progress.get(), 0), 1) }],
  }));
  const dimStyle = useAnimatedStyle(() => ({ opacity: DIM * Math.min(Math.max(progress.get(), 0), 1) }));
  const topStyle = useAnimatedStyle(() =>
    reduced
      ? { opacity: Math.min(Math.max(progress.get(), 0), 1), transform: [{ translateX: 0 }] }
      : { opacity: 1, transform: [{ translateX: (1 - progress.get()) * width }] },
  );

  return (
    <View style={styles.fill}>
      <Animated.View
        style={[styles.fill, baseStyle]}
        // Under a pushed screen the shell is out of reach for TalkBack and touch alike, also the strip a push or
        // swipe uncovers. `top` stays set through an interactive swipe back: the shell returns once the pop commits.
        importantForAccessibility={top !== null ? "no-hide-descendants" : "auto"}
        accessibilityElementsHidden={top !== null}
        pointerEvents={top !== null ? "none" : "auto"}
      >
        {base}
      </Animated.View>
      {shown !== null ? (
        <>
          <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.dim, dimStyle]} />
          <GestureDetector gesture={pan}>
            {/* Leaving, it no longer takes touches: the shell under it is already the screen. */}
            <Animated.View style={[StyleSheet.absoluteFill, topStyle]} pointerEvents={top !== null ? "auto" : "none"}>
              <View key={shown.key} style={styles.fill}>
                {shown.node}
              </View>
            </Animated.View>
          </GestureDetector>
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  dim: { backgroundColor: "#000" },
});
