import { useEffect, useState, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { radius, type, useColors } from "../theme";
import type { ApprovalRequest } from "../types";
import { Button } from "./ui";

export function ApprovalSheet({
  request,
  onAnswer,
}: {
  request: ApprovalRequest;
  onAnswer: (answer: { value?: string; confirmed?: boolean; cancelled?: boolean }) => void;
}): ReactNode {
  const colors = useColors();
  const styles = useStyles(colors);
  const [value, setValue] = useState(request.prefill ?? "");

  useEffect(() => {
    setValue(request.prefill ?? "");
  }, [request.id, request.prefill]);

  const input = request.method === "input" || request.method === "editor";
  return (
    <View style={[styles.wrap, { backgroundColor: colors.scrim }]}>
      <View style={[styles.card, { backgroundColor: colors.bg, borderColor: colors.border }]}>
        <Text style={[type.heading, { color: colors.text }]}>{request.title}</Text>
        {request.message !== undefined ? (
          <Text style={[type.body, { color: colors.textSecondary }]}>{request.message}</Text>
        ) : null}

        {request.method === "select"
          ? (request.options ?? []).map((option, index) => (
              <Pressable
                key={`${option}-${index}`}
                onPress={() => onAnswer({ value: option })}
                style={({ pressed }) => [
                  styles.option,
                  { backgroundColor: pressed ? colors.pressed : colors.surface, borderColor: colors.border },
                ]}
              >
                <Text style={[type.body, { color: colors.text }]}>{option}</Text>
                {request.optionDetails?.[index]?.description !== undefined ? (
                  <Text style={[type.small, { color: colors.textSecondary }]}>
                    {request.optionDetails[index]?.description}
                  </Text>
                ) : null}
              </Pressable>
            ))
          : null}

        {request.method === "confirm" ? (
          <View style={styles.row}>
            <Button label="No" kind="plain" onPress={() => onAnswer({ confirmed: false })} />
            <Button label="Yes" onPress={() => onAnswer({ confirmed: true })} />
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
              style={[
                styles.input,
                type.body,
                { color: colors.text, backgroundColor: colors.surface, borderColor: colors.border },
              ]}
            />
            <Button label="Submit" onPress={() => onAnswer({ value })} />
          </>
        ) : null}

        <Pressable onPress={() => onAnswer({ cancelled: true })} style={{ paddingVertical: 8 }}>
          <Text style={[type.small, { color: colors.textTertiary, textAlign: "center" }]}>Cancel</Text>
        </Pressable>
      </View>
    </View>
  );
}

function useStyles(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    wrap: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, justifyContent: "flex-end" },
    card: {
      borderTopLeftRadius: radius.xl,
      borderTopRightRadius: radius.xl,
      borderWidth: StyleSheet.hairlineWidth,
      padding: 20,
      paddingBottom: 30,
      gap: 12,
    },
    option: { padding: 12, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth, gap: 3 },
    row: { flexDirection: "row", justifyContent: "flex-end", gap: 10 },
    input: {
      minHeight: 80,
      textAlignVertical: "top",
      borderWidth: StyleSheet.hairlineWidth,
      borderRadius: radius.md,
      padding: 12,
    },
  });
}
