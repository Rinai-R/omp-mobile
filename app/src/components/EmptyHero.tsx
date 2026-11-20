import { useEffect, type ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import Reanimated, {
  ReduceMotion,
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
  type WithTimingConfig,
} from "react-native-reanimated";
import Svg, { Circle, Defs, LinearGradient, RadialGradient, Rect, Stop } from "react-native-svg";
import { EASE_OUT } from "../motion";
import { GRADIENT, MONO, SANS, useColors, useStyles, type Palette } from "../theme";
import { BrandMark, stops } from "./brand";
import { t } from "../i18n/index.ts";

/**
 * A new session's invitation: the π in a glass tile over a soft brand aurora,
 * the prompt and the folder it runs in. It enters once on mount: the aurora
 * fades, the mark settles in, the prompt rises just behind it and the folder
 * fades last. Nothing in it takes touches, so it never holds back the composer.
 */
export function EmptyHero({ cwd, waiting }: { cwd: string; waiting: boolean }): ReactNode {
  const c = useColors();
  const styles = useStyles(createStyles);
  const reduced = useReducedMotion();
  const aurora = useSharedValue(0);
  const mark = useSharedValue(0);
  const heading = useSharedValue(0);
  const folder = useSharedValue(0);

  useEffect(() => {
    if (reduced) {
      // The group appears together, without travel.
      const fade: WithTimingConfig = { duration: 200, easing: EASE_OUT, reduceMotion: ReduceMotion.Never };
      for (const value of [aurora, mark, heading, folder]) value.set(withTiming(1, fade));
    } else {
      aurora.set(withTiming(1, { duration: 600, easing: EASE_OUT, reduceMotion: ReduceMotion.Never }));
      mark.set(withSpring(1, { dampingRatio: 0.8, duration: 450, reduceMotion: ReduceMotion.Never }));
      heading.set(withDelay(70, withTiming(1, { duration: 380, easing: EASE_OUT, reduceMotion: ReduceMotion.Never })));
      folder.set(withDelay(120, withTiming(1, { duration: 300, easing: EASE_OUT, reduceMotion: ReduceMotion.Never })));
    }
    return () => {
      for (const value of [aurora, mark, heading, folder]) cancelAnimation(value);
    };
    // Once per mount: a change of the setting mid-entrance does not replay it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const auroraStyle = useAnimatedStyle(() => ({ opacity: aurora.get() }));
  const markStyle = useAnimatedStyle(() => {
    const p = mark.get();
    // The spring overshoots a little: the scale carries it, the opacity stops at 1.
    return { opacity: Math.min(p, 1), transform: [{ scale: reduced ? 1 : 0.92 + 0.08 * p }] };
  });
  const headingStyle = useAnimatedStyle(() => {
    const p = heading.get();
    return { opacity: p, transform: [{ translateY: reduced ? 0 : (1 - p) * 10 }] };
  });
  const folderStyle = useAnimatedStyle(() => ({ opacity: folder.get() }));

  return (
    <View style={styles.root} pointerEvents="none">
      {/* Waiting for the computer, the whole invitation stays dimmed: nothing can be sent yet. */}
      <View style={waiting ? styles.contentWaiting : styles.content}>
        <Reanimated.View style={[styles.aurora, auroraStyle]}>
          <Aurora c={c} />
        </Reanimated.View>
        <Reanimated.View style={markStyle}>
          <GlassTile c={c} />
        </Reanimated.View>
        <Reanimated.Text style={[styles.title, headingStyle]}>{t("chat.emptyPrompt")}</Reanimated.Text>
        <Reanimated.View style={[styles.cwdWrap, folderStyle]}>
          <Text style={styles.cwd} numberOfLines={1} ellipsizeMode="middle">
            {cwd}
          </Text>
        </Reanimated.View>
      </View>
    </View>
  );
}

const TILE = 104;
const TILE_RADIUS = 30;
const MARK = 64;
const AURORA = 420;

/**
 * Three soft brand lights, off-centre behind the mark. The falloff of each
 * radial gradient stands in for blur. Light mode keeps them faint: saturated
 * colour at dark-mode strength turns the pale ground muddy.
 */
function Aurora({ c }: { c: Palette }): ReactNode {
  const strength = c.dark ? { a: 0.26, v: 0.24, b: 0.18 } : { a: 0.13, v: 0.12, b: 0.11 };
  const light = (id: string, color: string, opacity: number) => (
    <RadialGradient id={id} cx="50%" cy="50%" r="50%">
      <Stop offset="0" stopColor={color} stopOpacity={opacity} />
      <Stop offset="0.45" stopColor={color} stopOpacity={opacity * 0.45} />
      <Stop offset="1" stopColor={color} stopOpacity={0} />
    </RadialGradient>
  );
  return (
    <Svg width={AURORA} height={AURORA}>
      <Defs>
        {light("heroA", c.accentA, strength.a)}
        {light("heroV", c.accentV, strength.v)}
        {light("heroB", c.accentB, strength.b)}
      </Defs>
      <Circle cx={150} cy={160} r={150} fill="url(#heroA)" />
      <Circle cx={272} cy={196} r={140} fill="url(#heroV)" />
      <Circle cx={196} cy={286} r={126} fill="url(#heroB)" />
    </Svg>
  );
}

/** The mark's glass: a translucent pane, light catching its top edge, framed by a faint brand hairline. */
function GlassTile({ c }: { c: Palette }): ReactNode {
  return (
    <View style={{ width: TILE, height: TILE, alignItems: "center", justifyContent: "center" }}>
      <Svg width={TILE} height={TILE} style={StyleSheet.absoluteFill}>
        <Defs>
          <LinearGradient id="heroSheen" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#ffffff" stopOpacity={c.dark ? 0.1 : 0.7} />
            <Stop offset="1" stopColor="#ffffff" stopOpacity={0} />
          </LinearGradient>
          <LinearGradient id="heroEdge" {...GRADIENT}>
            {stops(c)}
          </LinearGradient>
        </Defs>
        <Rect x={0} y={0} width={TILE} height={TILE} rx={TILE_RADIUS} fill={c.dark ? "#16161ab3" : "#ffffffa6"} />
        <Rect x={0} y={0} width={TILE} height={TILE * 0.6} rx={TILE_RADIUS} fill="url(#heroSheen)" />
        <Rect
          x={0.5}
          y={0.5}
          width={TILE - 1}
          height={TILE - 1}
          rx={TILE_RADIUS - 0.5}
          fill="none"
          stroke="url(#heroEdge)"
          strokeOpacity={c.dark ? 0.55 : 0.45}
          strokeWidth={1}
        />
      </Svg>
      <BrandMark size={MARK} />
    </View>
  );
}

function createStyles(c: Palette) {
  const content = { alignItems: "center", maxWidth: "100%" } as const;
  return {
    root: { ...StyleSheet.absoluteFill, alignItems: "center", justifyContent: "center", paddingHorizontal: 40 },
    content,
    contentWaiting: { ...content, opacity: 0.45 },
    // Centred on the tile, wider than the screen's padding allows: the lights spill past it.
    aurora: {
      position: "absolute",
      top: TILE / 2 - AURORA / 2,
      left: "50%",
      marginLeft: -AURORA / 2,
      width: AURORA,
      height: AURORA,
    },
    title: {
      marginTop: 24,
      fontFamily: SANS,
      fontSize: 28,
      lineHeight: 34,
      fontWeight: "600",
      letterSpacing: -0.6,
      color: c.fg,
      textAlign: "center",
    },
    cwdWrap: { marginTop: 8, maxWidth: "100%" },
    cwd: { fontFamily: MONO, fontSize: 11.5, lineHeight: 16, fontWeight: "400", color: c.fgFaint, textAlign: "center" },
  } as const;
}
