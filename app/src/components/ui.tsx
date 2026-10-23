import { useCallback, type ReactNode } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type KeyboardTypeOptions,
  type PressableStateCallbackType,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { HEADER_HEIGHT, HIT, radius, useColors, useStyles, type Palette } from "../theme";
import type { Dot } from "../probe";
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
  const foreground = kind === "primary" ? colors.onPrimary : kind === "danger" ? colors.danger : colors.text;
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
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textTertiary}
        secureTextEntry={secure}
        keyboardType={keyboardType}
        autoCapitalize="none"
        autoCorrect={false}
        autoFocus={autoFocus}
        style={styles.input}
      />
    </View>
  );
}

export function StatusDot({ color, size = 8 }: { color: string; size?: number }): ReactNode {
  return <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color }} />;
}

/**
 * A machine's or a link's state dot (8 px) in a 12 px slot, as Kivotos draws
 * it. `used` rings it: the link the phone goes through.
 */
export function StateDot({ dot, used = false }: { dot: Dot; used?: boolean }): ReactNode {
  const styles = useStyles(createStyles);
  return (
    <View style={styles.dotSlot}>
      {used ? <View style={styles[`halo.${dot}`]} /> : null}
      <View style={styles[`dot.${dot}`]} />
    </View>
  );
}

/** A 44 px round touch target around an icon. */
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
  const style = useCallback(
    ({ pressed }: PressableStateCallbackType) => [styles.iconButton, pressed && styles.iconPressed],
    [styles],
  );
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={style}
    >
      {children}
    </Pressable>
  );
}

/** The 56 px screen header: optional back button, a title and subtitle, and actions on the right. */
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
  /** A large left-aligned title for a root screen. */
  large?: boolean;
}): ReactNode {
  const styles = useStyles(createStyles);
  const colors = useColors();
  return (
    <View style={onBack === undefined ? styles.headerRoot : styles.header}>
      {onBack !== undefined ? (
        <IconButton onPress={onBack} label="Back">
          <BackGlyph color={colors.text} />
        </IconButton>
      ) : null}
      <View style={styles.headerText}>
        <Text style={large ? styles.headerTitleLarge : styles.headerTitle} numberOfLines={1}>
          {title}
        </Text>
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

/** A section title above a group. */
export function SectionHeader({ title }: { title: string }): ReactNode {
  const styles = useStyles(createStyles);
  return <Text style={styles.section}>{title}</Text>;
}

/** Rows on one rounded surface; each Row draws its own divider unless it is `last`. */
export function Group({ children }: { children: ReactNode }): ReactNode {
  const styles = useStyles(createStyles);
  return <View style={styles.group}>{children}</View>;
}

/** One list row: a leading tile, title + detail, trailing content, and a chevron when pressable. */
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
          <Text style={styles.rowDetail} numberOfLines={3}>
            {detail}
          </Text>
        ) : (
          detail
        )}
      </View>
      {trailing}
      {showChevron ? <ChevronGlyph color={colors.textTertiary} /> : null}
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

/** An empty list: an icon tile, a title, a line of body and one primary action. */
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
      <View style={styles.emptyMark}>{icon}</View>
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
  return (
    <Pressable onPress={onPress} style={styles.banner} accessibilityRole="alert">
      <Text style={styles.bannerText}>{text}</Text>
      {action !== undefined ? (
        <Pressable onPress={action.onPress} hitSlop={10} accessibilityRole="button" accessibilityLabel={action.label}>
          <Text style={styles.bannerAction}>{action.label}</Text>
        </Pressable>
      ) : null}
    </Pressable>
  );
}

/** A bottom sheet in a transparent modal, padded above the home indicator. */
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
  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.sheetRoot} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <Pressable style={styles.scrim} onPress={onClose} accessibilityLabel="Close" />
        <View style={[styles.sheet, { paddingBottom: 20 + insets.bottom }]}>
          <View style={styles.grab} />
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle} numberOfLines={1}>
              {title}
            </Text>
            <IconButton onPress={onClose} label="Close">
              <CloseGlyph color={colors.textTertiary} />
            </IconButton>
          </View>
          {children}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function createStyles(c: Palette) {
  const button = {
    height: 48,
    borderRadius: radius.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingHorizontal: 18,
  } as const;
  const row = {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    minHeight: 60,
    paddingVertical: 10,
    paddingHorizontal: 14,
  } as const;
  const divider = { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border };
  const header = {
    height: HEADER_HEIGHT,
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    paddingHorizontal: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: c.separator,
    backgroundColor: c.bg,
  } as const;
  const dot = { width: 8, height: 8, borderRadius: 4 } as const;
  const halo = { ...StyleSheet.absoluteFill, borderRadius: 6, opacity: 0.3 } as const;
  const rowTitle = { fontSize: 16, lineHeight: 22, fontWeight: "500", color: c.text } as const;
  return {
    primary: { ...button, backgroundColor: c.primary },
    secondary: {
      ...button,
      backgroundColor: c.bg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
    },
    danger: { ...button, backgroundColor: c.dangerSoft },
    disabled: { opacity: 0.4 },
    buttonPressed: { opacity: 0.8 },
    primaryText: { fontSize: 15, fontWeight: "600", color: c.onPrimary },
    secondaryText: { fontSize: 15, fontWeight: "500", color: c.text },
    dangerText: { fontSize: 15, fontWeight: "600", color: c.danger },

    field: { gap: 7 },
    fieldLabel: { fontSize: 13, lineHeight: 18, color: c.textSecondary, marginLeft: 4 },
    input: {
      minHeight: 46,
      borderWidth: StyleSheet.hairlineWidth,
      borderRadius: radius.md,
      paddingHorizontal: 14,
      paddingVertical: 10,
      fontSize: 16,
      color: c.text,
      backgroundColor: c.surface,
      borderColor: c.border,
    },

    iconButton: {
      width: HIT,
      height: HIT,
      borderRadius: HIT / 2,
      alignItems: "center",
      justifyContent: "center",
    },
    iconPressed: { backgroundColor: c.pressed },

    header,
    headerRoot: { ...header, paddingLeft: 16, borderBottomColor: "transparent" },
    headerText: { flex: 1, minWidth: 0, paddingHorizontal: 4, justifyContent: "center" },
    headerTitle: { fontSize: 17, lineHeight: 22, fontWeight: "600", color: c.text },
    headerTitleLarge: { fontSize: 24, lineHeight: 30, fontWeight: "700", letterSpacing: -0.3, color: c.text },
    headerSubtitle: { fontSize: 12, lineHeight: 16, color: c.textTertiary },
    headerRight: { flexDirection: "row", alignItems: "center" },

    section: {
      fontSize: 13,
      lineHeight: 18,
      paddingTop: 24,
      paddingBottom: 8,
      paddingHorizontal: 4,
      color: c.textSecondary,
    },
    group: {
      borderRadius: radius.lg,
      overflow: "hidden",
      backgroundColor: c.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
    },
    row,
    rowDivided: { ...row, ...divider },
    pressed: { backgroundColor: c.pressed },
    tile: {
      width: 40,
      height: 40,
      borderRadius: radius.md,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: c.pressed,
    },
    rowText: { flex: 1, minWidth: 0, gap: 2 },
    rowTitle,
    rowTitleDim: { ...rowTitle, color: c.textSecondary },
    rowDetail: { fontSize: 13, lineHeight: 18, color: c.textSecondary },

    empty: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 32, paddingVertical: 48 },
    emptyMark: {
      width: 64,
      height: 64,
      borderRadius: radius.xl,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
      backgroundColor: c.surface,
      alignItems: "center",
      justifyContent: "center",
    },
    emptyTitle: {
      fontSize: 17,
      lineHeight: 22,
      fontWeight: "600",
      color: c.text,
      marginTop: 18,
      textAlign: "center",
    },
    emptyBody: { fontSize: 15, lineHeight: 22, color: c.textSecondary, marginTop: 6, textAlign: "center" },
    emptyAction: { marginTop: 22, minWidth: 200 },

    banner: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      paddingHorizontal: 16,
      paddingVertical: 10,
      backgroundColor: c.dangerSoft,
    },
    bannerText: { flex: 1, fontSize: 13, lineHeight: 18, color: c.danger },
    bannerAction: { fontSize: 14, lineHeight: 18, fontWeight: "600", color: c.danger },

    dotSlot: { width: 12, height: 12, alignItems: "center", justifyContent: "center" },
    "dot.online": { ...dot, backgroundColor: c.success },
    "dot.down": { ...dot, backgroundColor: c.danger },
    "dot.checking": {
      ...dot,
      borderWidth: 1.5,
      borderColor: c.textTertiary,
      borderRightColor: "transparent",
    },
    "halo.online": { ...halo, backgroundColor: c.success },
    "halo.down": { ...halo, backgroundColor: c.danger },
    "halo.checking": { ...halo, backgroundColor: c.textTertiary },

    sheetRoot: { flex: 1, justifyContent: "flex-end" },
    scrim: { ...StyleSheet.absoluteFill, backgroundColor: c.scrim },
    sheet: {
      width: "100%",
      maxWidth: 600,
      alignSelf: "center",
      paddingTop: 8,
      paddingHorizontal: 16,
      borderTopLeftRadius: radius.xl,
      borderTopRightRadius: radius.xl,
      backgroundColor: c.bg,
      gap: 14,
    },
    grab: { alignSelf: "center", width: 36, height: 4, borderRadius: 2, backgroundColor: c.border },
    sheetHeader: { flexDirection: "row", alignItems: "center", marginLeft: 4, marginRight: -10, marginTop: -6 },
    sheetTitle: { flex: 1, fontSize: 20, lineHeight: 28, fontWeight: "600", color: c.text },
  } as const;
}
