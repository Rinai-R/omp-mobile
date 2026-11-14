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
import { approvalText, optionLabel } from "../ompText";
import { haptic } from "../haptics";
import { BrandMark, GradientFill } from "./brand";
import { sheetTransforms, useSheetMotion } from "./ui";

type Answer = { value?: string; confirmed?: boolean; cancelled?: boolean };

/** Answers that refuse: drawn in the system red, like a destructive action. */
const REFUSAL = /^(?:(?:deny|reject|no|cancel|abort)\b|否|拒绝)/i;

/** One choice: a full-width row in the action sheet under a hairline, its description under it; refusals in red. */
function Option({
  label,
  description,
  primary,
  onPress,
}: {
  label: string;
  description?: string;
  primary: boolean;
  onPress: () => void;
}): ReactNode {
  const styles = useStyles(createStyles);
  const style = useCallback(
    ({ pressed }: PressableStateCallbackType) => [styles.option, pressed && styles.optionPressed],
    [styles],
  );
  const refusal = REFUSAL.test(label.trim());
  const shown = optionLabel(label);
  return (
    <>
      <View style={styles.separator} />
      <Pressable onPress={onPress} style={style} accessibilityRole="button" accessibilityLabel={shown}>
        <Text style={refusal ? styles.optionRefuse : primary ? styles.optionPrimary : styles.optionLabel}>{shown}</Text>
        {description !== undefined ? <Text style={styles.optionDetail}>{description}</Text> : null}
      </Pressable>
    </>
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

  const reply = useCallback(
    (answer: Answer) => {
      haptic.select();
      onAnswer(answer);
    },
    [onAnswer],
  );
  const cancel = useCallback(() => onAnswer({ cancelled: true }), [onAnswer]);
  const cancelStyle = useCallback(
    ({ pressed }: PressableStateCallbackType) => [styles.cancel, pressed && styles.optionPressed],
    [styles],
  );
  const input = request.method === "input" || request.method === "editor";
  const options = request.options ?? [];
  const text = approvalText(request.title, request.message);
  return (
    <KeyboardAvoidingView style={styles.wrap} behavior="padding">
      <Animated.View style={[styles.scrim, motion.backdrop]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={cancel} accessibilityLabel={t("common.cancel")} />
      </Animated.View>
      <Animated.View style={[styles.sheet, { paddingBottom: 10 + insets.bottom }, motion.sheet]}>
        <View style={styles.group}>
          <ScrollView style={styles.scroll} contentContainerStyle={styles.head} bounces={false}>
            <View style={styles.icon}>
              <GradientFill colors={[colors.accentA, colors.accentV]} radius={26} />
              <BrandMark size={22} color="#ffffff" />
            </View>
            <Text style={styles.title}>{text.heading}</Text>
            {text.details.length > 0 ? (
              <View style={styles.cmd}>
                {text.details.map((detail, index) =>
                  detail.command ? (
                    <Text key={index} style={styles.cmdText} selectable>
                      <Text style={styles.cmdPrompt}>$ </Text>
                      {detail.value}
                    </Text>
                  ) : (
                    <Text key={index} style={styles.cmdText} selectable>
                      {detail.label !== undefined ? <Text style={styles.cmdLabel}>{`${detail.label}  `}</Text> : null}
                      {detail.value}
                    </Text>
                  ),
                )}
              </View>
            ) : null}
            {input ? (
              <View style={[focused ? styles.haloOn : styles.halo, styles.inputWrap]}>
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
            ) : null}
          </ScrollView>

          {request.method === "select" ? (
            <ScrollView style={styles.options} bounces={false}>
              {options.map((option, index) => (
                <Option
                  key={`${option}-${index}`}
                  label={option}
                  description={request.optionDetails?.[index]?.description}
                 
                  primary={index === 0}
                  onPress={() => reply({ value: option })}
                />
              ))}
            </ScrollView>
          ) : null}

          {request.method === "confirm" ? (
            <>
              <Option label={t("approval.yes")} primary onPress={() => reply({ confirmed: true })} />
              <Option label={t("approval.no")} primary={false} onPress={() => reply({ confirmed: false })} />
            </>
          ) : null}

          {input ? <Option label={t("approval.submit")} primary onPress={() => reply({ value })} /> : null}
        </View>

        <Pressable onPress={cancel} style={cancelStyle} accessibilityRole="button">
          <Text style={styles.cancelText}>{t("common.cancel")}</Text>
        </Pressable>
      </Animated.View>
    </KeyboardAvoidingView>
  );
}

function createStyles(c: Palette) {
  const input = {
    fontFamily: SANS,
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
  const option = { fontFamily: SANS, fontSize: 18, lineHeight: 23, textAlign: "center", color: c.tint } as const;
  const surface = c.dark ? "#1c1c1e" : "#f9f9f9";
  return {
    wrap: { ...StyleSheet.absoluteFill, justifyContent: "flex-end" },
    scrim: { ...StyleSheet.absoluteFill, backgroundColor: c.backdrop },
    sheet: { maxHeight: "88%", paddingHorizontal: 8, gap: 8 },
    group: { borderRadius: 14, overflow: "hidden", backgroundColor: surface, flexShrink: 1 },
    scroll: { flexGrow: 0, flexShrink: 1 },
    head: { alignItems: "center", paddingHorizontal: 18, paddingTop: 20, paddingBottom: 16, gap: 10 },
    icon: { width: 52, height: 52, borderRadius: 26, overflow: "hidden", alignItems: "center", justifyContent: "center" },
    title: { fontFamily: SANS, fontSize: 17, lineHeight: 22, fontWeight: "600", letterSpacing: -0.3, color: c.fg, textAlign: "center" },
    cmd: { alignSelf: "stretch", padding: 12, gap: 4, borderRadius: 12, backgroundColor: c.term },
    cmdText: { fontFamily: MONO, fontSize: 12.5, lineHeight: 19, color: c.termFg },
    cmdPrompt: { color: c.cyan },
    cmdLabel: { color: c.dark ? "#8a8b91" : "#9a9ba3" },
    inputWrap: { alignSelf: "stretch" },
    options: { flexGrow: 0, maxHeight: 340 },
    separator: { height: StyleSheet.hairlineWidth, backgroundColor: c.separator },
    option: { minHeight: 56, paddingVertical: 14, paddingHorizontal: 16, justifyContent: "center", gap: 2 },
    optionPressed: { backgroundColor: c.selected },
    optionLabel: option,
    optionPrimary: { ...option, fontWeight: "600" },
    optionRefuse: { ...option, color: c.sysRed },
    optionDetail: { fontFamily: SANS, fontSize: 13, lineHeight: 18, color: c.fgFaint, textAlign: "center" },
    halo,
    haloOn: { ...halo, borderColor: c.ringSoft },
    input,
    inputFocused: { ...input, borderColor: c.ring },
    cancel: { minHeight: 56, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: c.dark ? "#2c2c2e" : "#ffffff" },
    cancelText: { fontFamily: SANS, fontSize: 18, lineHeight: 23, fontWeight: "600", color: c.tint },
  } as const;
}
