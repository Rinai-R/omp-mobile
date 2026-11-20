import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
  type GestureResponderEvent,
  type Insets,
  type KeyboardTypeOptions,
  type LayoutChangeEvent,
  type PressableProps,
  type ScrollViewProps,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { Gesture, GestureDetector, GestureHandlerRootView, type PanGesture } from "react-native-gesture-handler";
import { useReanimatedKeyboardAnimation } from "react-native-keyboard-controller";
import Animated, {
  Extrapolation,
  cancelAnimation,
  interpolate,
  scrollTo,
  useAnimatedRef,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
  ReduceMotion,
  type SharedValue,
  type WithSpringConfig,
  type WithTimingConfig,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { HEADER_HEIGHT, HIT, MONO, SANS, radius, useColors, useStyles, type Palette } from "../theme";
import { EASE_OUT, PRESS_IN, PRESS_OUT, PRESS_SCALE, QUICK, SPRING_SHEET, SPRING_SNAP, project, rubberband } from "../motion";
import type { Dot } from "../probe";
import { GradientTile, LiveDot, Spinner, Wordmark } from "./brand";
import { BackGlyph, ChevronDownGlyph, ChevronGlyph, CloseGlyph } from "./icons";
import { t } from "../i18n/index.ts";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/** A full-width row is a large surface: it sinks less than a button. */
const ROW_PRESS_SCALE = 0.985;
/** A 22 px chip's touch target grown to 44 without growing the chip. */
const CHIP_SLOP: Insets = { top: 11, bottom: 11, left: 4, right: 4 };

type PressableScaleProps = Omit<PressableProps, "style" | "children"> & {
  style?: StyleProp<ViewStyle>;
  /** Merged while the finger is down: a highlight on top of the scale. */
  pressedStyle?: StyleProp<ViewStyle>;
  scale?: number;
  children?: ReactNode | ((state: { pressed: boolean }) => ReactNode);
};

/**
 * A Pressable that sinks on press-in and comes back on press-out, on the UI
 * thread: feedback the moment the finger lands, the commit on release.
 * Reduced motion drops the scale and keeps `pressedStyle`.
 */
export function PressableScale({
  style,
  pressedStyle,
  scale = PRESS_SCALE,
  children,
  onPressIn,
  onPressOut,
  pressRetentionOffset = 16,
  ...rest
}: PressableScaleProps): ReactNode {
  const reduced = useReducedMotion();
  const sink = useSharedValue(1);
  const [pressed, setPressed] = useState(false);
  const scaled = useAnimatedStyle(() => ({ transform: [{ scale: sink.get() }] }));
  const pressIn = useCallback(
    (event: GestureResponderEvent) => {
      if (!reduced) sink.set(withTiming(scale, PRESS_IN));
      setPressed(true);
      onPressIn?.(event);
    },
    [onPressIn, reduced, scale, sink],
  );
  const pressOut = useCallback(
    (event: GestureResponderEvent) => {
      sink.set(withTiming(1, PRESS_OUT));
      setPressed(false);
      onPressOut?.(event);
    },
    [onPressOut, sink],
  );
  return (
    <AnimatedPressable
      {...rest}
      pressRetentionOffset={pressRetentionOffset}
      onPressIn={pressIn}
      onPressOut={pressOut}
      style={[style, pressed && pressedStyle, scaled]}
    >
      {typeof children === "function" ? children({ pressed }) : children}
    </AnimatedPressable>
  );
}

export function Button({
  label,
  onPress,
  disabled = false,
  busy = false,
  kind = "primary",
  icon,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  busy?: boolean;
  kind?: "primary" | "plain" | "danger";
  icon?: ReactNode;
}): ReactNode {
  const styles = useStyles(createStyles);
  const colors = useColors();
  const foreground = kind === "primary" ? colors.bg : kind === "danger" ? colors.err : colors.fg;
  return (
    <PressableScale
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled || busy}
      style={[kind === "primary" ? styles.primary : kind === "danger" ? styles.danger : styles.secondary, disabled && styles.disabled]}
      pressedStyle={styles.buttonPressed}
    >
      {busy ? (
        <ActivityIndicator size="small" color={foreground} />
      ) : (
        <>
          {icon}
          <Text
            style={
              kind === "primary" ? styles.primaryText : kind === "danger" ? styles.dangerText : styles.secondaryText
            }
            numberOfLines={1}
          >
            {label}
          </Text>
        </>
      )}
    </PressableScale>
  );
}

export function Field({
  label,
  value,
  onChangeText,
  placeholder,
  secure = false,
  keyboardType = "default",
  autoFocus = false,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  secure?: boolean;
  keyboardType?: KeyboardTypeOptions;
  autoFocus?: boolean;
}): ReactNode {
  const styles = useStyles(createStyles);
  const colors = useColors();
  const [focused, setFocused] = useState(false);
  const focus = useCallback(() => setFocused(true), []);
  const blur = useCallback(() => setFocused(false), []);
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={focused ? styles.haloOn : styles.halo}>
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={colors.fgFaint}
          secureTextEntry={secure}
          keyboardType={keyboardType}
          autoCapitalize="none"
          autoCorrect={false}
          autoFocus={autoFocus}
          onFocus={focus}
          onBlur={blur}
          selectionColor={colors.ring}
          style={focused ? styles.inputFocused : styles.input}
        />
      </View>
    </View>
  );
}

export function StatusDot({ color, size = 8 }: { color: string; size?: number }): ReactNode {
  return <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color }} />;
}

/**
 * A machine's or a link's state dot (8 px) in a 12 px slot: ok when online,
 * err when down, a faint spinner while checking. `used` makes it ping: the
 * link the phone goes through.
 */
export function StateDot({ dot, used = false }: { dot: Dot; used?: boolean }): ReactNode {
  const styles = useStyles(createStyles);
  const colors = useColors();
  return (
    <View style={styles.dotSlot}>
      {dot === "checking" ? (
        <Spinner size={8} color={colors.fgMuted} />
      ) : (
        <LiveDot color={dot === "online" ? colors.ok : colors.err} ping={used && dot === "online"} />
      )}
    </View>
  );
}

/** A mono pill for metadata: a model, a directory, a count (`sh-chip`); pressable when given `onPress`. */
export function Chip({
  label,
  tone = "plain",
  leading,
  onPress,
  accessibilityLabel,
}: {
  label: string;
  tone?: "plain" | "accent" | "ok" | "warn" | "err";
  leading?: ReactNode;
  onPress?: () => void;
  accessibilityLabel?: string;
}): ReactNode {
  const styles = useStyles(createStyles);
  const body = (
    <>
      {leading}
      <Text style={styles[`chipText.${tone}`]} numberOfLines={1} ellipsizeMode="middle">
        {label}
      </Text>
    </>
  );
  if (onPress === undefined) return <View style={styles[`chip.${tone}`]}>{body}</View>;
  return (
    <PressableScale
      onPress={onPress}
      style={styles[`chip.${tone}`]}
      hitSlop={CHIP_SLOP}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
    >
      {body}
    </PressableScale>
  );
}

/** A chevron that turns from right to down as `open` changes. */
export function Disclosure({ open, size = 14 }: { open: boolean; size?: number }): ReactNode {
  const colors = useColors();
  const turn = useSharedValue(open ? 1 : 0);
  useEffect(() => {
    turn.set(withTiming(open ? 1 : 0, QUICK));
  }, [open, turn]);
  const style = useAnimatedStyle(() => ({ transform: [{ rotate: `${turn.get() * 90}deg` }] }));
  return (
    <Animated.View style={style}>
      <ChevronGlyph size={size} color={colors.fgFaint} />
    </Animated.View>
  );
}

/** A 44 px touch target around a 34 px rounded icon well. */
export function IconButton({
  onPress,
  label,
  children,
  disabled = false,
}: {
  onPress: () => void;
  label: string;
  children: ReactNode;
  disabled?: boolean;
}): ReactNode {
  const styles = useStyles(createStyles);
  return (
    <PressableScale
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={styles.iconButton}
    >
      {({ pressed }) => <View style={pressed ? styles.iconWellPressed : styles.iconWell}>{children}</View>}
    </PressableScale>
  );
}

/**
 * The 52 px topbar: optional back button, a title and a mono subtitle, and
 * actions on the right. `large` is a root screen: the OMP wordmark leads and
 * the title follows it as `omp / title`.
 */
export function Header({
  title,
  subtitle,
  onBack,
  onTitlePress,
  titleLabel,
  right,
  large = false,
}: {
  title: string;
  subtitle?: ReactNode;
  onBack?: () => void;
  /** Makes the title a button with a down chevron (the machine switcher). */
  onTitlePress?: () => void;
  titleLabel?: string;
  right?: ReactNode;
  /** The wordmark and the title for a root screen. */
  large?: boolean;
}): ReactNode {
  const styles = useStyles(createStyles);
  const colors = useColors();
  const titleText = large ? (
    <Wordmark app={title} />
  ) : (
    <View style={styles.headerTitleRow}>
      <Text style={styles.headerTitleText} numberOfLines={1} accessibilityRole="header">
        {title}
      </Text>
      {onTitlePress !== undefined ? <ChevronDownGlyph size={14} color={colors.fgMuted} /> : null}
    </View>
  );
  const subtitleText =
    subtitle === undefined ? null : typeof subtitle === "string" ? (
      <Text style={styles.headerSubtitle} numberOfLines={1}>
        {subtitle}
      </Text>
    ) : (
      subtitle
    );
  return (
    <View style={onBack === undefined ? styles.headerRoot : styles.header}>
      {onBack !== undefined ? (
        <IconButton onPress={onBack} label={t("common.back")}>
          <BackGlyph size={20} color={colors.fgMuted} />
        </IconButton>
      ) : null}
      {onTitlePress !== undefined ? (
        <PressableScale
          style={styles.headerText}
          pressedStyle={styles.headerTextPressed}
          onPress={onTitlePress}
          accessibilityRole="button"
          accessibilityLabel={titleLabel ?? title}
          hitSlop={6}
        >
          {titleText}
          {subtitleText}
        </PressableScale>
      ) : (
        <View style={styles.headerText}>
          {titleText}
          {subtitleText}
        </View>
      )}
      {right !== undefined ? <View style={styles.headerRight}>{right}</View> : null}
    </View>
  );
}

/** A quiet section title above a group, with an optional mono count beside it. */
export function SectionHeader({ title, meta }: { title: string; meta?: string }): ReactNode {
  const styles = useStyles(createStyles);
  return (
    <View style={styles.section}>
      <Text style={styles.sectionText}>{title.toLocaleUpperCase()}</Text>
      {meta !== undefined ? <Text style={styles.sectionMeta}>{meta}</Text> : null}
    </View>
  );
}

/** Rows on one panel with a hairline border and a faint top edge; each Row draws its own divider unless it is `last`. */
export function Group({ children }: { children: ReactNode }): ReactNode {
  const styles = useStyles(createStyles);
  return <View style={styles.group}>{children}</View>;
}

/** One dense list row: a leading tile, title + detail, trailing content, and a chevron when pressable. */
export function Row({
  title,
  detail,
  leading,
  trailing,
  last = false,
  onPress,
  onLongPress,
  chevron,
  accessibilityLabel,
  dim = false,
  mono = false,
  selected,
}: {
  title: string;
  detail?: ReactNode;
  leading?: ReactNode;
  trailing?: ReactNode;
  last?: boolean;
  onPress?: () => void;
  onLongPress?: () => void;
  chevron?: boolean;
  accessibilityLabel?: string;
  dim?: boolean;
  /** Set a string detail in the mono face: a version, a path. */
  mono?: boolean;
  /** One choice of several (a radio row): announced as selected or not. */
  selected?: boolean;
}): ReactNode {
  const styles = useStyles(createStyles);
  const colors = useColors();
  const style = last ? styles.row : styles.rowDivided;
  const showChevron = chevron ?? onPress !== undefined;
  const body = (
    <>
      {leading !== undefined ? <View style={styles.tile}>{leading}</View> : null}
      <View style={styles.rowText}>
        <Text style={dim ? styles.rowTitleDim : styles.rowTitle} numberOfLines={1}>
          {title}
        </Text>
        {detail === undefined ? null : typeof detail === "string" ? (
          <Text style={mono ? styles.rowDetailMono : styles.rowDetail} numberOfLines={3}>
            {detail}
          </Text>
        ) : (
          detail
        )}
      </View>
      {trailing}
      {showChevron ? <ChevronGlyph size={14} color={colors.fgFaint} /> : null}
    </>
  );
  if (onPress === undefined && onLongPress === undefined) {
    return <View style={last ? styles.row : styles.rowDivided}>{body}</View>;
  }
  return (
    <PressableScale
      onPress={onPress}
      onLongPress={onLongPress}
      style={style}
      pressedStyle={styles.pressed}
      scale={ROW_PRESS_SCALE}
      accessibilityRole={selected === undefined ? "button" : "radio"}
      accessibilityState={selected === undefined ? undefined : { selected }}
      accessibilityLabel={accessibilityLabel ?? title}
    >
      {body}
    </PressableScale>
  );
}

/** An empty list: the icon in a gradient-edged tile, a title, an optional line of body and the actions. */
export function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon: ReactNode;
  title: string;
  body?: string;
  action?: ReactNode;
}): ReactNode {
  const styles = useStyles(createStyles);
  return (
    <View style={styles.empty}>
      <GradientTile>{icon}</GradientTile>
      <Text style={styles.emptyTitle}>{title}</Text>
      {body !== undefined ? <Text style={styles.emptyBody}>{body}</Text> : null}
      {action !== undefined ? <View style={styles.emptyAction}>{action}</View> : null}
    </View>
  );
}

/** A tappable error strip under a header, with an optional action on its right. */
export function Banner({
  text,
  onPress,
  action,
}: {
  text: string;
  onPress?: () => void;
  action?: { label: string; onPress: () => void };
}): ReactNode {
  const styles = useStyles(createStyles);
  const colors = useColors();
  return (
    <Pressable onPress={onPress} style={styles.banner} accessibilityRole="alert">
      <View style={styles.bannerDot}>
        <LiveDot color={colors.err} size={6} />
      </View>
      <Text style={styles.bannerText}>{text}</Text>
      {action !== undefined ? (
        <Pressable
          onPress={action.onPress}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={action.label}
          style={styles.bannerAction}
        >
          <Text style={styles.bannerActionText}>{action.label}</Text>
        </Pressable>
      ) : null}
    </Pressable>
  );
}

/** Past this share of its height (projected, so a flick counts) a released sheet dismisses. */
const DISMISS_AT = 0.4;
/** Reduced motion: a sheet or screen fades in place instead of sliding. Never itself reduced: it is the reduction. */
export const FADE_REDUCED: WithTimingConfig = { duration: 200, easing: EASE_OUT, reduceMotion: ReduceMotion.Never };
/**
 * Leaving: SPRING_SHEET's time, critically damped and clamped, since springing
 * past the bottom would flash the screen edge under the sheet.
 */
const SPRING_DISMISS: WithSpringConfig = { duration: 340, dampingRatio: 1, overshootClamping: true, reduceMotion: ReduceMotion.System };

/** One sheet's motion state; made by `useSheet`, read by the Sheet* parts through context. */
export interface SheetController {
  /** True from opening until the slide-out lands: the Modal stays up meanwhile. */
  mounted: boolean;
  /** The parent's close, at once (Back, a close button); the sheet slides out after it. */
  close: () => void;
  /** The user let go of the sheet (the scrim): slide out, then the parent's close. Catchable until it lands. */
  dismiss: () => void;
  /** How far below its resting place the sheet is, in px; `height` is fully closed. */
  offset: SharedValue<number>;
  height: SharedValue<number>;
  /** 1 except under reduced motion, where the sheet fades instead of sliding. */
  fade: SharedValue<number>;
  /** A worklet: hand a finger's release to the sheet, which dismisses or snaps back. */
  release: (velocity: number) => void;
  grab: PanGesture;
  onLayout: (event: LayoutChangeEvent) => void;
}

/**
 * A bottom sheet's motion: it rises by its own height on a spring, follows a
 * finger 1:1 (resisting upward), and on release goes where the projected
 * endpoint says, carrying the finger's velocity. Every move starts from where
 * the sheet is, so a closing sheet can be caught. A dismissal the user makes
 * calls `onClose` when it lands; a close the parent makes (`visible` off)
 * slides it out, then unmounts.
 */
export function useSheet(visible: boolean, onClose: () => void): SheetController {
  const reduced = useReducedMotion();
  const { height: windowHeight } = useWindowDimensions();
  const [mounted, setMounted] = useState(visible);
  // Off screen until measured: the first frame must not flash the sheet in place.
  const offset = useSharedValue(windowHeight);
  const height = useSharedValue(0);
  const fade = useSharedValue(1);
  const open = useSharedValue(visible);
  const start = useSharedValue(0);
  const state = useRef({ visible, onClose, pending: visible, landed: false });
  useEffect(() => {
    state.current.onClose = onClose;
  });

  const unmount = useCallback(() => {
    setMounted(false);
    height.set(0);
    offset.set(windowHeight);
  }, [height, offset, windowHeight]);
  // At rest below the screen: the user's dismissal tells the parent; the parent's close takes the Modal down.
  const landed = useCallback(() => {
    const current = state.current;
    if (!current.visible) return unmount();
    current.landed = true;
    current.onClose();
  }, [unmount]);

  const motion = useMemo(() => {
    const toOpen = (velocity: number, snap: boolean): void => {
      "worklet";
      if (reduced) {
        offset.set(0);
        fade.set(withTiming(1, FADE_REDUCED));
        return;
      }
      offset.set(withSpring(0, { ...(snap ? SPRING_SNAP : SPRING_SHEET), velocity }));
    };
    const toClosed = (velocity: number): void => {
      "worklet";
      const done = (finished?: boolean): void => {
        "worklet";
        if (finished === true) scheduleOnRN(landed);
      };
      if (reduced) {
        fade.set(withTiming(0, FADE_REDUCED, done));
        return;
      }
      offset.set(withSpring(height.get(), { ...SPRING_DISMISS, velocity }, done));
    };
    const release = (velocity: number): void => {
      "worklet";
      // A sheet the parent already closed only finishes leaving.
      if (open.get() && offset.get() + project(velocity) < height.get() * DISMISS_AT) {
        toOpen(velocity, true);
        return;
      }
      toClosed(velocity);
    };
    return { toOpen, toClosed, release };
  }, [fade, height, landed, offset, open, reduced]);

  const grab = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetY([-6, 6])
        .failOffsetX([-24, 24])
        .onStart(() => {
          cancelAnimation(offset);
          start.set(offset.get());
        })
        .onUpdate((event) => {
          const next = start.get() + event.translationY;
          offset.set(next >= 0 ? next : rubberband(next, height.get()));
        })
        .onEnd((event) => motion.release(event.velocityY)),
    [height, motion, offset, start],
  );

  useEffect(() => {
    const current = state.current;
    current.visible = visible;
    open.set(visible);
    if (visible) {
      current.landed = false;
      setMounted(true);
      // Reopened mid-close: from where it is. Otherwise once it has been measured.
      if (height.get() > 0) motion.toOpen(0, false);
      else current.pending = true;
      return;
    }
    current.pending = false;
    if (current.landed || height.get() === 0) unmount();
    else motion.toClosed(0);
    // Only the parent's `visible` drives this; `motion` changes with reduced motion.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const onLayout = useCallback(
    (event: LayoutChangeEvent) => {
      const measured = event.nativeEvent.layout.height;
      height.set(measured);
      const current = state.current;
      if (!current.pending) return;
      current.pending = false;
      offset.set(measured);
      if (reduced) fade.set(0);
      motion.toOpen(0, false);
    },
    [fade, height, motion, offset, reduced],
  );
  const close = useCallback(() => state.current.onClose(), []);
  const dismiss = useCallback(() => motion.toClosed(0), [motion]);
  return { mounted, close, dismiss, offset, height, fade, release: motion.release, grab, onLayout };
}

const SheetContext = createContext<SheetController | null>(null);

function useSheetContext(): SheetController {
  const sheet = useContext(SheetContext);
  if (sheet === null) throw new Error("Sheet parts render inside a SheetHost");
  return sheet;
}

/**
 * A sheet's stage: the scrim (its opacity follows the sheet), keyboard
 * avoidance and, by default, the transparent Modal that holds it. Tapping
 * the scrim dismisses the sheet down its own path.
 */
export function SheetHost({
  sheet,
  modal = true,
  backdropLabel,
  children,
}: {
  sheet: SheetController;
  /** Off for a sheet drawn inside its screen (it covers that screen only). */
  modal?: boolean;
  backdropLabel: string;
  children: ReactNode;
}): ReactNode {
  const styles = useStyles(createStyles);
  const insets = useSafeAreaInsets();
  const keyboard = useReanimatedKeyboardAnimation();
  const { offset, height, fade } = sheet;
  // The one layout animation here: with the keyboard up the sheet must get
  // shorter, not just move. It follows the keyboard's own frames on the UI
  // thread; the sheet's bottom padding already clears the home indicator.
  const lift = useAnimatedStyle(() => ({ paddingBottom: Math.max(0, -keyboard.height.get() - insets.bottom) }));
  const backdrop = useAnimatedStyle(() => {
    const full = height.get();
    return { opacity: full > 0 ? interpolate(offset.get(), [0, full], [1, 0], Extrapolation.CLAMP) * fade.get() : 0 };
  });
  const body = (
    <SheetContext.Provider value={sheet}>
      <Animated.View style={[styles.sheetRoot, lift]}>
        <Animated.View style={[styles.scrim, backdrop]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={sheet.dismiss} accessibilityLabel={backdropLabel} />
        </Animated.View>
        {children}
      </Animated.View>
    </SheetContext.Provider>
  );
  if (!modal) return body;
  return (
    <Modal visible={sheet.mounted} transparent animationType="none" statusBarTranslucent onRequestClose={sheet.close}>
      {/* A Modal is its own native root on Android: gestures need their own root view in it. */}
      <GestureHandlerRootView style={styles.fill}>{body}</GestureHandlerRootView>
    </Modal>
  );
}

/** The sheet itself: measured for its travel, moved by the sheet's offset. `skirt` fills under a snap-back's overshoot. */
export function SheetSurface({
  style,
  skirt,
  children,
}: {
  style?: StyleProp<ViewStyle>;
  /** The surface's color, continued below its bottom edge. */
  skirt?: string;
  children: ReactNode;
}): ReactNode {
  const styles = useStyles(createStyles);
  const { offset, fade, onLayout } = useSheetContext();
  const slide = useAnimatedStyle(() => ({ opacity: fade.get(), transform: [{ translateY: offset.get() }] }));
  return (
    <Animated.View onLayout={onLayout} style={[styles.sheetSurface, style, slide]}>
      {skirt !== undefined ? <View pointerEvents="none" style={[styles.skirt, { backgroundColor: skirt }]} /> : null}
      {children}
    </Animated.View>
  );
}

/** The part of a sheet that drags it: the grab handle and the header. One per sheet. */
export function SheetGrab({ style, children }: { style?: StyleProp<ViewStyle>; children: ReactNode }): ReactNode {
  const { grab } = useSheetContext();
  return (
    <GestureDetector gesture={grab}>
      <View style={style} collapsable={false}>
        {children}
      </View>
    </GestureDetector>
  );
}

/**
 * A ScrollView inside a sheet that hands a downward drag to the sheet once
 * the content is at its top, and takes it back when the sheet is up again,
 * so pulling the list down past its start pulls the sheet down.
 */
export function SheetScrollView({ style, children, ...rest }: ScrollViewProps): ReactNode {
  const styles = useStyles(createStyles);
  const { offset, release } = useSheetContext();
  const ref = useAnimatedRef<Animated.ScrollView>();
  const scrollY = useSharedValue(0);
  const last = useSharedValue(0);
  const holding = useSharedValue(false);
  const onScroll = useAnimatedScrollHandler((event) => {
    scrollY.set(event.contentOffset.y);
  });
  const native = useMemo(() => Gesture.Native(), []);
  const pan = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetY([-10, 10])
        .failOffsetX([-16, 16])
        .simultaneousWithExternalGesture(native)
        .onStart((event) => {
          last.set(event.translationY);
          holding.set(false);
        })
        .onUpdate((event) => {
          const dy = event.translationY - last.get();
          last.set(event.translationY);
          const y = offset.get();
          // The content scrolls until it is at its top; then the finger has the sheet.
          if (y <= 0 && (scrollY.get() > 0 || dy <= 0)) return;
          if (!holding.get()) {
            cancelAnimation(offset);
            holding.set(true);
          }
          const next = Math.max(0, y + dy);
          offset.set(next);
          // While the sheet is down the content stays put: the finger moves one thing.
          if (next > 0) scrollTo(ref, 0, 0, false);
        })
        .onEnd((event) => {
          if (!holding.get()) return;
          // Back at rest before the release: the scroll has the velocity, not the sheet.
          if (offset.get() > 0) release(event.velocityY);
          else offset.set(withSpring(0, SPRING_SNAP));
        }),
    [holding, last, native, offset, ref, release, scrollY],
  );
  return (
    <GestureDetector gesture={pan}>
      <View style={[styles.sheetScrollFrame, style]} collapsable={false}>
        <GestureDetector gesture={native}>
          <Animated.ScrollView {...rest} ref={ref} onScroll={onScroll} scrollEventThrottle={16} bounces={false} overScrollMode="never">
            {children}
          </Animated.ScrollView>
        </GestureDetector>
      </View>
    </GestureDetector>
  );
}

/** A bottom sheet in a transparent modal, padded above the home indicator; drag it down or tap the scrim to close. */
export function Sheet({
  visible,
  title,
  onClose,
  children,
  scroll = true,
}: {
  visible: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** Scroll the content when it outgrows the sheet (the keyboard is up); off for content that scrolls itself (use SheetScrollView). */
  scroll?: boolean;
}): ReactNode {
  const styles = useStyles(createStyles);
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const sheet = useSheet(visible, onClose);
  // While it slides out, the sheet keeps what it showed: callers clear their content on close.
  const shown = useRef({ title, children });
  if (visible) shown.current = { title, children };
  return (
    <SheetHost sheet={sheet} backdropLabel={t("common.close")}>
      <SheetSurface style={[styles.sheet, { paddingBottom: 20 + insets.bottom, maxHeight: height - insets.top - 12 }]} skirt={colors.overlay}>
        <SheetGrab style={styles.sheetGrabArea}>
          <View style={styles.grab} />
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle} numberOfLines={2}>
              {shown.current.title}
            </Text>
            <IconButton onPress={onClose} label={t("common.close")}>
              <CloseGlyph size={16} color={colors.fgMuted} />
            </IconButton>
          </View>
        </SheetGrab>
        {scroll ? (
          <SheetScrollView contentContainerStyle={styles.sheetBody} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            {shown.current.children}
          </SheetScrollView>
        ) : (
          shown.current.children
        )}
      </SheetSurface>
    </SheetHost>
  );
}

/**
 * A confirmation in the app's sheet style: a title, one short sentence, then
 * the secondary and the primary action side by side. `danger` tints the
 * primary for an action that cannot be undone from the phone.
 */
export function ConfirmSheet({
  visible,
  title,
  body,
  action,
  danger = false,
  onConfirm,
  onClose,
}: {
  visible: boolean;
  title: string;
  body?: string;
  action: string;
  danger?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}): ReactNode {
  const styles = useStyles(createStyles);
  return (
    <Sheet visible={visible} title={title} onClose={onClose}>
      {body !== undefined ? <Text style={styles.confirmBody}>{body}</Text> : null}
      <View style={styles.confirmRow}>
        <View style={styles.confirmButton}>
          <Button label={t("common.cancel")} kind="plain" onPress={onClose} />
        </View>
        <View style={styles.confirmButton}>
          <Button
            label={action}
            kind={danger ? "danger" : "primary"}
            onPress={() => {
              onClose();
              onConfirm();
            }}
          />
        </View>
      </View>
    </Sheet>
  );
}

/** The shared look of a sheet surface: overlay, 16 px top corners, a strong border with a lit top edge. */
export function sheetSurface(c: Palette) {
  return {
    width: "100%",
    maxWidth: 600,
    alignSelf: "center",
    paddingTop: 8,
    paddingHorizontal: 18,
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    borderWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: 0,
    borderColor: c.borderStrong,
    borderTopColor: c.edgeTop,
    backgroundColor: c.overlay,
  } as const;
}

function createStyles(c: Palette) {
  const button = {
    height: 48,
    borderRadius: radius.lg,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingHorizontal: 16,
  } as const;
  const row = {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    minHeight: 56,
    paddingVertical: 10,
    paddingHorizontal: 12,
  } as const;
  const divider = { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.separator };
  const header = {
    height: HEADER_HEIGHT,
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    paddingHorizontal: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: c.border,
    backgroundColor: c.bg,
  } as const;
  const rowTitle = { fontFamily: SANS, fontSize: 16, lineHeight: 21, fontWeight: "400", letterSpacing: -0.3, color: c.fg } as const;
  const input = {
    minHeight: 44,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md + 2,
    paddingHorizontal: 14,
    paddingVertical: 11,
    fontFamily: SANS,
    fontSize: 15,
    color: c.fg,
    backgroundColor: c.well,
    borderColor: c.border,
  } as const;
  const halo = { borderRadius: radius.md + 5, borderWidth: 3, margin: -3, borderColor: "transparent" } as const;
  const chip = {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    height: 22,
    maxWidth: "100%",
    paddingHorizontal: 8,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: c.border,
    backgroundColor: c.raised,
  } as const;
  const chipText = { flexShrink: 1, fontFamily: MONO, fontSize: 11, lineHeight: 14, color: c.fgMuted } as const;
  return {
    primary: { ...button, backgroundColor: c.fg },
    secondary: {
      ...button,
      backgroundColor: c.well,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
    },
    danger: {
      ...button,
      backgroundColor: c.errSoft,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.errBorder,
    },
    disabled: { opacity: 0.4 },
    buttonPressed: { opacity: 0.85 },
    primaryText: { fontFamily: SANS, fontSize: 15, fontWeight: "600", color: c.bg },
    secondaryText: { fontFamily: SANS, fontSize: 15, fontWeight: "500", color: c.fg },
    dangerText: { fontFamily: SANS, fontSize: 15, fontWeight: "600", color: c.err },

    field: { gap: 6 },
    fieldLabel: { fontFamily: SANS, fontSize: 12.5, lineHeight: 16, fontWeight: "500", color: c.fgFaint, marginLeft: 2 },
    halo,
    haloOn: { ...halo, borderColor: c.ringSoft },
    input,
    inputFocused: { ...input, borderColor: c.borderStrong },

    chip,
    "chip.plain": chip,
    "chip.accent": { ...chip, borderColor: "transparent", backgroundColor: c.accentMuted },
    "chip.ok": { ...chip, borderColor: c.okSoft, backgroundColor: c.okSoft },
    "chip.warn": { ...chip, borderColor: c.warnSoft, backgroundColor: c.warnSoft },
    "chip.err": { ...chip, borderColor: c.errBorder, backgroundColor: c.errSoft },
    "chipText.plain": chipText,
    "chipText.accent": { ...chipText, color: c.accent },
    "chipText.ok": { ...chipText, color: c.ok },
    "chipText.warn": { ...chipText, color: c.warn },
    "chipText.err": { ...chipText, color: c.err },

    iconButton: { width: HIT, height: HIT, alignItems: "center", justifyContent: "center" },
    iconWell: { width: 34, height: 34, borderRadius: radius.md, alignItems: "center", justifyContent: "center" },
    iconWellPressed: {
      width: 34,
      height: 34,
      borderRadius: radius.md,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: c.selected,
    },

    header,
    headerRoot: { ...header, paddingLeft: 16 },
    headerText: { flex: 1, minWidth: 0, paddingHorizontal: 4, justifyContent: "center", gap: 1 },
    headerTextPressed: { opacity: 0.6 },
    headerTitleRow: { flexDirection: "row", alignItems: "center", gap: 4, minWidth: 0 },
    headerTitleText: { flexShrink: 1, fontFamily: SANS, fontSize: 16, lineHeight: 21, fontWeight: "600", letterSpacing: -0.2, color: c.fg },
    headerSubtitle: { fontFamily: MONO, fontSize: 11, lineHeight: 15, color: c.fgFaint },
    headerRight: { flexDirection: "row", alignItems: "center" },

    section: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, paddingTop: 22, paddingBottom: 7, paddingHorizontal: 16 },
    // No letter spacing and no textTransform: Android clips the last glyph of such labels.
    sectionText: { fontFamily: SANS, fontSize: 13, lineHeight: 18, fontWeight: "400", color: c.fgFaint },
    sectionMeta: { fontFamily: SANS, fontSize: 13, lineHeight: 18, color: c.fgFaint },
    group: { borderRadius: 14, overflow: "hidden", backgroundColor: c.group },
    row,
    rowDivided: { ...row, ...divider },
    pressed: { backgroundColor: c.hover },
    tile: { width: 32, height: 32, borderRadius: 8, alignItems: "center", justifyContent: "center", backgroundColor: c.tile },
    rowText: { flex: 1, minWidth: 0, gap: 3 },
    rowTitle,
    rowTitleDim: { ...rowTitle, color: c.fgMuted },
    rowDetail: { fontFamily: SANS, fontSize: 13, lineHeight: 18, color: c.fgFaint },
    rowDetailMono: { fontFamily: MONO, fontSize: 11.5, lineHeight: 16, color: c.fgFaint },

    empty: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 32, paddingVertical: 48 },
    emptyTitle: {
      fontFamily: SANS,
      fontSize: 17,
      lineHeight: 22,
      fontWeight: "600",
      letterSpacing: -0.2,
      color: c.fg,
      marginTop: 18,
      textAlign: "center",
    },
    emptyBody: { fontFamily: SANS, fontSize: 14, lineHeight: 20, color: c.fgFaint, marginTop: 6, textAlign: "center", maxWidth: 320 },
    emptyAction: { marginTop: 22, minWidth: 220 },

    banner: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      paddingHorizontal: 16,
      paddingVertical: 9,
      backgroundColor: c.errSoft,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: c.errBorder,
    },
    bannerDot: { alignSelf: "flex-start", paddingTop: 6 },
    bannerText: { flex: 1, fontFamily: SANS, fontSize: 13, lineHeight: 18, color: c.err },
    bannerAction: {
      height: 26,
      paddingHorizontal: 10,
      borderRadius: radius.sm,
      justifyContent: "center",
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.errBorder,
    },
    bannerActionText: { fontFamily: MONO, fontSize: 11.5, fontWeight: "600", color: c.err },

    dotSlot: { width: 12, height: 12, alignItems: "center", justifyContent: "center" },

    fill: { flex: 1 },
    sheetRoot: { ...StyleSheet.absoluteFill, justifyContent: "flex-end" },
    scrim: { ...StyleSheet.absoluteFill, backgroundColor: c.backdrop },
    // Shrinks to the room left above the keyboard instead of running off the top.
    sheetSurface: { flexShrink: 1 },
    skirt: { position: "absolute", left: 0, right: 0, top: "100%", height: 240 },
    sheet: { ...sheetSurface(c), gap: 14 },
    sheetGrabArea: { gap: 14 },
    sheetScrollFrame: { flexShrink: 1 },
    sheetBody: { gap: 14 },
    grab: { alignSelf: "center", width: 38, height: 5, borderRadius: 3, backgroundColor: c.borderStrong },
    sheetHeader: { flexDirection: "row", alignItems: "center", marginLeft: 2, marginRight: -10, marginTop: -6 },
    confirmBody: { fontFamily: SANS, fontSize: 15, lineHeight: 22, color: c.fgMuted, marginHorizontal: 2, marginTop: -4 },
    confirmRow: { flexDirection: "row", gap: 10, marginTop: 4 },
    confirmButton: { flex: 1 },
    sheetTitle: { flex: 1, fontFamily: SANS, fontSize: 19, lineHeight: 25, fontWeight: "600", letterSpacing: -0.4, color: c.fg },
  } as const;
}
