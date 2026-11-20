import type { ReactNode } from "react";
import { StyleSheet, View, type ViewProps } from "react-native";
import Animated, { Extrapolation, interpolate, useAnimatedStyle, type SharedValue } from "react-native-reanimated";
import { useColors } from "../theme";

/** How far (px) content must have run on under a bar before its hairline is fully drawn. */
const EDGE_FULL_AFTER = 24;

interface GlassProps extends ViewProps {
  /** The bar's side that meets content: its hairline is drawn there. */
  edge: "top" | "bottom";
  /**
   * Content run on under the bar (px), on the UI thread: the hairline appears only while
   * something is underneath, fully from 24 px on. Omitted: drawn whenever the material is.
   */
  under?: SharedValue<number>;
  /** The material's presence, 0 to 1; omitted: always there. */
  material?: SharedValue<number>;
}

/**
 * Chrome over scrolling content: an opaque bar in the page's colour, so the
 * page simply continues under the status bar, header and composer, and a
 * hairline appears only once content runs on under it. Neither native blur
 * (grey/white bars on some Android builds) nor a translucent tint (text
 * showing through as noise) holds up across devices.
 */
export function Glass({ edge, under, material, style, children, ...rest }: GlassProps): ReactNode {
  const c = useColors();
  const backing = useAnimatedStyle(() => ({ opacity: material === undefined ? 1 : material.get() }));
  const line = useAnimatedStyle(() => {
    const present = material === undefined ? 1 : material.get();
    const covered = under === undefined ? 1 : interpolate(under.get(), [0, EDGE_FULL_AFTER], [0, 1], Extrapolation.CLAMP);
    return { opacity: present * covered };
  });
  return (
    <View style={style} {...rest}>
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: c.glass }, backing]} />
      <Animated.View pointerEvents="none" style={[styles.edge, edge === "top" ? styles.top : styles.bottom, { backgroundColor: c.glassEdge }, line]} />
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  edge: { position: "absolute", left: 0, right: 0, height: StyleSheet.hairlineWidth },
  top: { top: 0 },
  bottom: { bottom: 0 },
});
