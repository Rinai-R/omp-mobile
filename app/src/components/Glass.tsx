import { useRef, type ReactNode, type RefObject } from "react";
import { Platform, StyleSheet, View, type StyleProp, type View as ViewType, type ViewProps, type ViewStyle } from "react-native";
import { BlurTargetView, BlurView } from "expo-blur";
import Animated, { Extrapolation, interpolate, useAnimatedStyle, type SharedValue } from "react-native-reanimated";
import { useColors } from "../theme";

/**
 * Blur strength of every glass bar (expo-blur intensity; Android divides it
 * by 4 into a ~10 px radius): what passes under keeps its shape as soft
 * smudges, so the bar reads as glass rather than a gray slab, while the bar's
 * own title stays legible over a thin tint.
 */
export const GLASS_BLUR = 40;
/** The blur exists from Android 12 (RenderEffect); before that the tint alone has to carry legibility. */
const BLURS = Platform.OS !== "android" || Number(Platform.Version) >= 31;
/** How far (px) content must have run on under a bar before its hairline is fully drawn. */
const EDGE_FULL_AFTER = 24;

/** A ref for the content a glass bar blurs: pass it to `GlassTarget` and to each `Glass` over it. */
export function useBlurTarget(): RefObject<ViewType | null> {
  return useRef<ViewType | null>(null);
}

/**
 * What glass bars blur: the scrolling content, and only that. A bar must sit
 * outside the target it blurs (a sibling over it), never inside it. The target
 * is painted the page colour: the blur reads transparent pixels as black,
 * which would muddy a light page into gray.
 */
export function GlassTarget({ target, style, children }: { target: RefObject<ViewType | null>; style?: StyleProp<ViewStyle>; children: ReactNode }): ReactNode {
  const c = useColors();
  return (
    <BlurTargetView ref={target} style={[style ?? styles.fill, { backgroundColor: c.bg }]}>
      {children}
    </BlurTargetView>
  );
}

interface GlassProps extends ViewProps {
  /** The `GlassTarget` under the bar. */
  target: RefObject<ViewType | null>;
  /** The bar's side that meets content: its hairline is drawn there. */
  edge: "top" | "bottom";
  /**
   * Content run on under the bar (px), on the UI thread: the hairline appears only while
   * something is underneath, fully from 24 px on. Omitted: drawn whenever the material is.
   */
  under?: SharedValue<number>;
  /** The material's presence, 0 to 1 (blur and tint fade together); omitted: always there. */
  material?: SharedValue<number>;
}

/**
 * Chrome as material: content passes under a blurred, tinted bar instead of
 * stopping at an opaque one. Over a real blur the tint is thin (`glassThin`),
 * so what passes under shows through as colour; without one (below Android 12)
 * the thicker `glass` tint alone carries legibility.
 */
export function Glass({ target, edge, under, material, style, children, ...rest }: GlassProps): ReactNode {
  const c = useColors();
  const backing = useAnimatedStyle(() => ({ opacity: material === undefined ? 1 : material.get() }));
  const line = useAnimatedStyle(() => {
    const present = material === undefined ? 1 : material.get();
    const covered = under === undefined ? 1 : interpolate(under.get(), [0, EDGE_FULL_AFTER], [0, 1], Extrapolation.CLAMP);
    return { opacity: present * covered };
  });
  return (
    <View style={style} {...rest}>
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, backing]}>
        <BlurView
          blurTarget={target}
          blurMethod="dimezisBlurViewSdk31Plus"
          intensity={GLASS_BLUR}
          // The chrome variants add the least native tint (black or near-white); ours does the rest.
          tint={c.dark ? "systemChromeMaterialDark" : "light"}
          style={StyleSheet.absoluteFill}
        />
        <View style={[StyleSheet.absoluteFill, { backgroundColor: BLURS ? c.glassThin : c.glass }]} />
      </Animated.View>
      <Animated.View pointerEvents="none" style={[styles.edge, edge === "top" ? styles.top : styles.bottom, { backgroundColor: c.glassEdge }, line]} />
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  edge: { position: "absolute", left: 0, right: 0, height: StyleSheet.hairlineWidth },
  top: { top: 0 },
  bottom: { bottom: 0 },
});
