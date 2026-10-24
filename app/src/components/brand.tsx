import { useEffect, useRef, type ReactNode } from "react";
import { Animated, Easing, StyleSheet, Text, View, type ViewStyle } from "react-native";
import Svg, { Circle, Defs, LinearGradient, Path, Rect, Stop } from "react-native-svg";
import { EASE_OUT, GRADIENT, MONO, SANS, radius, useColors, useStyles, type Palette } from "../theme";

/**
 * OMP's brand pieces and motion: the π mark in its magenta → violet → cyan
 * gradient, the wordmark, gradient and live dots, the tool spinner and the
 * streaming pulse. The gradient appears only here, so it stays rare on screen.
 */

/**
 * The three gradient stops, in the current scheme. LinearGradient reads its Stop
 * children directly, so they are returned as elements, not wrapped in a component.
 */
export function stops(c: Palette) {
  return [
    <Stop key="a" offset="0" stopColor={c.accentA} />,
    <Stop key="v" offset="0.5" stopColor={c.accentV} />,
    <Stop key="b" offset="1" stopColor={c.accentB} />,
  ];
}

/** OMP's π, as omp.sh draws it in a 64-unit box. */
export const PI_PATH = "M10 14h44v9H43v33h-9V23h-9v22h-9V23H10z";

/** A looping 0 → 1 → 0 value for a breathing opacity; still when `active` is false. */
export function usePulse(active = true, period = 1400): Animated.Value {
  const value = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!active) {
      value.setValue(0);
      return undefined;
    }
    const half = { duration: period / 2, easing: Easing.inOut(Easing.ease), useNativeDriver: true };
    const loop = Animated.loop(
      Animated.sequence([Animated.timing(value, { toValue: 1, ...half }), Animated.timing(value, { toValue: 0, ...half })]),
    );
    loop.start();
    return () => loop.stop();
  }, [active, period, value]);
  return value;
}

/** A value that plays 0 → 1 once on mount with the OMP ease-out. */
export function useEnter(duration = 320): Animated.Value {
  const value = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const run = Animated.timing(value, { toValue: 1, duration, easing: EASE_OUT, useNativeDriver: true });
    run.start();
    return () => run.stop();
  }, [duration, value]);
  return value;
}

/** The OMP mark: the π in the brand gradient, or in one `color`. */
export function BrandMark({ size = 22, color }: { size?: number; color?: string }): ReactNode {
  const c = useColors();
  return (
    <Svg width={size} height={size} viewBox="8 12 48 46">
      {color === undefined ? (
        <Defs>
          <LinearGradient id="mark" {...GRADIENT}>
            {stops(c)}
          </LinearGradient>
        </Defs>
      ) : null}
      <Path d={PI_PATH} fill={color ?? "url(#mark)"} />
    </Svg>
  );
}

/** `[mark] omp / {app}`: the brand line of a root screen. */
export function Wordmark({ app }: { app?: string }): ReactNode {
  const styles = useStyles(createStyles);
  return (
    <View style={styles.wordmark} accessible accessibilityRole="header" accessibilityLabel={app ?? "omp"}>
      <BrandMark size={24} />
      <Text style={styles.wordmarkText}>omp</Text>
      {app !== undefined ? (
        <>
          <Text style={styles.wordmarkSlash}>/</Text>
          <Text style={styles.wordmarkApp} numberOfLines={1}>
            {app}
          </Text>
        </>
      ) : null}
    </View>
  );
}

/** A small gradient dot that breathes: something is running. */
export function GradientDot({ size = 8, pulse = true }: { size?: number; pulse?: boolean }): ReactNode {
  const c = useColors();
  const value = usePulse(pulse, 1600);
  const opacity = value.interpolate({ inputRange: [0, 1], outputRange: [1, 0.4] });
  return (
    <Animated.View style={{ width: size, height: size, opacity }}>
      <Svg width={size} height={size} viewBox="0 0 10 10">
        <Defs>
          <LinearGradient id="dot" {...GRADIENT}>
            {stops(c)}
          </LinearGradient>
        </Defs>
        <Circle cx={5} cy={5} r={5} fill="url(#dot)" />
      </Svg>
    </Animated.View>
  );
}

/** A solid status dot; `ping` sends a fading ring out of it, like my.omp.sh's live dot. */
export function LiveDot({ color, size = 8, ping = false }: { color: string; size?: number; ping?: boolean }): ReactNode {
  const value = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!ping) return undefined;
    const loop = Animated.loop(
      Animated.timing(value, { toValue: 1, duration: 1600, easing: EASE_OUT, useNativeDriver: true }),
    );
    loop.start();
    return () => loop.stop();
  }, [ping, value]);
  const dot = { width: size, height: size, borderRadius: size / 2, backgroundColor: color };
  return (
    <View style={{ width: size, height: size }}>
      {ping ? (
        <Animated.View
          style={[
            StyleSheet.absoluteFill,
            dot,
            {
              opacity: value.interpolate({ inputRange: [0, 1], outputRange: [0.55, 0] }),
              transform: [{ scale: value.interpolate({ inputRange: [0, 1], outputRange: [1, 2.6] }) }],
            },
          ]}
        />
      ) : null}
      <View style={dot} />
    </View>
  );
}

/** A dot that breathes in place: waiting, reconnecting. */
export function PulseDot({ color, size = 8 }: { color: string; size?: number }): ReactNode {
  const value = usePulse(true, 1200);
  const opacity = value.interpolate({ inputRange: [0, 1], outputRange: [1, 0.3] });
  return <Animated.View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color, opacity }} />;
}

/** The running tool's spinner: a faint ring with an accent arc (`tv-spin`). */
export function Spinner({ size = 10, color }: { size?: number; color?: string }): ReactNode {
  const c = useColors();
  const value = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(value, { toValue: 1, duration: 700, easing: Easing.linear, useNativeDriver: true }),
    );
    loop.start();
    return () => loop.stop();
  }, [value]);
  const rotate = value.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] });
  const ring: ViewStyle = {
    width: size,
    height: size,
    borderRadius: size / 2,
    borderWidth: 1.5,
    borderColor: c.selected,
    borderTopColor: color ?? c.accent,
  };
  return <Animated.View style={[ring, { transform: [{ rotate }] }]} />;
}

/** The streaming mark under a reply: a short gradient bar that breathes. */
export function StreamPulse(): ReactNode {
  const c = useColors();
  const styles = useStyles(createStyles);
  const value = usePulse(true, 1400);
  const opacity = value.interpolate({ inputRange: [0, 1], outputRange: [1, 0.35] });
  const scaleX = value.interpolate({ inputRange: [0, 1], outputRange: [1, 0.6] });
  return (
    <View style={styles.stream} accessibilityLabel="OMP is working">
      <Animated.View style={[styles.streamBar, { opacity, transform: [{ scaleX }] }]}>
        <Svg width={STREAM_W} height={3}>
          <Defs>
            <LinearGradient id="stream" x1="0" y1="0" x2="1" y2="0">
              {stops(c)}
            </LinearGradient>
          </Defs>
          <Rect x={0} y={0} width={STREAM_W} height={3} rx={1.5} fill="url(#stream)" />
        </Svg>
      </Animated.View>
    </View>
  );
}

const STREAM_W = 28;

/** A gradient hairline frame around `children`: the empty-state mark. */
export function GradientTile({ size = 56, children }: { size?: number; children: ReactNode }): ReactNode {
  const c = useColors();
  const r = radius.xl;
  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
        <Defs>
          <LinearGradient id="tile" x1="0" y1="0" x2="1" y2="1">
            {stops(c)}
          </LinearGradient>
        </Defs>
        <Rect x={0} y={0} width={size} height={size} rx={r} fill="url(#tile)" opacity={0.1} />
        <Rect x={0.5} y={0.5} width={size - 1} height={size - 1} rx={r - 0.5} fill="none" stroke="url(#tile)" strokeWidth={1} />
      </Svg>
      {children}
    </View>
  );
}

/** A filled gradient surface the size of its parent (clip it with the parent's radius), for the send button. */
export function GradientFill(): ReactNode {
  const c = useColors();
  return (
    <Svg style={StyleSheet.absoluteFill} width="100%" height="100%" preserveAspectRatio="none" viewBox="0 0 100 100">
      <Defs>
        <LinearGradient id="fill" {...GRADIENT}>
          {stops(c)}
        </LinearGradient>
      </Defs>
      <Rect x={0} y={0} width={100} height={100} fill="url(#fill)" />
    </Svg>
  );
}

function createStyles(c: Palette) {
  return {
    wordmark: { flexDirection: "row", alignItems: "center", gap: 10, minWidth: 0 },
    wordmarkText: { fontFamily: SANS, fontSize: 26, lineHeight: 32, fontWeight: "600", letterSpacing: -0.8, color: c.fg },
    wordmarkSlash: { fontFamily: SANS, fontSize: 22, lineHeight: 32, fontWeight: "400", color: c.fgGhost },
    wordmarkApp: { flexShrink: 1, fontFamily: MONO, fontSize: 13, lineHeight: 32, fontWeight: "400", color: c.fgFaint },
    stream: { height: 18, justifyContent: "center" },
    streamBar: { width: STREAM_W, height: 3, transformOrigin: "left" },
  } as const;
}
