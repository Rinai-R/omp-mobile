import type { ReactNode } from "react";
import { StyleSheet, type StyleProp, type ViewStyle } from "react-native";
import Animated, { Extrapolation, interpolate, useAnimatedStyle, type SharedValue } from "react-native-reanimated";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import { useColors } from "../theme";

/** How tall the fade is, and how far content must have gone under the edge before it is fully drawn. */
export const EDGE_FADE_HEIGHT = 18;
const FULL_AFTER = 24;

interface Props {
  /** Where the bar sits: the fade is opaque on that side and clears away from it. */
  chrome: "above" | "below";
  /**
   * How far (px) content runs on under the bar, read on the UI thread: no fade while
   * nothing is underneath, the whole fade from 24 px on. Omitted: drawn at `opacity`.
   */
  under?: SharedValue<number>;
  /** The fade's strength without `under`. */
  opacity?: number;
  /** Placement override; by default it lines the parent's edge on the bar's side. */
  style?: StyleProp<ViewStyle>;
}

/**
 * The scroll-edge effect in place of a hairline: bars are the page's own colour and
 * content scrolling under them dissolves into it, so the bar's edge is only there
 * when something is under it (Apple's scroll-edge effect, without a material).
 */
export function EdgeFade({ chrome, under, opacity = 1, style }: Props): ReactNode {
  const c = useColors();
  const shown = useAnimatedStyle(() => ({
    opacity: under === undefined ? opacity : interpolate(under.get(), [0, FULL_AFTER], [0, 1], Extrapolation.CLAMP),
  }));
  const above = chrome === "above";
  return (
    <Animated.View pointerEvents="none" style={[styles.fade, above ? styles.top : styles.bottom, style, shown]}>
      <Svg width="100%" height="100%">
        <Defs>
          <LinearGradient id="edge" x1="0" y1={above ? "0" : "1"} x2="0" y2={above ? "1" : "0"}>
            <Stop offset="0" stopColor={c.bg} stopOpacity={1} />
            <Stop offset="1" stopColor={c.bg} stopOpacity={0} />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#edge)" />
      </Svg>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  fade: { position: "absolute", left: 0, right: 0, height: EDGE_FADE_HEIGHT },
  top: { top: 0 },
  bottom: { bottom: 0 },
});
