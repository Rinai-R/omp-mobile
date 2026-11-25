import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type PressableStateCallbackType,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { SANS, MONO, radius, useColors, useStyles, type Palette } from "../theme";
import type { ApprovalRequest } from "../types";
import { t } from "../i18n/index.ts";
import { approvalText, optionLabel } from "../ompText";
import { BrandMark, GradientFill } from "./brand";
import { SheetGrab, SheetHost, SheetSurface, useSheet } from "./ui";

type Answer = { value?: string; confirmed?: boolean; cancelled?: boolean; keys?: string[]; dismiss?: boolean };

/** How a terminal key reads on its button. */
const KEY_LABELS: Record<string, string> = { up: "↑", down: "↓", left: "←", right: "→", enter: "Enter", esc: "Esc", tab: "Tab", space: "Space", y: "y", n: "n" };

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
  // A terminal dialog is not refused by closing the sheet: it stays up in the terminal.
  const keysMode = request.method === "keys";
  const cancel = useCallback(() => onAnswer(keysMode ? { dismiss: true } : { cancelled: true }), [keysMode, onAnswer]);
  // Dragging (by the handle only) or tapping the scrim cancels, once the sheet has left.
  const sheet = useSheet(true, cancel);
  const [value, setValue] = useState(request.prefill ?? "");
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    setValue(request.prefill ?? "");
  }, [request.id, request.prefill]);

  const cancelStyle = useCallback(
    ({ pressed }: PressableStateCallbackType) => [styles.cancel, pressed && styles.optionPressed],
    [styles],
  );
  const input = request.method === "input" || request.method === "editor";
  const supported = input || keysMode || request.method === "select" || request.method === "confirm";
  const options = request.options ?? [];
  const text = approvalText(request.title, request.message);
  return (
    <SheetHost sheet={sheet} modal={false} backdropLabel={t("common.cancel")}>
      <SheetSurface style={[styles.sheet, { paddingBottom: 10 + insets.bottom }]}>
        {/* The handle alone drags: a slip on the options must not cancel the question. */}
        <SheetGrab style={styles.grabArea}>
          <View style={styles.grab} />
        </SheetGrab>
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
            {!supported ? <Text style={styles.unsupported}>{t("approval.unsupported")}</Text> : null}
            {keysMode ? (
              <>
                <View style={styles.screen}>
                  <ScrollView horizontal bounces={false}>
                    <Text style={styles.screenText} selectable>
                      {request.screen ?? ""}
                    </Text>
                  </ScrollView>
                </View>
                <Text style={styles.unsupported}>{t("approval.keys.hint")}</Text>
              </>
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
                  onPress={() => onAnswer({ value: option })}
                />
              ))}
            </ScrollView>
          ) : null}

          {request.method === "confirm" ? (
            <>
              <Option label={t("approval.yes")} primary onPress={() => onAnswer({ confirmed: true })} />
              <Option label={t("approval.no")} primary={false} onPress={() => onAnswer({ confirmed: false })} />
            </>
          ) : null}

          {input ? <Option label={t("approval.submit")} primary onPress={() => onAnswer({ value })} /> : null}

          {keysMode ? (
            <View style={styles.keys}>
              {(request.keys ?? ["up", "down", "enter", "esc"]).map((key) => (
                <Pressable
                  key={key}
                  onPress={() => onAnswer({ keys: [key] })}
                  style={({ pressed }) => [styles.key, pressed && styles.optionPressed]}
                  accessibilityRole="button"
                  accessibilityLabel={key}
                >
                  <Text style={key === "enter" ? styles.keyPrimary : styles.keyText}>{KEY_LABELS[key] ?? key}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}
        </View>

        <Pressable onPress={cancel} style={cancelStyle} accessibilityRole="button">
          <Text style={styles.cancelText}>{keysMode ? t("approval.keys.later") : t("common.cancel")}</Text>
        </Pressable>
      </SheetSurface>
    </SheetHost>
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
    sheet: { maxHeight: "88%", paddingHorizontal: 8, gap: 8 },
    // Drawn on the scrim above the cards, so it is light in both themes; tall enough to catch a thumb.
    grabArea: { alignItems: "center", justifyContent: "center", height: 32, marginBottom: -8 },
    grab: { width: 38, height: 5, borderRadius: 3, backgroundColor: "rgba(255,255,255,0.55)" },
    group: { borderRadius: 14, overflow: "hidden", backgroundColor: surface, flexShrink: 1 },
    scroll: { flexGrow: 0, flexShrink: 1 },
    head: { alignItems: "center", paddingHorizontal: 18, paddingTop: 20, paddingBottom: 16, gap: 10 },
    icon: { width: 52, height: 52, borderRadius: 26, overflow: "hidden", alignItems: "center", justifyContent: "center" },
    title: { fontFamily: SANS, fontSize: 17, lineHeight: 22, fontWeight: "600", letterSpacing: -0.3, color: c.fg, textAlign: "center" },
    unsupported: { fontFamily: SANS, fontSize: 14, lineHeight: 20, color: c.fgMuted, textAlign: "center" },
    cmd: { alignSelf: "stretch", padding: 12, gap: 4, borderRadius: 12, backgroundColor: c.term },
    cmdText: { fontFamily: MONO, fontSize: 12.5, lineHeight: 19, color: c.termFg },
    cmdPrompt: { color: c.cyan },
    cmdLabel: { color: c.dark ? "#8a8b91" : "#9a9ba3" },
    inputWrap: { alignSelf: "stretch" },
    screen: { alignSelf: "stretch", maxHeight: 260, padding: 12, borderRadius: 12, backgroundColor: c.term },
    screenText: { fontFamily: MONO, fontSize: 11.5, lineHeight: 16, color: c.termFg },
    keys: { flexDirection: "row", flexWrap: "wrap", gap: 8, padding: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.separator },
    key: { minWidth: 56, minHeight: 44, paddingHorizontal: 12, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: c.inset },
    keyText: { fontFamily: MONO, fontSize: 15, lineHeight: 20, color: c.fg },
    keyPrimary: { fontFamily: MONO, fontSize: 15, lineHeight: 20, fontWeight: "600", color: c.tint },
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
