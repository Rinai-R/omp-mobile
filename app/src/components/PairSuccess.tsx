import { useEffect, useRef, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Reanimated, {
  ReduceMotion,
  cancelAnimation,
  useAnimatedProps,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import Svg, { Circle, Defs, LinearGradient, Path } from "react-native-svg";
import { haptic } from "../haptics";
import { EASE_OUT } from "../motion";
import { GRADIENT, SANS, type Palette } from "../theme";
import { stops } from "./brand";
import { t } from "../i18n/index.ts";

const AnimatedPath = Reanimated.createAnimatedComponent(Path);

const RING = 96;
/** The check's polyline in the ring's 96-unit box, and its length for the dash that draws it. */
const CHECK = "M34 49 L44 59 L63 39";
const CHECK_LENGTH = 42;
/** How long the moment holds before handing on; a tap hands on at once. */
const HOLD_MS = 900;
const HOLD_REDUCED_MS = 400;

/**
 * A computer just paired: a check draws inside a brand ring while one soft
 * pulse leaves it, with the success buzz on the frame the check starts, and
 * the computer's name below. It hands on by itself shortly after, on a tap at
 * once, or when it leaves the screen, so the pairing is never lost or held up.
 * `scrim` covers its parent (the scanner); without it, it sits inline (a sheet).
 */
export function PairSuccess({ name, c, scrim = false, onDone }: { name: string; c: Palette; scrim?: boolean; onDone: () => void }): ReactNode {
  const reduced = useReducedMotion();
  const done = useRef(false);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  const finish = useRef(() => {
    if (done.current) return;
    done.current = true;
    onDoneRef.current();
  }).current;

  // Under reduced motion it starts in its final, static state.
  const ring = useSharedValue(reduced ? 1 : 0);
  const draw = useSharedValue(reduced ? 1 : 0);
  const pulse = useSharedValue(reduced ? 1 : 0);
  const label = useSharedValue(reduced ? 1 : 0);
  const shade = useSharedValue(0);

  useEffect(() => {
    // Same frame as the check's first stroke: the buzz and the drawing are one event.
    haptic.done();
    shade.set(withTiming(1, { duration: 200, easing: EASE_OUT, reduceMotion: ReduceMotion.Never }));
    if (!reduced) {
      ring.set(withSpring(1, { dampingRatio: 0.8, duration: 420, reduceMotion: ReduceMotion.Never }));
      draw.set(withTiming(1, { duration: 360, easing: EASE_OUT, reduceMotion: ReduceMotion.Never }));
      pulse.set(withTiming(1, { duration: 500, easing: EASE_OUT, reduceMotion: ReduceMotion.Never }));
      label.set(withDelay(120, withTiming(1, { duration: 300, easing: EASE_OUT, reduceMotion: ReduceMotion.Never })));
    }
    const timer = setTimeout(finish, reduced ? HOLD_REDUCED_MS : HOLD_MS);
    return () => {
      clearTimeout(timer);
      for (const value of [ring, draw, pulse, label, shade]) cancelAnimation(value);
      finish();
    };
    // Once per mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const ringStyle = useAnimatedStyle(() => {
    const p = ring.get();
    return { opacity: Math.min(p, 1), transform: [{ scale: 0.9 + 0.1 * p }] };
  });
  const pulseStyle = useAnimatedStyle(() => {
    const p = pulse.get();
    // Reduced motion leaves it at its end: gone.
    return { opacity: 0.5 * (1 - p), transform: [{ scale: 1 + 0.6 * p }] };
  });
  const checkProps = useAnimatedProps(() => ({ strokeDashoffset: CHECK_LENGTH * (1 - draw.get()) }));
  const labelStyle = useAnimatedStyle(() => ({ opacity: label.get() }));
  const shadeStyle = useAnimatedStyle(() => ({ opacity: shade.get() }));

  return (
    <Pressable
      onPress={finish}
      style={scrim ? styles.cover : styles.inline}
      accessibilityRole="button"
      accessibilityLabel={`${name}, ${t("notify.service.connected")}`}
      accessibilityLiveRegion="polite"
    >
      {scrim ? <Reanimated.View style={[StyleSheet.absoluteFill, styles.scrim, shadeStyle]} /> : null}
      <View style={styles.badge}>
        <Reanimated.View style={[styles.pulse, { borderColor: c.accentV }, pulseStyle]} />
        <Reanimated.View style={ringStyle}>
          <Svg width={RING} height={RING} viewBox={`0 0 ${RING} ${RING}`}>
            <Defs>
              <LinearGradient id="paired" {...GRADIENT}>
                {stops(c)}
              </LinearGradient>
            </Defs>
            <Circle cx={RING / 2} cy={RING / 2} r={RING / 2 - 1.5} fill="url(#paired)" fillOpacity={c.dark ? 0.16 : 0.1} />
            <Circle cx={RING / 2} cy={RING / 2} r={RING / 2 - 1.5} fill="none" stroke="url(#paired)" strokeWidth={2.5} />
            <AnimatedPath
              d={CHECK}
              fill="none"
              stroke="url(#paired)"
              strokeWidth={5}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray={CHECK_LENGTH}
              animatedProps={checkProps}
            />
          </Svg>
        </Reanimated.View>
      </View>
      <Reanimated.View style={labelStyle}>
        <Text style={[styles.name, { color: c.fg }]} numberOfLines={1} ellipsizeMode="middle">
          {name}
        </Text>
      </Reanimated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  cover: { ...StyleSheet.absoluteFill, alignItems: "center", justifyContent: "center", paddingHorizontal: 40 },
  inline: { alignItems: "center", justifyContent: "center", paddingVertical: 28, paddingHorizontal: 16 },
  // Dims the live camera so the moment reads; the camera stays recognisable behind it.
  scrim: { backgroundColor: "#000000b8" },
  badge: { width: RING, height: RING, alignItems: "center", justifyContent: "center" },
  pulse: { ...StyleSheet.absoluteFill, borderRadius: RING / 2, borderWidth: 2 },
  name: { marginTop: 18, maxWidth: "100%", fontFamily: SANS, fontSize: 17, lineHeight: 22, fontWeight: "600", letterSpacing: -0.2, textAlign: "center" },
});
