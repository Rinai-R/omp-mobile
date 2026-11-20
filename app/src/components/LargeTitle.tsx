import { useCallback, useRef, type ReactNode, type RefObject } from "react";
import { Text, View, type LayoutChangeEvent, type View as ViewType } from "react-native";
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useDerivedValue,
  useReducedMotion,
  useSharedValue,
  type SharedValue,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { SCALE, type as typeScale, useStyles, type Palette } from "../theme";
import { Glass } from "./Glass";
import { PressableScale } from "./ui";

/** The glass top bar's height under the status bar: the large title's page starts below it. */
export const BAR_HEIGHT = 44;
/** Scroll over which the bar's material arrives: invisible at the top of the page, solid glass 40 px in. */
const MATERIAL_AFTER = 40;
/** The large title fades out as it passes under the bar; the inline title fades in as it finishes. */
const LARGE_FADE: readonly [number, number] = [6, 38];
const INLINE_FADE: readonly [number, number] = [30, 48];
/** Pulled down past the top the large title grows toward 1.04, never reaching it: resistance, not a stop. */
const PULL_GROWTH = 0.04;
const PULL_HALF = 80;

/**
 * A large-title page's scroll, on the UI thread: `y` drives the title's
 * collapse, `under` how much content runs on under a bottom bar (the tab bar's
 * hairline). Spread `props` on an `Animated.ScrollView`.
 * @param under - a shared value to write it to; the tab bar reads the current tab's.
 */
export function usePageScroll(under?: SharedValue<number>) {
  const y = useSharedValue(0);
  const own = useSharedValue(0);
  const below = under ?? own;
  const sizes = useRef({ content: 0, view: 0 });
  const onScroll = useAnimatedScrollHandler(
    (event) => {
      y.set(event.contentOffset.y);
      below.set(Math.max(0, event.contentSize.height - event.layoutMeasurement.height - event.contentOffset.y));
    },
    [below],
  );
  // Content that outgrows the page without a scroll still counts as under the bar.
  const measured = useCallback(() => {
    below.set(Math.max(0, sizes.current.content - sizes.current.view - y.get()));
  }, [below, y]);
  const onLayout = useCallback(
    (event: LayoutChangeEvent) => {
      sizes.current.view = event.nativeEvent.layout.height;
      measured();
    },
    [measured],
  );
  const onContentSizeChange = useCallback(
    (_: number, height: number) => {
      sizes.current.content = height;
      measured();
    },
    [measured],
  );
  return { y, props: { onScroll, scrollEventThrottle: 16, onLayout, onContentSizeChange } };
}

/** How far a large-title page's content starts below the screen's top: the status bar and the glass bar. */
export function usePageTop(): number {
  return useSafeAreaInsets().top + BAR_HEIGHT;
}

/**
 * The glass bar over a large-title page: at the top of the page it is not
 * there at all (no blur, no tint); over the first 40 px of scroll the material
 * arrives, and the inline title fades in as the large one finishes passing under.
 */
export function PageBar({
  target,
  y,
  title,
  left,
  right,
}: {
  target: RefObject<ViewType | null>;
  y: SharedValue<number>;
  title: string;
  left?: ReactNode;
  right?: ReactNode;
}): ReactNode {
  const styles = useStyles(createStyles);
  const insets = useSafeAreaInsets();
  const material = useDerivedValue(() => interpolate(y.get(), [0, MATERIAL_AFTER], [0, 1], Extrapolation.CLAMP));
  const inline = useAnimatedStyle(() => ({ opacity: interpolate(y.get(), INLINE_FADE, [0, 1], Extrapolation.CLAMP) }));
  return (
    <Glass target={target} edge="bottom" material={material} style={[styles.bar, { height: insets.top + BAR_HEIGHT, paddingTop: insets.top }]}>
      <View style={styles.side}>{left}</View>
      {/* The large title is the heading; this copy is only its collapsed form. */}
      <Animated.Text
        style={[styles.inline, inline]}
        numberOfLines={1}
        maxFontSizeMultiplier={SCALE.ui}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        {title}
      </Animated.Text>
      <View style={[styles.side, styles.sideEnd]}>{right}</View>
    </Glass>
  );
}

/**
 * A page's large title, first in its scroll content: it scrolls up under the
 * glass bar and fades as it goes. Pulled down past the top (where the platform
 * reports overscroll) it grows a little from its left edge, with resistance;
 * under reduced motion it only tracks the scroll, without growing.
 */
export function LargeTitle({
  y,
  title,
  accessory,
  children,
  onPress,
  accessibilityLabel,
}: {
  y: SharedValue<number>;
  title: string;
  /** Beside the title: the computer switcher's chevron. */
  accessory?: ReactNode;
  /** Under the title: a status line. */
  children?: ReactNode;
  onPress?: () => void;
  accessibilityLabel?: string;
}): ReactNode {
  const styles = useStyles(createStyles);
  const reduced = useReducedMotion();
  const collapse = useAnimatedStyle(() => {
    const at = y.get();
    const pull = Math.max(0, -at);
    const scale = reduced ? 1 : 1 + (PULL_GROWTH * pull) / (pull + PULL_HALF);
    return { opacity: interpolate(at, LARGE_FADE, [1, 0], Extrapolation.CLAMP), transform: [{ scale }] };
  });
  const row = (
    <View style={styles.row}>
      <Text style={styles.large} numberOfLines={1} maxFontSizeMultiplier={SCALE.heading} accessibilityRole="header">
        {title}
      </Text>
      {accessory}
    </View>
  );
  return (
    <Animated.View style={[styles.block, collapse]}>
      {onPress !== undefined ? (
        <PressableScale onPress={onPress} scale={0.985} style={styles.press} accessibilityRole="button" accessibilityLabel={accessibilityLabel}>
          {row}
          {children}
        </PressableScale>
      ) : (
        <>
          {row}
          {children}
        </>
      )}
    </Animated.View>
  );
}

function createStyles(c: Palette) {
  return {
    bar: { position: "absolute", top: 0, left: 0, right: 0, flexDirection: "row", alignItems: "center" },
    // Equal sides keep the inline title centred on the screen whatever the actions.
    side: { width: 92, flexDirection: "row", alignItems: "center", paddingHorizontal: 4 },
    sideEnd: { justifyContent: "flex-end" },
    inline: { flex: 1, ...typeScale.inlineTitle, color: c.fg, textAlign: "center" },
    block: { alignSelf: "flex-start", maxWidth: "100%", paddingHorizontal: 20, paddingTop: 2, paddingBottom: 14, transformOrigin: "left center" },
    press: { alignSelf: "flex-start", maxWidth: "100%" },
    row: { flexDirection: "row", alignItems: "center", gap: 6, maxWidth: "100%" },
    large: { flexShrink: 1, ...typeScale.largeTitle, color: c.fg },
  } as const;
}
