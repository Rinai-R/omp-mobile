import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Image, Pressable, StyleSheet, Text, TextInput, View, type StyleProp, type ViewStyle } from "react-native";
import Reanimated, { ReduceMotion, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from "react-native-reanimated";
import Svg, { Circle } from "react-native-svg";
import type { Attachment } from "../attachments";
import { QUICK, QUICK_CSS, popIn, popOut } from "../motion";
import { levelLabel } from "../ompText";
import { t } from "../i18n/index.ts";
import { MONO, SANS, radius, useColors, useStyles, type Palette } from "../theme";
import { BrandMark, GradientFill } from "./brand";
import { CameraGlyph, CloseGlyph, ImageGlyph, PlusGlyph, SendGlyph, StopGlyph } from "./icons";
import { PressableScale } from "./ui";

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
  /** Messages OMP holds for its next step (steers, then follow-ups), as sent. */
  queued: readonly string[];
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
  const reduced = useReducedMotion();
  // The menu grows out of the `+` it hangs over and shrinks back into it.
  const menuIn = useMemo(() => popIn(reduced), [reduced]);
  const menuOut = useMemo(() => popOut(reduced), [reduced]);
  const pick = (source: "library" | "camera") => {
    setMenu(false);
    onAttach(source);
  };
  return (
    <View style={[styles.root, { paddingBottom: 8 + bottomInset }]}>
      {queued.length > 0 ? (
        <View style={styles.queue} accessibilityLabel={t("composer.queued", { count: queued.length })}>
          {queued.slice(0, MAX_QUEUED).map((text, index) => (
            <View key={index} style={styles.queueRow}>
              <Text style={styles.queueLabel} maxFontSizeMultiplier={1.2}>
                {t("composer.queuedLabel")}
              </Text>
              <Text style={styles.queueText} numberOfLines={1} maxFontSizeMultiplier={1.2}>
                {text.replace(/\s+/g, " ").trim()}
              </Text>
            </View>
          ))}
          {queued.length > MAX_QUEUED ? (
            <Text style={styles.queueLabel} maxFontSizeMultiplier={1.2}>
              {t("composer.queuedMore", { count: queued.length - MAX_QUEUED })}
            </Text>
          ) : null}
        </View>
      ) : null}
      <View>
      {menu ? (
        <Reanimated.View entering={menuIn} exiting={menuOut} style={styles.menu}>
          <MenuItem icon={<ImageGlyph size={18} color={colors.fg} />} label={t("composer.library")} onPress={() => pick("library")} />
          <View style={styles.menuDivider} />
          <MenuItem icon={<CameraGlyph size={18} color={colors.fg} />} label={t("composer.camera")} onPress={() => pick("camera")} />
        </Reanimated.View>
      ) : null}
      <View style={styles.row}>
        <PressableScale
          onPress={() => (canAttach ? setMenu((open) => !open) : onAttach("library"))}
          disabled={readOnly}
          style={styles.plus}
          scale={0.94}
          accessibilityRole="button"
          accessibilityLabel={t("composer.attach")}
          accessibilityState={{ expanded: menu }}
        >
          <Reanimated.View style={[styles.plusFill, menu && styles.plusFillOn]} />
          <Reanimated.View style={[styles.plusGlyph, menu && styles.plusTurned]}>
            <PlusGlyph size={18} color={menu ? colors.fgInverse : colors.fgMuted} />
          </Reanimated.View>
        </PressableScale>
        <Reanimated.View style={[styles.box, focused && styles.boxFocused, readOnly && styles.boxOff]}>
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
          <View style={styles.inputRow}>
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
              cursorColor={colors.tint}
              multiline
              style={styles.input}
            />
            <PressableScale
              onPress={action}
              disabled={disabled && mode !== "stop"}
              accessibilityRole="button"
              accessibilityLabel={mode === "stop" ? t("composer.stop") : t("composer.send")}
              hitSlop={6}
              style={styles.action}
              scale={0.94}
            >
              {/* All three faces stay mounted and crossfade, so send ↔ stop morphs instead of swapping. */}
              <Face active={mode === "send" && !disabled} reduced={reduced}>
                <GradientFill />
                <SendGlyph size={16} color="#FFFFFF" />
              </Face>
              <Face active={mode !== "stop" && disabled} reduced={reduced} style={styles.faceOff}>
                <SendGlyph size={16} color={colors.fgGhost} />
              </Face>
              <Face active={mode === "stop"} reduced={reduced} style={styles.faceStop}>
                <StopGlyph size={11} color={colors.fabFg} />
              </Face>
            </PressableScale>
          </View>
        </Reanimated.View>
      </View>
      </View>
      <View style={styles.meta}>
        <PressableScale
          onPress={onModel}
          style={styles.chip}
          pressedStyle={styles.chipPressed}
          accessibilityRole="button"
          accessibilityLabel={level !== undefined ? t("composer.modelLevelA11y", { model, level: levelLabel(level) }) : t("composer.modelA11y", { model })}
          hitSlop={6}
        >
          <BrandMark size={10} />
          <Text style={styles.chipStrong} numberOfLines={1} maxFontSizeMultiplier={1.2}>
            {model}
          </Text>
          {level !== undefined ? (
            <Text style={styles.chipLevel} maxFontSizeMultiplier={1.2}>
              · {levelLabel(level)}
            </Text>
          ) : null}
        </PressableScale>
        {contextPercent !== undefined ? (
          <View style={styles.chip} accessible accessibilityLabel={t("composer.contextA11y", { percent: Math.round(contextPercent) })}>
            <Ring percent={contextPercent} />
            <Text style={styles.chipText} maxFontSizeMultiplier={1.2}>
              {Math.round(contextPercent)}%
            </Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

/** Small, so the face that leaves and the one that arrives overlap without either reading as a pop. */
const FACE_SCALE = 0.8;

/** One face of the send/stop button, faded and scaled in while `active`, out otherwise. */
function Face({ active, reduced, style, children }: { active: boolean; reduced: boolean; style?: StyleProp<ViewStyle>; children: ReactNode }): ReactNode {
  const styles = useStyles(createStyles);
  const shown = useSharedValue(active ? 1 : 0);
  useEffect(() => {
    // Under reduced motion the crossfade stays (it explains the change) and the scale goes.
    shown.set(withTiming(active ? 1 : 0, { ...QUICK, reduceMotion: ReduceMotion.Never }));
  }, [active, shown]);
  const animated = useAnimatedStyle(() => {
    const v = shown.get();
    return { opacity: v, transform: [{ scale: reduced ? 1 : FACE_SCALE + (1 - FACE_SCALE) * v }] };
  }, [reduced]);
  return (
    <Reanimated.View style={[styles.face, style, animated]} pointerEvents="none">
      {children}
    </Reanimated.View>
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

/** Queued messages listed above the field; more are counted. */
const MAX_QUEUED = 3;

const ACTION = 32;
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
  const plus = { ...action, width: 34, height: 34, borderRadius: 17, marginBottom: 2 } as const;
  // State-driven changes with no finger on them: Reanimated CSS transitions, QUICK's curve and length.
  const quick = QUICK_CSS;
  const chip = {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    // Grows with the system font size; the model chip may take most of the row.
    minHeight: 24,
    paddingVertical: 2,
    maxWidth: "78%",
    paddingHorizontal: 6,
    borderRadius: radius.pill,
  } as const;
  const chipText = { fontFamily: SANS, fontSize: 12, lineHeight: 15, color: c.fgFaint } as const;
  return {
    // On the page itself, no slab or hairline: the transcript's fade above it marks the edge while rows run under it.
    root: { paddingHorizontal: 10, paddingTop: 8, backgroundColor: c.bg },
    queue: { gap: 4, paddingHorizontal: 6, paddingBottom: 8 },
    queueRow: { flexDirection: "row", alignItems: "center", gap: 8, minWidth: 0 },
    queueLabel: { fontFamily: SANS, fontSize: 12, lineHeight: 17, fontWeight: "600", color: c.tint },
    queueText: { flex: 1, minWidth: 0, fontFamily: SANS, fontSize: 13, lineHeight: 18, color: c.fgMuted },
    row: { flexDirection: "row", alignItems: "flex-end", gap: 8 },
    box: {
      flex: 1,
      borderRadius: 20,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.dark ? "#ffffff2a" : "#0000001f",
      backgroundColor: c.dark ? "#ffffff08" : "#ffffff",
      padding: 3,
      gap: 6,
      transitionProperty: ["borderColor", "opacity"],
      ...quick,
    },
    boxFocused: { borderColor: c.dark ? "#ffffff48" : "#00000038" },
    boxOff: { opacity: 0.5 },
    inputRow: { flexDirection: "row", alignItems: "flex-end", gap: 4 },
    plus,
    plusFill: { ...StyleSheet.absoluteFill, backgroundColor: c.search, transitionProperty: "backgroundColor", ...quick },
    plusFillOn: { backgroundColor: c.fg },
    plusGlyph: { transform: [{ rotate: "0deg" }], transitionProperty: "transform", ...quick },
    plusTurned: { transform: [{ rotate: "45deg" }] },
    input: {
      flex: 1,
      minHeight: ACTION,
      maxHeight: INPUT_MAX,
      paddingHorizontal: 10,
      paddingTop: 6,
      paddingBottom: 6,
      fontFamily: SANS,
      fontSize: 16,
      lineHeight: 21,
      color: c.fg,
      textAlignVertical: "top",
    },
    action,
    face: { ...StyleSheet.absoluteFill, alignItems: "center", justifyContent: "center" },
    faceOff: { backgroundColor: c.well },
    faceStop: { backgroundColor: c.fab },
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
      // Scales from its corner over the `+`, so it reads as coming out of the button.
      transformOrigin: "left bottom",
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
    meta: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 2, paddingTop: 6, paddingHorizontal: 38 },
    chip,
    chipPressed: { backgroundColor: c.hover },
    chipStrong: { ...chipText, flexShrink: 1, color: c.fgMuted },
    chipText,
    // The level never gives way to the model's name.
    chipLevel: { ...chipText, flexShrink: 0 },
    chipWarn: { ...chipText, color: c.warn },
  } as const;
}
