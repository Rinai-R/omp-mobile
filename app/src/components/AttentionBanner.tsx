import { useCallback, useEffect, useMemo, useRef, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Reanimated, {
  Extrapolation,
  ReduceMotion,
  cancelAnimation,
  interpolate,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { scheduleOnRN } from "react-native-worklets";
import type { Attention } from "../../modules/omp-attention/src";
import { t, type Key } from "../i18n/index.ts";
import { EASE_OUT, SPRING_SETTLE, SPRING_SHEET, SPRING_SNAP, project, rubberband } from "../motion";
import { SANS, MONO, radius, useColors, useStyles, type Palette } from "../theme";
import { GradientDot, LiveDot } from "./brand";
import { CloseGlyph } from "./icons";

const HEADLINE: Record<string, Key> = {
  approval: "attention.approval",
  question: "attention.question",
  done: "attention.done",
  failed: "attention.failed",
};

/** Waiting items stay until handled; results slide away after a few seconds. */
const RESULT_MS = 6_000;
/** The card's height before it is measured: about two lines of detail. */
const GUESS_HEIGHT = 96;
/** How far a downward pull may stretch before it barely moves. */
const PULL = 60;
/** Fade only, under reduced motion: in, and out about a fifth quicker. */
const FADE_IN = { duration: 200, easing: EASE_OUT, reduceMotion: ReduceMotion.Never };
const FADE_OUT = { duration: 160, easing: EASE_OUT, reduceMotion: ReduceMotion.Never };

interface Props {
  attention: Attention;
  onOpen: (attention: Attention) => void;
  onDismiss: (attention: Attention) => void;
}

/**
 * In-app pop-up for a session that is not on screen: an overlay card under the
 * status bar. It drops in from above the screen, follows a finger 1:1, and a
 * swipe up (or a flick) sends it back the way it came.
 */
export function AttentionBanner({ attention, onOpen, onDismiss }: Props): ReactNode {
  const styles = useStyles(createStyles);
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();
  const waiting = attention.kind === "approval" || attention.kind === "question";
  /** The card's offset from its resting place; `travel` is how far up it must go to be off screen. */
  const y = useSharedValue(0);
  /** Where `y` was when a finger caught the card. */
  const start = useSharedValue(0);
  const travel = useSharedValue(insets.top + 8 + GUESS_HEIGHT + 24);
  /** Its opacity under reduced motion, where nothing travels. */
  const fade = useSharedValue(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const leaving = useRef(false);

  const finish = useCallback(() => onDismiss(attention), [attention, onDismiss]);
  /** Leave the way it came in, then let the owner drop it; `velocity` carries a release into the exit. */
  const leave = useCallback(
    (velocity = 0) => {
      if (leaving.current) return;
      leaving.current = true;
      clearTimeout(timer.current);
      const done = (finished?: boolean) => {
        "worklet";
        if (finished) scheduleOnRN(finish);
      };
      if (reduced) fade.set(withTiming(0, FADE_OUT, done));
      else y.set(withSpring(-travel.get(), { ...SPRING_SHEET, velocity, overshootClamping: true }, done));
    },
    [fade, finish, reduced, travel, y],
  );
  /** A result goes by itself after a while; a finger on it holds it (see the pan), and letting go starts the wait again. */
  const arm = useCallback(() => {
    // A card caught on its way out and let go is back in place: it can leave again.
    leaving.current = false;
    clearTimeout(timer.current);
    if (!waiting) timer.current = setTimeout(() => leave(), RESULT_MS);
  }, [leave, waiting]);
  const hold = useCallback(() => clearTimeout(timer.current), []);

  useEffect(() => {
    // Starts from above the screen so it arrives along the path it leaves by.
    if (reduced) {
      y.set(0);
      fade.set(0);
      fade.set(withTiming(1, FADE_IN));
    } else {
      fade.set(1);
      y.set(-travel.get());
      y.set(withSpring(0, SPRING_SETTLE));
    }
    arm();
    return () => clearTimeout(timer.current);
    // A new attention plays the entrance again; `arm` changes with it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attention]);

  const onLayout = useCallback(
    (event: LayoutChangeEvent) => travel.set(insets.top + 8 + event.nativeEvent.layout.height + 24),
    [insets.top, travel],
  );

  const pan = useMemo(
    () =>
      Gesture.Pan()
        // Vertical intent only: a sideways drag stays with whatever is underneath.
        .activeOffsetY([-8, 8])
        .failOffsetX([-24, 24])
        .onStart(() => {
          // Catch it mid-flight (even leaving): the drag continues from where the card is on screen.
          cancelAnimation(y);
          start.set(y.get());
          scheduleOnRN(hold);
        })
        .onUpdate((event) => {
          // 1:1 upward; downward resists, there is nowhere further for it to go.
          const next = start.get() + event.translationY;
          y.set(next <= 0 ? next : rubberband(next, PULL));
        })
        .onEnd((event) => {
          // The flick decides, not just the distance: a short fast swipe up dismisses.
          const projected = y.get() + project(event.velocityY);
          if (projected < -travel.get() / 2) {
            scheduleOnRN(leave, event.velocityY);
          } else {
            y.set(withSpring(0, { ...SPRING_SNAP, velocity: event.velocityY }));
            scheduleOnRN(arm);
          }
        }),
    [arm, hold, leave, start, travel, y],
  );

  const motion = useAnimatedStyle(() => {
    const at = y.get();
    // It clears as it rises, so its shadow never hangs under the status bar.
    const opacity = interpolate(at, [-travel.get(), -travel.get() * 0.4, 0], [0, 1, 1], Extrapolation.CLAMP);
    return { opacity: opacity * fade.get(), transform: [{ translateY: at }] };
  });
  const open = useCallback(() => onOpen(attention), [attention, onOpen]);
  const dismiss = useCallback(() => leave(), [leave]);
  const headlineKey = HEADLINE[attention.kind];
  const headline = headlineKey !== undefined ? t(headlineKey) : t("common.session");
  const title = attention.sessionTitle || t("common.session");

  return (
    <Reanimated.View style={[styles.wrap, { top: insets.top + 8 }, motion]} pointerEvents="box-none">
      <GestureDetector gesture={pan}>
        <Pressable
          onPress={open}
          onLayout={onLayout}
          style={({ pressed }) => [styles.card, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel={t("attention.openA11y", { headline, title })}
        >
          <View style={styles.dot}>
            {waiting ? (
              <GradientDot size={8} />
            ) : (
              <LiveDot color={attention.kind === "failed" ? colors.err : colors.ok} size={8} />
            )}
          </View>
          <View style={styles.body}>
            <Text style={styles.headline} numberOfLines={1}>
              {headline} · {title}
            </Text>
            {attention.text !== "" ? (
              <Text style={styles.detail} numberOfLines={2}>
                {attention.text}
              </Text>
            ) : null}
            <Text style={styles.machine} numberOfLines={1}>
              {attention.machineName}
            </Text>
          </View>
          <Pressable
            onPress={dismiss}
            hitSlop={12}
            style={styles.close}
            accessibilityRole="button"
            accessibilityLabel={t("attention.dismiss")}
          >
            <CloseGlyph size={15} color={colors.fgFaint} />
          </Pressable>
        </Pressable>
      </GestureDetector>
    </Reanimated.View>
  );
}

function createStyles(c: Palette) {
  return {
    wrap: { position: "absolute", left: 12, right: 12, zIndex: 100, alignItems: "center" },
    card: {
      width: "100%",
      maxWidth: 600,
      flexDirection: "row",
      alignItems: "flex-start",
      gap: 11,
      paddingVertical: 11,
      paddingLeft: 14,
      paddingRight: 10,
      borderRadius: radius.lg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.borderStrong,
      borderTopColor: c.edgeTop,
      backgroundColor: c.overlay,
      elevation: 8,
      shadowColor: "#000",
      shadowOpacity: c.dark ? 0.5 : 0.14,
      shadowRadius: 18,
      shadowOffset: { width: 0, height: 8 },
    },
    pressed: { backgroundColor: c.raised },
    dot: { paddingTop: 6 },
    body: { flex: 1, minWidth: 0, gap: 2 },
    headline: { fontFamily: SANS, fontSize: 14, lineHeight: 19, fontWeight: "600", letterSpacing: -0.1, color: c.fg },
    detail: { fontFamily: SANS, fontSize: 13, lineHeight: 18, color: c.fgMuted },
    machine: { fontFamily: MONO, fontSize: 11, lineHeight: 15, color: c.fgFaint },
    close: { padding: 4 },
  } as const;
}
