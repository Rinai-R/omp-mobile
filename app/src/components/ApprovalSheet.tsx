import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  Animated,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
  type PressableStateCallbackType,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { SANS, MONO, radius, useColors, useStyles, type Palette } from "../theme";
import type { ApprovalRequest } from "../types";
import { t } from "../i18n/index.ts";
import { GradientDot } from "./brand";
import { Button, sheetSurface, sheetTransforms, useSheetMotion } from "./ui";

type Answer = { value?: string; confirmed?: boolean; cancelled?: boolean };

/** One choice: a mono index in accent, the label and its description; pressed, it takes the ring. */
function Option({
  index,
  label,
  description,
  onPress,
}: {
  index: number;
  label: string;
  description?: string;
  onPress: () => void;
}): ReactNode {
  const styles = useStyles(createStyles);
  const style = useCallback(
    ({ pressed }: PressableStateCallbackType) => (pressed ? styles.optionPressed : styles.option),
    [styles],
  );
  return (
    <Pressable onPress={onPress} style={style} accessibilityRole="button" accessibilityLabel={label}>
      <Text style={styles.optionMarker}>{index + 1}</Text>
      <View style={styles.optionText}>
        <Text style={styles.optionLabel}>{label}</Text>
        {description !== undefined ? <Text style={styles.optionDetail}>{description}</Text> : null}
      </View>
    </Pressable>
  );
}

/** OMP's question for the user (select / confirm / input), as a bottom sheet over the chat. */
export function ApprovalSheet({
  request,
  onAnswer,
}: {
  request: ApprovalRequest;
  onAnswer: (answer: Answer) => void;
}): ReactNode {
  const styles = useStyles(createStyles);
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const { progress } = useSheetMotion(true);
  const motion = sheetTransforms(progress, height);
  const [value, setValue] = useState(request.prefill ?? "");
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    setValue(request.prefill ?? "");
  }, [request.id, request.prefill]);

  const cancel = useCallback(() => onAnswer({ cancelled: true }), [onAnswer]);
  const cancelStyle = useCallback(
    ({ pressed }: PressableStateCallbackType) => [styles.cancel, pressed && styles.pressed],
    [styles],
  );
  const input = request.method === "input" || request.method === "editor";
  const options = request.options ?? [];
  return (
    <KeyboardAvoidingView style={styles.wrap} behavior="padding">
      <Animated.View style={[styles.scrim, motion.backdrop]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={cancel} accessibilityLabel={t("common.cancel")} />
      </Animated.View>
      <Animated.View style={[styles.sheet, { paddingBottom: 12 + insets.bottom }, motion.sheet]}>
        <View style={styles.grab} />
        <View style={styles.eyebrow}>
          <GradientDot size={7} />
          <Text style={styles.eyebrowText}>{t("approval.waiting")}</Text>
        </View>
        <Text style={styles.title}>{request.title}</Text>
        {request.message !== undefined ? <Text style={styles.message}>{request.message}</Text> : null}

        {request.method === "select" ? (
          <ScrollView style={styles.options} contentContainerStyle={styles.optionList} bounces={false}>
            {options.map((option, index) => (
              <Option
                key={`${option}-${index}`}
                index={index}
                label={option}
                description={request.optionDetails?.[index]?.description}
                onPress={() => onAnswer({ value: option })}
              />
            ))}
          </ScrollView>
        ) : null}

        {request.method === "confirm" ? (
          <View style={styles.row}>
            <View style={styles.flex}>
              <Button label={t("approval.no")} kind="plain" onPress={() => onAnswer({ confirmed: false })} />
            </View>
            <View style={styles.flex}>
              <Button label={t("approval.yes")} onPress={() => onAnswer({ confirmed: true })} />
            </View>
          </View>
        ) : null}

        {input ? (
          <>
            <View style={focused ? styles.haloOn : styles.halo}>
              <TextInput
                value={value}
                onChangeText={setValue}
                onFocus={() => setFocused(true)}
                onBlur={() => setFocused(false)}
                placeholder={request.placeholder}
                placeholderTextColor={colors.fgFaint}
                selectionColor={colors.ring}
                multiline
                autoFocus
                style={focused ? styles.inputFocused : styles.input}
              />
            </View>
            <Button label={t("approval.submit")} onPress={() => onAnswer({ value })} />
          </>
        ) : null}

        <Pressable onPress={cancel} style={cancelStyle} accessibilityRole="button">
          <Text style={styles.cancelText}>{t("common.cancel")}</Text>
        </Pressable>
      </Animated.View>
    </KeyboardAvoidingView>
  );
}

function createStyles(c: Palette) {
  const option = {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    minHeight: 48,
    paddingVertical: 11,
    paddingHorizontal: 12,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: c.border,
    backgroundColor: c.raised,
  } as const;
  const input = { fontFamily: SANS,
    minHeight: 96,
    maxHeight: 220,
    textAlignVertical: "top",
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    padding: 12,
    fontSize: 15,
    lineHeight: 22,
    color: c.fg,
    backgroundColor: c.inset,
    borderColor: c.borderStrong,
  } as const;
  const halo = { borderRadius: radius.md + 3, borderWidth: 3, margin: -3, borderColor: "transparent" } as const;
  return {
    wrap: { ...StyleSheet.absoluteFill, justifyContent: "flex-end" },
    scrim: { ...StyleSheet.absoluteFill, backgroundColor: c.backdrop },
    sheet: { ...sheetSurface(c), maxHeight: "85%", gap: 12 },
    grab: { alignSelf: "center", width: 36, height: 4, borderRadius: 2, backgroundColor: c.borderStrong },
    eyebrow: { flexDirection: "row", alignItems: "center", gap: 7, marginHorizontal: 2, marginTop: 4 },
    eyebrowText: { fontFamily: MONO, fontSize: 11, lineHeight: 15, color: c.fgFaint },
    title: { fontFamily: SANS, fontSize: 17, lineHeight: 24, fontWeight: "600", letterSpacing: -0.2, color: c.fg, marginHorizontal: 2 },
    message: { fontFamily: SANS, fontSize: 14, lineHeight: 21, color: c.fgMuted, marginHorizontal: 2 },
    options: { flexGrow: 0 },
    optionList: { gap: 6 },
    option,
    optionPressed: { ...option, borderColor: c.ring, backgroundColor: c.ringSoft },
    optionMarker: { width: 16, fontFamily: MONO, fontSize: 12.5, lineHeight: 20, color: c.accent },
    optionText: { flex: 1, gap: 2 },
    optionLabel: { fontFamily: SANS, fontSize: 14.5, lineHeight: 20, fontWeight: "500", color: c.fg },
    optionDetail: { fontFamily: SANS, fontSize: 12.5, lineHeight: 18, color: c.fgMuted },
    pressed: { backgroundColor: c.hover },
    row: { flexDirection: "row", gap: 10 },
    flex: { flex: 1 },
    halo,
    haloOn: { ...halo, borderColor: c.ringSoft },
    input,
    inputFocused: { ...input, borderColor: c.ring },
    cancel: { height: 44, alignItems: "center", justifyContent: "center", borderRadius: radius.md },
    cancelText: { fontFamily: SANS, fontSize: 15, fontWeight: "500", color: c.fgMuted },
  } as const;
}
