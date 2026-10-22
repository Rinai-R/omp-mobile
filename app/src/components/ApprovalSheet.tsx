import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type PressableStateCallbackType,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { radius, useColors, useStyles, type Palette } from "../theme";
import type { ApprovalRequest } from "../types";
import { ChevronGlyph } from "./icons";
import { Button } from "./ui";

type Answer = { value?: string; confirmed?: boolean; cancelled?: boolean };

function Option({
  label,
  description,
  last,
  onPress,
}: {
  label: string;
  description?: string;
  last: boolean;
  onPress: () => void;
}): ReactNode {
  const styles = useStyles(createStyles);
  const colors = useColors();
  const style = useCallback(
    ({ pressed }: PressableStateCallbackType) => [last ? styles.option : styles.optionDivided, pressed && styles.pressed],
    [last, styles],
  );
  return (
    <Pressable onPress={onPress} style={style} accessibilityRole="button" accessibilityLabel={label}>
      <View style={styles.optionText}>
        <Text style={styles.optionLabel}>{label}</Text>
        {description !== undefined ? <Text style={styles.optionDetail}>{description}</Text> : null}
      </View>
      <ChevronGlyph color={colors.textTertiary} />
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
  const [value, setValue] = useState(request.prefill ?? "");

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
    <KeyboardAvoidingView style={styles.wrap} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <Pressable style={styles.scrim} onPress={cancel} accessibilityLabel="Cancel" />
      <View style={[styles.sheet, { paddingBottom: 12 + insets.bottom }]}>
        <View style={styles.grab} />
        <Text style={styles.title}>{request.title}</Text>
        {request.message !== undefined ? <Text style={styles.message}>{request.message}</Text> : null}

        {request.method === "select" ? (
          <ScrollView style={styles.options} bounces={false}>
            <View style={styles.group}>
              {options.map((option, index) => (
                <Option
                  key={`${option}-${index}`}
                  label={option}
                  description={request.optionDetails?.[index]?.description}
                  last={index === options.length - 1}
                  onPress={() => onAnswer({ value: option })}
                />
              ))}
            </View>
          </ScrollView>
        ) : null}

        {request.method === "confirm" ? (
          <View style={styles.row}>
            <View style={styles.flex}>
              <Button label="No" kind="plain" onPress={() => onAnswer({ confirmed: false })} />
            </View>
            <View style={styles.flex}>
              <Button label="Yes" onPress={() => onAnswer({ confirmed: true })} />
            </View>
          </View>
        ) : null}

        {input ? (
          <>
            <TextInput
              value={value}
              onChangeText={setValue}
              placeholder={request.placeholder}
              placeholderTextColor={colors.textTertiary}
              multiline
              autoFocus
              style={styles.input}
            />
            <Button label="Submit" onPress={() => onAnswer({ value })} />
          </>
        ) : null}

        <Pressable onPress={cancel} style={cancelStyle} accessibilityRole="button">
          <Text style={styles.cancelText}>Cancel</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

function createStyles(c: Palette) {
  const option = {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    minHeight: 52,
    paddingVertical: 10,
    paddingHorizontal: 14,
  } as const;
  return {
    wrap: { ...StyleSheet.absoluteFill, justifyContent: "flex-end" },
    scrim: { ...StyleSheet.absoluteFill, backgroundColor: c.scrim },
    sheet: {
      width: "100%",
      maxWidth: 600,
      maxHeight: "85%",
      alignSelf: "center",
      paddingTop: 8,
      paddingHorizontal: 16,
      borderTopLeftRadius: radius.xl,
      borderTopRightRadius: radius.xl,
      backgroundColor: c.bg,
      gap: 12,
    },
    grab: { alignSelf: "center", width: 36, height: 4, borderRadius: 2, backgroundColor: c.border },
    title: { fontSize: 20, lineHeight: 28, fontWeight: "600", color: c.text, marginHorizontal: 4 },
    message: { fontSize: 15, lineHeight: 22, color: c.textSecondary, marginHorizontal: 4 },
    options: { flexGrow: 0 },
    group: {
      borderRadius: radius.lg,
      overflow: "hidden",
      backgroundColor: c.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
    },
    option,
    optionDivided: { ...option, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border },
    optionText: { flex: 1, gap: 2 },
    optionLabel: { fontSize: 16, lineHeight: 22, color: c.text },
    optionDetail: { fontSize: 13, lineHeight: 18, color: c.textSecondary },
    pressed: { backgroundColor: c.pressed },
    row: { flexDirection: "row", gap: 10 },
    flex: { flex: 1 },
    input: {
      minHeight: 96,
      maxHeight: 220,
      textAlignVertical: "top",
      borderWidth: StyleSheet.hairlineWidth,
      borderRadius: radius.md,
      padding: 12,
      fontSize: 16,
      lineHeight: 22,
      color: c.text,
      backgroundColor: c.surface,
      borderColor: c.border,
    },
    cancel: { height: 48, alignItems: "center", justifyContent: "center", borderRadius: radius.md },
    cancelText: { fontSize: 15, fontWeight: "500", color: c.textSecondary },
  } as const;
}
