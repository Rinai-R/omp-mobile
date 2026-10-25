import { useCallback, useState, type ReactNode } from "react";
import { Image, Pressable, StyleSheet, Text, TextInput, View, type PressableStateCallbackType } from "react-native";
import Svg, { Circle } from "react-native-svg";
import type { Attachment } from "../attachments";
import { t } from "../i18n/index.ts";
import { MONO, SANS, radius, useColors, useStyles, type Palette } from "../theme";
import { BrandMark, GradientFill } from "./brand";
import { CameraGlyph, CloseGlyph, ImageGlyph, PlusGlyph, SendGlyph, StopGlyph } from "./icons";

/**
 * The message box: attached photos above the text, `+` for photos on its left,
 * send or stop on its right, and one quiet line of session facts under it
 * (model and thinking, context use, queued messages).
 */
export function Composer({
  draft,
  onChangeDraft,
  attachments,
  onRemoveAttachment,
  onAttach,
  canAttach,
  streaming,
  connected,
  offline = false,
  readOnly,
  onSend,
  onStop,
  model,
  level,
  contextPercent,
  queued,
  onModel,
  bottomInset,
}: {
  draft: string;
  onChangeDraft: (text: string) => void;
  attachments: readonly Attachment[];
  onRemoveAttachment: (id: string) => void;
  onAttach: (source: "library" | "camera") => void;
  /** The computer accepts photos; when false `+` explains instead of opening the menu. */
  canAttach: boolean;
  streaming: boolean;
  connected: boolean;
  /** The computer has not been reached for a while: nothing can be sent until it is. */
  offline?: boolean;
  /** The session cannot take messages (it failed to open). */
  readOnly: boolean;
  onSend: () => void;
  onStop: () => void;
  model: string;
  level: string | undefined;
  contextPercent: number | undefined;
  queued: number;
  onModel: () => void;
  bottomInset: number;
}): ReactNode {
  const styles = useStyles(createStyles);
  const colors = useColors();
  const [focused, setFocused] = useState(false);
  const [menu, setMenu] = useState(false);
  const hasContent = draft.trim() !== "" || attachments.length > 0;
  const mode: "send" | "stop" | "idle" = hasContent ? "send" : streaming ? "stop" : "idle";
  const disabled = readOnly || !connected || mode === "idle";
  const action = mode === "stop" ? onStop : onSend;
  const actionStyle = useCallback(
    ({ pressed }: PressableStateCallbackType) => [
      mode === "stop" ? styles.stop : disabled ? styles.sendOff : styles.send,
      pressed && !disabled && styles.pressedScale,
    ],
    [disabled, mode, styles],
  );
  const pick = useCallback(
    (source: "library" | "camera") => {
      setMenu(false);
      onAttach(source);
    },
    [onAttach],
  );
  return (
    <View style={[styles.root, { paddingBottom: 8 + bottomInset }]}>
      <View>
      {menu ? (
        <View style={styles.menu}>
          <MenuItem icon={<ImageGlyph size={18} color={colors.fg} />} label={t("composer.library")} onPress={() => pick("library")} />
          <View style={styles.menuDivider} />
          <MenuItem icon={<CameraGlyph size={18} color={colors.fg} />} label={t("composer.camera")} onPress={() => pick("camera")} />
        </View>
      ) : null}
      <View style={[styles.box, focused && styles.boxFocused, readOnly && styles.boxOff]}>
        {attachments.length > 0 ? (
          <View style={styles.attachments}>
            {attachments.map((item) => (
              <View key={item.id} style={styles.attachment}>
                <Image source={{ uri: item.uri }} style={styles.attachmentImage} />
                <Pressable
                  onPress={() => onRemoveAttachment(item.id)}
                  hitSlop={8}
                  style={styles.attachmentRemove}
                  accessibilityRole="button"
                  accessibilityLabel={t("composer.removePhoto")}
                >
                  <CloseGlyph size={10} color={colors.fg} />
                </Pressable>
              </View>
            ))}
          </View>
        ) : null}
        <View style={styles.row}>
          <Pressable
            onPress={() => (canAttach ? setMenu((open) => !open) : onAttach("library"))}
            disabled={readOnly}
            style={({ pressed }) => [menu ? styles.plusOn : styles.plus, pressed && styles.pressedScale]}
            accessibilityRole="button"
            accessibilityLabel={t("composer.attach")}
            accessibilityState={{ expanded: menu }}
          >
            <View style={menu ? styles.plusTurned : undefined}>
              <PlusGlyph size={18} color={menu ? colors.fgInverse : colors.fgMuted} />
            </View>
          </Pressable>
          <TextInput
            value={draft}
            onChangeText={onChangeDraft}
            onFocus={() => {
              setFocused(true);
              setMenu(false);
            }}
            onBlur={() => setFocused(false)}
            editable={!readOnly}
            placeholder={
              readOnly
                ? t("composer.placeholder.closed")
                : offline
                  ? t("composer.placeholder.offline")
                  : streaming
                    ? t("composer.placeholder.steer")
                    : t("composer.placeholder")
            }
            placeholderTextColor={colors.fgGhost}
            selectionColor={colors.ring}
            cursorColor={colors.accent}
            multiline
            style={styles.input}
          />
          <Pressable
            onPress={action}
            disabled={disabled && mode !== "stop"}
            accessibilityRole="button"
            accessibilityLabel={mode === "stop" ? t("composer.stop") : t("composer.send")}
            hitSlop={6}
            style={actionStyle}
          >
            {mode === "stop" ? (
              <StopGlyph size={12} color={colors.bg} />
            ) : (
              <>
                {disabled ? null : <GradientFill />}
                <SendGlyph size={18} color={disabled ? colors.fgGhost : "#FFFFFF"} />
              </>
            )}
          </Pressable>
        </View>
      </View>
      </View>
      <View style={styles.meta}>
        <Pressable
          onPress={onModel}
          style={({ pressed }) => [styles.chip, pressed && styles.chipPressed]}
          accessibilityRole="button"
          accessibilityLabel={level !== undefined ? t("composer.modelLevelA11y", { model, level }) : t("composer.modelA11y", { model })}
          hitSlop={6}
        >
          <BrandMark size={10} />
          <Text style={styles.chipStrong} numberOfLines={1}>
            {model}
          </Text>
          {level !== undefined ? <Text style={styles.chipText}>· {level}</Text> : null}
        </Pressable>
        {contextPercent !== undefined ? (
          <View style={styles.chip} accessible accessibilityLabel={t("composer.contextA11y", { percent: Math.round(contextPercent) })}>
            <Ring percent={contextPercent} />
            <Text style={styles.chipText}>{Math.round(contextPercent)}%</Text>
          </View>
        ) : null}
        {queued > 0 ? (
          <View style={styles.chip}>
            <Text style={styles.chipWarn}>{t("composer.queued", { count: queued })}</Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

function MenuItem({ icon, label, onPress }: { icon: ReactNode; label: string; onPress: () => void }): ReactNode {
  const styles = useStyles(createStyles);
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.menuItem, pressed && styles.menuItemPressed]} accessibilityRole="button">
      {icon}
      <Text style={styles.menuText}>{label}</Text>
    </Pressable>
  );
}

/** Context used, as a thin ring: cyan, warn above 80 %. */
function Ring({ percent }: { percent: number }): ReactNode {
  const colors = useColors();
  const size = 13;
  const stroke = 2;
  const r = (size - stroke) / 2;
  const length = 2 * Math.PI * r;
  const shown = Math.max(0, Math.min(100, percent));
  return (
    <Svg width={size} height={size} style={{ transform: [{ rotate: "-90deg" }] }}>
      <Circle cx={size / 2} cy={size / 2} r={r} stroke={colors.well} strokeWidth={stroke} fill="none" />
      <Circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        stroke={shown >= 80 ? colors.warn : colors.cyan}
        strokeWidth={stroke}
        fill="none"
        strokeLinecap="round"
        strokeDasharray={`${(length * shown) / 100} ${length}`}
      />
    </Svg>
  );
}

const ACTION = 36;
/** Six lines of 21 px text plus padding. */
const INPUT_MAX = 21 * 6 + 16;

function createStyles(c: Palette) {
  const action = {
    width: ACTION,
    height: ACTION,
    borderRadius: ACTION / 2,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  } as const;
  const plus = { ...action, backgroundColor: c.well } as const;
  const chip = {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    height: 26,
    maxWidth: "62%",
    paddingHorizontal: 10,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: c.border,
    backgroundColor: c.panel,
  } as const;
  const chipText = { fontFamily: MONO, fontSize: 11, lineHeight: 14, color: c.fgFaint } as const;
  return {
    root: { paddingHorizontal: 12, paddingTop: 6, backgroundColor: c.bg },
    box: {
      borderRadius: radius.xxl,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.borderStrong,
      backgroundColor: c.panel,
      padding: 7,
      gap: 8,
    },
    boxFocused: { borderColor: c.dark ? "#ffffff38" : "#0000002e" },
    boxOff: { opacity: 0.5 },
    row: { flexDirection: "row", alignItems: "flex-end", gap: 6 },
    plus,
    plusOn: { ...plus, backgroundColor: c.fg },
    plusTurned: { transform: [{ rotate: "45deg" }] },
    input: {
      flex: 1,
      minHeight: ACTION,
      maxHeight: INPUT_MAX,
      paddingHorizontal: 6,
      paddingTop: 7,
      paddingBottom: 7,
      fontFamily: SANS,
      fontSize: 15,
      lineHeight: 21,
      color: c.fg,
      textAlignVertical: "top",
    },
    send: action,
    sendOff: { ...action, backgroundColor: c.well },
    stop: { ...action, backgroundColor: c.fg },
    pressedScale: { transform: [{ scale: 0.94 }] },
    attachments: { flexDirection: "row", flexWrap: "wrap", gap: 8, paddingHorizontal: 3, paddingTop: 3 },
    attachment: { width: 58, height: 58 },
    attachmentImage: { width: 58, height: 58, borderRadius: 12, backgroundColor: c.inset },
    attachmentRemove: {
      position: "absolute",
      top: -6,
      right: -6,
      width: 20,
      height: 20,
      borderRadius: 10,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: c.well,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.borderStrong,
    },
    menu: {
      position: "absolute",
      left: 0,
      bottom: "100%",
      marginBottom: 8,
      minWidth: 200,
      borderRadius: radius.xl,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.borderStrong,
      backgroundColor: c.overlay,
      paddingVertical: 4,
      zIndex: 5,
      elevation: 12,
      shadowColor: "#000",
      shadowOpacity: 0.35,
      shadowRadius: 20,
      shadowOffset: { width: 0, height: 8 },
    },
    menuItem: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 46, paddingHorizontal: 16 },
    menuItemPressed: { backgroundColor: c.hover },
    menuText: { fontFamily: SANS, fontSize: 15, lineHeight: 20, color: c.fg },
    menuDivider: { height: StyleSheet.hairlineWidth, backgroundColor: c.border, marginHorizontal: 12 },
    meta: { flexDirection: "row", alignItems: "center", gap: 6, paddingTop: 8, paddingHorizontal: 2 },
    chip,
    chipPressed: { backgroundColor: c.hover },
    chipStrong: { ...chipText, flexShrink: 1, color: c.fgMuted },
    chipText,
    chipWarn: { ...chipText, color: c.warn },
  } as const;
}
