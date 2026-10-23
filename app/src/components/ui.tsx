import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  Animated,
  Easing,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
  type KeyboardTypeOptions,
  type PressableStateCallbackType,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { EASE_OUT, HEADER_HEIGHT, HIT, MONO, radius, useColors, useStyles, type Palette } from "../theme";
import type { Dot } from "../probe";
import { GradientTile, LiveDot, Spinner, Wordmark } from "./brand";
import { BackGlyph, ChevronGlyph, CloseGlyph } from "./icons";

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
  const foreground = kind === "primary" ? colors.accentFg : kind === "danger" ? colors.err : colors.fg;
  const style = useCallback(
    ({ pressed }: PressableStateCallbackType) => [
      kind === "primary" ? styles.primary : kind === "danger" ? styles.danger : styles.secondary,
      disabled ? styles.disabled : pressed ? styles.buttonPressed : null,
    ],
    [disabled, kind, styles],
  );
  return (
    <Pressable accessibilityRole="button" onPress={onPress} disabled={disabled || busy} style={style}>
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
    </Pressable>
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

/** A mono pill for metadata: a model, a directory, a count (`sh-chip`). */
export function Chip({
  label,
  tone = "plain",
  leading,
}: {
  label: string;
  tone?: "plain" | "accent" | "ok" | "warn" | "err";
  leading?: ReactNode;
}): ReactNode {
  const styles = useStyles(createStyles);
  return (
    <View style={styles[`chip.${tone}`]}>
      {leading}
      <Text style={styles[`chipText.${tone}`]} numberOfLines={1} ellipsizeMode="middle">
        {label}
      </Text>
    </View>
  );
}

/** A chevron that turns from right to down as `open` changes. */
export function Disclosure({ open, size = 14 }: { open: boolean; size?: number }): ReactNode {
  const colors = useColors();
  const value = useRef(new Animated.Value(open ? 1 : 0)).current;
  useEffect(() => {
    Animated.timing(value, { toValue: open ? 1 : 0, duration: 180, easing: EASE_OUT, useNativeDriver: true }).start();
  }, [open, value]);
  const rotate = value.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "90deg"] });
  return (
    <Animated.View style={{ transform: [{ rotate }] }}>
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
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={styles.iconButton}
    >
      {({ pressed }) => <View style={pressed ? styles.iconWellPressed : styles.iconWell}>{children}</View>}
    </Pressable>
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
  right,
  large = false,
}: {
  title: string;
  subtitle?: ReactNode;
  onBack?: () => void;
  right?: ReactNode;
  /** The wordmark and the title for a root screen. */
  large?: boolean;
}): ReactNode {
  const styles = useStyles(createStyles);
  const colors = useColors();
  return (
    <View style={onBack === undefined ? styles.headerRoot : styles.header}>
      {onBack !== undefined ? (
        <IconButton onPress={onBack} label="Back">
          <BackGlyph size={20} color={colors.fgMuted} />
        </IconButton>
      ) : null}
      <View style={styles.headerText}>
        {large ? (
          <Wordmark app={title} />
        ) : (
          <Text style={styles.headerTitle} numberOfLines={1} accessibilityRole="header">
            {title}
          </Text>
        )}
        {subtitle === undefined ? null : typeof subtitle === "string" ? (
          <Text style={styles.headerSubtitle} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : (
          subtitle
        )}
      </View>
      {right !== undefined ? <View style={styles.headerRight}>{right}</View> : null}
    </View>
  );
}

/** A quiet section title above a group, with an optional mono count beside it. */
export function SectionHeader({ title, meta }: { title: string; meta?: string }): ReactNode {
  const styles = useStyles(createStyles);
  return (
    <View style={styles.section}>
      <Text style={styles.sectionText}>{title}</Text>
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
}): ReactNode {
  const styles = useStyles(createStyles);
  const colors = useColors();
  const style = useCallback(
    ({ pressed }: PressableStateCallbackType) => [last ? styles.row : styles.rowDivided, pressed && styles.pressed],
    [last, styles],
  );
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
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      style={style}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
    >
      {body}
    </Pressable>
  );
}

/** An empty list: the icon in a gradient-edged tile, a title, a line of body and one primary action. */
export function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon: ReactNode;
  title: string;
  body: string;
  action?: ReactNode;
}): ReactNode {
  const styles = useStyles(createStyles);
  return (
    <View style={styles.empty}>
      <GradientTile>{icon}</GradientTile>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyBody}>{body}</Text>
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

/**
 * A sheet's slide-up: 0 → 1 with the OMP ease-out when `visible` turns on, back
 * to 0 when it turns off; `mounted` stays true until the slide-out finishes.
 */
export function useSheetMotion(visible: boolean): { mounted: boolean; progress: Animated.Value } {
  const [mounted, setMounted] = useState(visible);
  const progress = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (visible) {
      setMounted(true);
      const run = Animated.timing(progress, { toValue: 1, duration: 360, easing: EASE_OUT, useNativeDriver: true });
      run.start();
      return () => run.stop();
    }
    const run = Animated.timing(progress, {
      toValue: 0,
      duration: 200,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: true,
    });
    run.start(({ finished }) => {
      if (finished) setMounted(false);
    });
    return () => run.stop();
  }, [progress, visible]);
  return { mounted, progress };
}

/** The backdrop's opacity and the sheet's slide for a sheet's progress. */
export function sheetTransforms(progress: Animated.Value, height: number) {
  return {
    backdrop: { opacity: progress },
    sheet: {
      transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [Math.max(320, height * 0.6), 0] }) }],
    },
  };
}

/** A bottom sheet in a transparent modal, padded above the home indicator; it slides up and back down. */
export function Sheet({
  visible,
  title,
  onClose,
  children,
}: {
  visible: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}): ReactNode {
  const styles = useStyles(createStyles);
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const { mounted, progress } = useSheetMotion(visible);
  // While it slides out, the sheet keeps what it showed: callers clear their content on close.
  const shown = useRef({ title, children });
  if (visible) shown.current = { title, children };
  const motion = sheetTransforms(progress, height);
  return (
    <Modal visible={mounted} transparent animationType="none" statusBarTranslucent onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.sheetRoot} behavior="padding">
        <Animated.View style={[styles.scrim, motion.backdrop]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />
        </Animated.View>
        <Animated.View style={[styles.sheet, { paddingBottom: 20 + insets.bottom }, motion.sheet]}>
          <View style={styles.grab} />
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle} numberOfLines={1}>
              {shown.current.title}
            </Text>
            <IconButton onPress={onClose} label="Close">
              <CloseGlyph size={16} color={colors.fgMuted} />
            </IconButton>
          </View>
          {shown.current.children}
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/** The shared look of a sheet surface: overlay, 16 px top corners, a strong border with a lit top edge. */
export function sheetSurface(c: Palette) {
  return {
    width: "100%",
    maxWidth: 600,
    alignSelf: "center",
    paddingTop: 8,
    paddingHorizontal: 16,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: 0,
    borderColor: c.borderStrong,
    borderTopColor: c.edgeTop,
    backgroundColor: c.overlay,
  } as const;
}

function createStyles(c: Palette) {
  const button = {
    height: 44,
    borderRadius: radius.md,
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
  const divider = { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border };
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
  const rowTitle = { fontSize: 15, lineHeight: 20, fontWeight: "500", letterSpacing: -0.1, color: c.fg } as const;
  const input = {
    minHeight: 44,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: c.fg,
    backgroundColor: c.inset,
    borderColor: c.borderStrong,
  } as const;
  const halo = { borderRadius: radius.md + 3, borderWidth: 3, margin: -3, borderColor: "transparent" } as const;
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
    primary: { ...button, backgroundColor: c.accent },
    secondary: {
      ...button,
      backgroundColor: c.overlay,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.borderStrong,
    },
    danger: {
      ...button,
      backgroundColor: c.errSoft,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.errBorder,
    },
    disabled: { opacity: 0.4 },
    buttonPressed: { opacity: 0.85, transform: [{ scale: 0.98 }] },
    primaryText: { fontSize: 15, fontWeight: "600", color: c.accentFg },
    secondaryText: { fontSize: 15, fontWeight: "500", color: c.fg },
    dangerText: { fontSize: 15, fontWeight: "600", color: c.err },

    field: { gap: 6 },
    fieldLabel: { fontSize: 12, lineHeight: 16, fontWeight: "500", color: c.fgMuted, marginLeft: 2 },
    halo,
    haloOn: { ...halo, borderColor: c.ringSoft },
    input,
    inputFocused: { ...input, borderColor: c.ring },

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
    headerTitle: { fontSize: 15, lineHeight: 20, fontWeight: "600", letterSpacing: -0.15, color: c.fg },
    headerSubtitle: { fontFamily: MONO, fontSize: 11, lineHeight: 15, color: c.fgFaint },
    headerRight: { flexDirection: "row", alignItems: "center" },

    section: { flexDirection: "row", alignItems: "center", gap: 8, paddingTop: 22, paddingBottom: 8, paddingHorizontal: 4 },
    sectionText: { fontSize: 12, lineHeight: 16, fontWeight: "500", color: c.fgFaint },
    sectionMeta: {
      fontFamily: MONO,
      fontSize: 10.5,
      lineHeight: 16,
      paddingHorizontal: 6,
      borderRadius: radius.pill,
      overflow: "hidden",
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
      backgroundColor: c.raised,
      color: c.fgMuted,
    },
    group: {
      borderRadius: radius.lg,
      overflow: "hidden",
      backgroundColor: c.panel,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
      borderTopColor: c.edgeTop,
    },
    row,
    rowDivided: { ...row, ...divider },
    pressed: { backgroundColor: c.hover },
    tile: {
      width: 34,
      height: 34,
      borderRadius: radius.md,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: c.raised,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
    },
    rowText: { flex: 1, minWidth: 0, gap: 3 },
    rowTitle,
    rowTitleDim: { ...rowTitle, color: c.fgMuted },
    rowDetail: { fontSize: 13, lineHeight: 18, color: c.fgMuted },
    rowDetailMono: { fontFamily: MONO, fontSize: 11.5, lineHeight: 16, color: c.fgMuted },

    empty: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 32, paddingVertical: 48 },
    emptyTitle: {
      fontSize: 16,
      lineHeight: 22,
      fontWeight: "600",
      letterSpacing: -0.2,
      color: c.fg,
      marginTop: 18,
      textAlign: "center",
    },
    emptyBody: { fontSize: 13.5, lineHeight: 20, color: c.fgMuted, marginTop: 6, textAlign: "center", maxWidth: 320 },
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
    bannerText: { flex: 1, fontSize: 13, lineHeight: 18, color: c.err },
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

    sheetRoot: { flex: 1, justifyContent: "flex-end" },
    scrim: { ...StyleSheet.absoluteFill, backgroundColor: c.backdrop },
    sheet: { ...sheetSurface(c), gap: 14 },
    grab: { alignSelf: "center", width: 36, height: 4, borderRadius: 2, backgroundColor: c.borderStrong },
    sheetHeader: { flexDirection: "row", alignItems: "center", marginLeft: 2, marginRight: -10, marginTop: -6 },
    sheetTitle: { flex: 1, fontSize: 17, lineHeight: 24, fontWeight: "600", letterSpacing: -0.2, color: c.fg },
  } as const;
}
