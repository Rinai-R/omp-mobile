import { memo, useCallback, useState, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View, type PressableStateCallbackType } from "react-native";
import { toolSummary } from "../messages";
import { MONO, radius, useColors, useStyles, type Palette } from "../theme";
import type { ChatItem as Item, MessageItem, ToolItem } from "../types";
import { ChevronDownGlyph, ChevronGlyph, ToolGlyph } from "./icons";
import { Markdown } from "./Markdown";

function ChatItemImpl({ item }: { item: Item }): ReactNode {
  if (item.kind === "tool") return <ToolCard tool={item} />;
  if (item.kind === "notice") return <Notice level={item.level} text={item.text} />;
  return <Message item={item} />;
}

export const ChatItem = memo(ChatItemImpl);

function Notice({ level, text }: { level: "info" | "warning" | "error"; text: string }): ReactNode {
  const styles = useStyles(createStyles);
  return (
    <Text
      style={level === "error" ? styles.noticeError : level === "warning" ? styles.noticeWarn : styles.notice}
      selectable
    >
      {text}
    </Text>
  );
}

function Caret(): ReactNode {
  const styles = useStyles(createStyles);
  return <Text style={styles.caret}> ▍</Text>;
}

function Message({ item }: { item: MessageItem }): ReactNode {
  const styles = useStyles(createStyles);
  const streaming = item.streaming === true;
  const thinking = item.thinking !== undefined && item.thinking !== "" ? item.thinking : null;

  if (item.role === "user") {
    return (
      <View style={styles.userRow}>
        <View style={styles.userBubble}>
          <Text style={styles.userText} selectable>
            {item.text}
          </Text>
        </View>
      </View>
    );
  }
  if (item.role === "system") {
    return (
      <Text style={styles.system} selectable>
        {item.text}
      </Text>
    );
  }
  return (
    <View style={styles.assistant}>
      {thinking !== null ? <Thinking text={thinking} active={streaming && item.text === ""} /> : null}
      {item.text !== "" ? (
        <Markdown text={item.text} caret={streaming ? <Caret /> : undefined} />
      ) : streaming && thinking === null ? (
        <Text style={styles.waiting}>
          <Caret />
        </Text>
      ) : null}
    </View>
  );
}

function Thinking({ text, active }: { text: string; active: boolean }): ReactNode {
  const styles = useStyles(createStyles);
  const colors = useColors();
  const [open, setOpen] = useState(false);
  const toggle = useCallback(() => setOpen((value) => !value), []);
  return (
    <View style={styles.thinking}>
      <Pressable
        onPress={toggle}
        hitSlop={8}
        style={styles.thinkingHead}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
      >
        <Text style={styles.thinkingLabel}>{active ? "Thinking…" : "Thought"}</Text>
        {open ? (
          <ChevronDownGlyph size={14} color={colors.textTertiary} />
        ) : (
          <ChevronGlyph size={14} color={colors.textTertiary} />
        )}
      </Pressable>
      {open ? (
        <Text style={styles.thinkingText} selectable>
          {text}
        </Text>
      ) : null}
    </View>
  );
}

function pretty(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value ?? null, null, 2);
  } catch {
    return String(value);
  }
}

/** The tool's first argument worth showing on one line: a command, a path, a pattern. */
function argSummary(args: unknown): string {
  if (typeof args === "string") return args;
  if (args === null || typeof args !== "object") return "";
  const record = args as Record<string, unknown>;
  for (const key of ["command", "cmd", "path", "file_path", "file", "pattern", "query", "url", "description"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim() !== "") return value;
  }
  const first = Object.values(record).find((value) => typeof value === "string");
  return typeof first === "string" ? first : "";
}

function ToolCard({ tool }: { tool: ToolItem }): ReactNode {
  const styles = useStyles(createStyles);
  const colors = useColors();
  const [open, setOpen] = useState(false);
  const toggle = useCallback(() => setOpen((value) => !value), []);
  const style = useCallback(
    ({ pressed }: PressableStateCallbackType) => [styles.toolHead, pressed && styles.pressed],
    [styles],
  );
  const dot = tool.status === "error" ? styles.dotError : tool.status === "running" ? styles.dotRunning : styles.dotDone;
  const summary = (argSummary(tool.args) || toolSummary(tool)).replace(/\s+/g, " ").slice(0, 200);
  const output = tool.result ?? tool.partial;
  return (
    <View style={styles.tool}>
      <Pressable
        onPress={toggle}
        style={style}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`${tool.name}, ${tool.status}`}
      >
        <ToolGlyph size={15} color={colors.textSecondary} />
        <Text style={styles.toolName} numberOfLines={1}>
          {tool.name}
        </Text>
        <Text style={styles.toolSummary} numberOfLines={1}>
          {summary}
        </Text>
        <View style={dot} />
        {open ? (
          <ChevronDownGlyph size={14} color={colors.textTertiary} />
        ) : (
          <ChevronGlyph size={14} color={colors.textTertiary} />
        )}
      </Pressable>
      {open ? (
        <View style={styles.toolBody}>
          <Text style={styles.toolLabel}>Arguments</Text>
          <Text style={styles.mono} selectable>
            {pretty(tool.args)}
          </Text>
          {output !== undefined ? (
            <>
              <Text style={styles.toolLabel}>{tool.isError === true ? "Error" : "Result"}</Text>
              <Text style={tool.isError === true ? styles.monoError : styles.mono} selectable numberOfLines={60}>
                {pretty(output)}
              </Text>
            </>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function createStyles(c: Palette) {
  const notice = { paddingHorizontal: 24, paddingVertical: 6, textAlign: "center", fontSize: 13, lineHeight: 18 } as const;
  const dot = { width: 7, height: 7, borderRadius: 4 } as const;
  const mono = { fontFamily: MONO, fontSize: 12, lineHeight: 17, color: c.textSecondary } as const;
  return {
    notice: { ...notice, color: c.textTertiary },
    noticeWarn: { ...notice, color: c.warn },
    noticeError: { ...notice, color: c.danger },
    caret: { color: c.link },
    userRow: { paddingHorizontal: 16, marginVertical: 6, alignItems: "flex-end" },
    userBubble: {
      maxWidth: "85%",
      borderRadius: radius.xl,
      borderBottomRightRadius: radius.sm,
      paddingHorizontal: 14,
      paddingVertical: 9,
      backgroundColor: c.userBubble,
    },
    userText: { fontSize: 15, lineHeight: 22, color: c.text },
    system: { ...notice, color: c.textTertiary },
    assistant: { paddingHorizontal: 18, marginVertical: 6, gap: 6 },
    waiting: { fontSize: 15, lineHeight: 22 },
    thinking: { gap: 6 },
    thinkingHead: { flexDirection: "row", alignItems: "center", gap: 4, alignSelf: "flex-start" },
    thinkingLabel: { fontSize: 13, lineHeight: 18, color: c.textTertiary, fontWeight: "500" },
    thinkingText: {
      fontSize: 13,
      lineHeight: 19,
      color: c.textTertiary,
      fontStyle: "italic",
      borderLeftWidth: 2,
      borderLeftColor: c.border,
      paddingLeft: 10,
    },
    tool: {
      marginHorizontal: 16,
      marginVertical: 3,
      borderRadius: radius.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
      backgroundColor: c.surface,
      overflow: "hidden",
    },
    toolHead: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      minHeight: 40,
      paddingHorizontal: 12,
      paddingVertical: 8,
    },
    pressed: { backgroundColor: c.pressed },
    toolName: { fontSize: 13, lineHeight: 18, fontWeight: "600", color: c.text, flexShrink: 0, maxWidth: "45%" },
    toolSummary: { ...mono, flex: 1, color: c.textTertiary },
    dotRunning: { ...dot, backgroundColor: c.warn },
    dotDone: { ...dot, backgroundColor: c.success },
    dotError: { ...dot, backgroundColor: c.danger },
    toolBody: {
      gap: 6,
      paddingHorizontal: 12,
      paddingBottom: 12,
      paddingTop: 8,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: c.border,
      backgroundColor: c.code,
    },
    toolLabel: { fontSize: 11, lineHeight: 14, color: c.textTertiary, textTransform: "uppercase", letterSpacing: 0.6 },
    mono,
    monoError: { ...mono, color: c.danger },
  } as const;
}
