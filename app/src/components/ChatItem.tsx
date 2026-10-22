import { useState, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { radius, type, useColors } from "../theme";
import type { ChatItem as Item, ToolItem } from "../types";
import { toolSummary } from "../messages";

export function ChatItem({ item }: { item: Item }): ReactNode {
  const colors = useColors();
  const styles = useStyles(colors);

  if (item.kind === "tool") return <ToolCard tool={item} />;
  if (item.kind === "notice") {
    const color =
      item.level === "error" ? colors.danger : item.level === "warning" ? colors.warn : colors.textTertiary;
    return (
      <Text style={[styles.notice, { color }]} selectable>
        {item.text}
      </Text>
    );
  }

  const mine = item.role === "user";
  const system = item.role === "system";
  return (
    <View style={[styles.row, mine ? styles.rowMine : null]}>
      <View
        style={[
          styles.bubble,
          {
            backgroundColor: system ? "transparent" : mine ? colors.userBubble : colors.assistantBubble,
            borderColor: system ? "transparent" : colors.border,
            alignItems: mine ? "flex-end" : "flex-start",
          },
        ]}
      >
        {system ? null : (
          <Text style={[type.tiny, { color: mine ? colors.textSecondary : colors.textTertiary, marginBottom: 4 }]}>
            {mine ? "You" : "OMP"}
          </Text>
        )}
        <Text style={[type.body, { color: system ? colors.textTertiary : colors.text }]} selectable>
          {item.text}
          {item.streaming === true ? <Text style={{ color: colors.link }}> ▍</Text> : null}
        </Text>
        {item.thinking !== undefined && item.thinking !== "" ? <Thinking text={item.thinking} /> : null}
      </View>
    </View>
  );
}

function Thinking({ text }: { text: string }): ReactNode {
  const colors = useColors();
  const [open, setOpen] = useState(false);
  return (
    <Pressable onPress={() => setOpen((value) => !value)} style={{ marginTop: 8 }}>
      <Text style={[type.tiny, { color: colors.textTertiary }]}>{open ? "▾ thinking" : "▸ thinking"}</Text>
      {open ? (
        <Text style={[type.small, { color: colors.textTertiary, marginTop: 6, fontStyle: "italic" }]} selectable>
          {text}
        </Text>
      ) : null}
    </Pressable>
  );
}

function ToolCard({ tool }: { tool: ToolItem }): ReactNode {
  const colors = useColors();
  const styles = useStyles(colors);
  const [open, setOpen] = useState(false);
  const tone = tool.status === "error" ? colors.danger : tool.status === "running" ? colors.warn : colors.success;
  return (
    <Pressable
      onPress={() => setOpen((value) => !value)}
      style={[styles.tool, { backgroundColor: colors.surface, borderColor: colors.border }]}
    >
      <View style={styles.toolHead}>
        <View style={[styles.toolDot, { backgroundColor: tone }]} />
        <Text style={[type.small, { color: colors.text, fontWeight: "600", flex: 1 }]} numberOfLines={1}>
          {tool.name}
        </Text>
        <Text style={[type.tiny, { color: colors.textTertiary }]}>
          {tool.status === "running" ? "running…" : open ? "▾" : "▸"}
        </Text>
      </View>
      {open ? (
        <>
          <Text style={[type.mono, { color: colors.textSecondary, marginTop: 8 }]} selectable>
            {JSON.stringify(tool.args ?? null, null, 2)}
          </Text>
          {tool.result !== undefined || tool.partial !== undefined ? (
            <Text style={[type.mono, { color: colors.textTertiary, marginTop: 8 }]} selectable>
              {toolSummary(tool)}
            </Text>
          ) : null}
        </>
      ) : (
        <Text style={[type.mono, { color: colors.textTertiary, marginTop: 6 }]} numberOfLines={2}>
          {toolSummary(tool) || "…"}
        </Text>
      )}
    </Pressable>
  );
}

function useStyles(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    row: { paddingHorizontal: 16, marginVertical: 4, alignItems: "flex-start" },
    rowMine: { alignItems: "flex-end" },
    bubble: {
      maxWidth: "88%",
      borderRadius: radius.lg,
      borderWidth: StyleSheet.hairlineWidth,
      paddingHorizontal: 13,
      paddingVertical: 10,
    },
    notice: { paddingHorizontal: 20, paddingVertical: 6, textAlign: "center", ...type.small },
    tool: {
      marginHorizontal: 16,
      marginVertical: 5,
      padding: 12,
      borderRadius: radius.md,
      borderWidth: StyleSheet.hairlineWidth,
    },
    toolHead: { flexDirection: "row", alignItems: "center", gap: 8 },
    toolDot: { width: 7, height: 7, borderRadius: 4 },
  });
}
