import { memo, useCallback, useMemo, useState, type ReactNode } from "react";
import { Animated, Image, Pressable, StyleSheet, Text, View, type PressableStateCallbackType } from "react-native";
import { imageUri } from "../media";
import { diffLines, editInput, editSides, type DiffLine } from "../diff";
import { resultText, toolSummary } from "../messages";
import { MONO, radius, useColors, useStyles, type Palette } from "../theme";
import type { ChatItem as Item, ImagePart, Machine, MessageItem, ToolItem } from "../types";
import { Spinner, StreamPulse, useEnter, usePulse } from "./brand";
import { Markdown } from "./Markdown";
import { Disclosure } from "./ui";

/**
 * One transcript row in the my.omp.sh style: a mono role label over each turn,
 * the user's turn as a raised block, the reply as full-width prose, tool calls
 * as compact rows that open onto inset output, and notices as faint mono lines.
 */
function ChatItemImpl({ item, machine }: { item: Item; machine: Machine }): ReactNode {
  const enter = useEnter(320);
  const style = {
    opacity: enter,
    transform: [{ translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [6, 0] }) }],
  };
  let body: ReactNode;
  if (item.kind === "tool") body = <ToolCard tool={item} machine={machine} />;
  else if (item.kind === "notice") body = <Notice level={item.level} text={item.text} />;
  else body = <Message item={item} machine={machine} />;
  return <Animated.View style={style}>{body}</Animated.View>;
}

export const ChatItem = memo(ChatItemImpl);

/** Images OMP attached to a message or a tool result; a broken blob simply does not render. */
function Images({ parts, machine }: { parts: ImagePart[] | undefined; machine: Machine }): ReactNode {
  const styles = useStyles(createStyles);
  const uris = useMemo(
    () =>
      (parts ?? [])
        .map((part) => imageUri(machine, part))
        .filter((uri): uri is string => uri !== undefined),
    [machine, parts],
  );
  if (uris.length === 0) return null;
  return (
    <View style={styles.images}>
      {uris.map((uri, index) => (
        <Image
          key={`${index}-${uri.slice(0, 32)}`}
          source={{ uri, headers: { authorization: `Bearer ${machine.token}` } }}
          style={styles.image}
          resizeMode="contain"
          accessibilityLabel="Image"
        />
      ))}
    </View>
  );
}

function Notice({ level, text }: { level: "info" | "warning" | "error"; text: string }): ReactNode {
  const styles = useStyles(createStyles);
  return (
    <View style={styles.noticeRow}>
      <View style={level === "error" ? styles.noticeDotError : level === "warning" ? styles.noticeDotWarn : styles.noticeDot} />
      <Text
        style={level === "error" ? styles.noticeError : level === "warning" ? styles.noticeWarn : styles.notice}
        selectable
      >
        {text}
      </Text>
    </View>
  );
}

function Caret(): ReactNode {
  const styles = useStyles(createStyles);
  return <Text style={styles.caret}> ▍</Text>;
}

function Message({ item, machine }: { item: MessageItem; machine: Machine }): ReactNode {
  const styles = useStyles(createStyles);
  const streaming = item.streaming === true;
  const thinking = item.thinking !== undefined && item.thinking !== "" ? item.thinking : null;

  if (item.role === "user") {
    return (
      <View style={styles.turn}>
        <Text style={styles.gutterUser}>you</Text>
        <View style={styles.userBlock}>
          <Images parts={item.images} machine={machine} />
          {item.text.trim() !== "" ? (
            <Text style={styles.userText} selectable>
              {item.text}
            </Text>
          ) : null}
        </View>
      </View>
    );
  }
  if (item.role === "system") {
    return (
      <View style={styles.noticeRow}>
        <View style={styles.noticeDot} />
        <Text style={styles.notice} selectable>
          {item.text}
        </Text>
      </View>
    );
  }
  return (
    <View style={styles.turn}>
      <Text style={styles.gutter}>omp</Text>
      <View style={styles.assistant}>
        {thinking !== null ? <Thinking text={thinking} active={streaming && item.text === ""} /> : null}
        {item.text !== "" ? <Markdown text={item.text} caret={streaming ? <Caret /> : undefined} /> : null}
        {streaming ? <StreamPulse /> : null}
      </View>
    </View>
  );
}

function Thinking({ text, active }: { text: string; active: boolean }): ReactNode {
  const styles = useStyles(createStyles);
  const [open, setOpen] = useState(false);
  const toggle = useCallback(() => setOpen((value) => !value), []);
  const pulse = usePulse(active, 1400);
  const opacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 0.45] });
  return (
    <View style={styles.thinking}>
      <Pressable
        onPress={toggle}
        hitSlop={8}
        style={styles.thinkingHead}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
      >
        <Animated.Text style={[styles.thinkingLabel, { opacity }]}>{active ? "Thinking…" : "Thought"}</Animated.Text>
        <Disclosure open={open} size={12} />
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
  const entries = new Map(Object.entries(args));
  for (const key of ["command", "cmd", "path", "file_path", "file", "pattern", "query", "url", "description"]) {
    const value = entries.get(key);
    if (typeof value === "string" && value.trim() !== "") return value;
  }
  for (const value of entries.values()) if (typeof value === "string") return value;
  return "";
}

/** Arguments without OMP's `i` intent line, which the card already shows on its head. */
function withoutIntent(args: unknown): unknown {
  if (args === null || typeof args !== "object" || Array.isArray(args) || !("i" in args)) return args;
  const rest: Record<string, unknown> = { ...args };
  delete rest.i;
  return Object.keys(rest).length === 0 ? undefined : rest;
}

/** A shell command in the arguments, shown as a `$` line; the other arguments stay as JSON. */
function splitCommand(args: unknown): { command: string | null; rest: unknown } {
  if (args === null || typeof args !== "object" || Array.isArray(args)) return { command: null, rest: args };
  if (!("command" in args) || typeof args.command !== "string") return { command: null, rest: withoutIntent(args) };
  const rest: Record<string, unknown> = { ...args };
  delete rest.command;
  delete rest.i;
  return { command: args.command, rest: Object.keys(rest).length > 0 ? rest : undefined };
}

/** An edit's lines: two sides diffed, or the preformatted `input` block an edit tool may carry instead. */
function editDiff(args: unknown): DiffLine[] | undefined {
  const sides = editSides(args);
  if (sides !== undefined) return diffLines(sides.before, sides.after);
  const input = editInput(args);
  if (input === undefined) return undefined;
  return input.split("\n").map((line): DiffLine => {
    if (line.startsWith("+")) return { kind: "add", text: line.slice(1) };
    if (line.startsWith("-")) return { kind: "remove", text: line.slice(1) };
    return { kind: "same", text: line };
  });
}

/** The lines of an edit call in a mono block, additions and removals colored. */
function Diff({ lines }: { lines: DiffLine[] }): ReactNode {
  const styles = useStyles(createStyles);
  return (
    <View style={styles.pre}>
      {lines.map((line, index) => (
        <Text
          key={`${index}-${line.text}`}
          style={
            line.kind === "add" ? styles.diffAdd : line.kind === "remove" ? styles.diffRemove : styles.diffSame
          }
          selectable
        >
          {line.kind === "add" ? "+" : line.kind === "remove" ? "-" : " "}
          {line.text}
        </Text>
      ))}
    </View>
  );
}

function ToolCard({ tool, machine }: { tool: ToolItem; machine: Machine }): ReactNode {
  const styles = useStyles(createStyles);
  const colors = useColors();
  const [open, setOpen] = useState(false);
  const toggle = useCallback(() => setOpen((value) => !value), []);
  const style = useCallback(
    ({ pressed }: PressableStateCallbackType) => [styles.toolHead, pressed && styles.pressed],
    [styles],
  );
  const failed = tool.status === "error";
  const summary = ([tool.intent, argSummary(tool.args), toolSummary(tool)].find(
    (value) => value !== undefined && value.trim() !== "",
  ) ?? "").replace(/\s+/g, " ").slice(0, 200);
  const output = tool.result ?? tool.partial;
  const { command, rest } = splitCommand(tool.args);
  const diff = tool.name === "edit" ? editDiff(tool.args) : undefined;
  return (
    <View style={failed ? styles.toolFailed : styles.tool}>
      <Pressable
        onPress={toggle}
        style={style}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`${tool.name}, ${tool.status}`}
      >
        <View style={styles.statusSlot}>
          {tool.status === "running" ? (
            <Spinner size={9} color={colors.accent} />
          ) : (
            <View style={failed ? styles.dotError : styles.dotDone} />
          )}
        </View>
        <Text style={styles.toolName} numberOfLines={1}>
          {tool.name}
        </Text>
        <Text style={styles.toolSummary} numberOfLines={1}>
          {summary}
        </Text>
        <Disclosure open={open} size={12} />
      </Pressable>
      <Images parts={tool.images} machine={machine} />
      {open ? (
        <View style={styles.toolBody}>
          <View>
            <Text style={styles.outTitle}>Input</Text>
            {diff !== undefined ? (
              <Diff lines={diff} />
            ) : (
              <>
                {command !== null ? (
                  <View style={styles.pre}>
                    <Text style={styles.monoText} selectable>
                      <Text style={styles.prompt}>$ </Text>
                      {command}
                    </Text>
                  </View>
                ) : null}
                {rest !== undefined ? (
                  <View style={command !== null ? styles.preNext : styles.pre}>
                    <Text style={styles.monoText} selectable>
                      {pretty(rest)}
                    </Text>
                  </View>
                ) : null}
              </>
            )}
          </View>
          {output !== undefined ? (
            <View>
              <Text style={tool.isError === true ? styles.outTitleError : styles.outTitle}>
                {tool.isError === true ? "Error" : "Output"}
              </Text>
              <View style={styles.pre}>
                <Text style={tool.isError === true ? styles.monoError : styles.monoText} selectable numberOfLines={60}>
                  {resultText(output) ?? pretty(output)}
                </Text>
              </View>
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function createStyles(c: Palette) {
  const notice = { flex: 1, fontFamily: MONO, fontSize: 11.5, lineHeight: 17 } as const;
  const noticeDot = { width: 5, height: 5, borderRadius: 3, marginTop: 6 } as const;
  const dot = { width: 7, height: 7, borderRadius: 4 } as const;
  const mono = { fontFamily: MONO, fontSize: 11.5, lineHeight: 17, color: c.fg } as const;
  const gutter = {
    fontFamily: MONO,
    fontSize: 11,
    lineHeight: 15,
    fontWeight: "500",
    color: c.fgFaint,
    marginBottom: 4,
  } as const;
  const tool = {
    marginHorizontal: 16,
    marginVertical: 3,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: c.border,
    backgroundColor: c.raised,
    overflow: "hidden",
  } as const;
  const outTitle = {
    fontFamily: MONO,
    fontSize: 10,
    lineHeight: 14,
    letterSpacing: 0.5,
    textTransform: "uppercase",
    color: c.fgFaint,
    paddingBottom: 4,
    paddingHorizontal: 1,
  } as const;
  const pre = { borderRadius: 4, backgroundColor: c.inset, paddingHorizontal: 9, paddingVertical: 7 } as const;
  return {
    noticeRow: { flexDirection: "row", gap: 8, paddingHorizontal: 18, paddingVertical: 5 },
    noticeDot: { ...noticeDot, backgroundColor: c.fgFaint },
    noticeDotWarn: { ...noticeDot, backgroundColor: c.warn },
    noticeDotError: { ...noticeDot, backgroundColor: c.err },
    notice: { ...notice, color: c.fgFaint },
    noticeWarn: { ...notice, color: c.warn },
    noticeError: { ...notice, color: c.err },
    caret: { color: c.accent },

    turn: { paddingHorizontal: 16, marginTop: 10, marginBottom: 4 },
    gutter,
    gutterUser: { ...gutter, color: c.fgMuted },
    userBlock: {
      alignSelf: "flex-start",
      maxWidth: "100%",
      borderRadius: radius.lg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
      borderTopColor: c.edgeTop,
      backgroundColor: c.raised,
      paddingHorizontal: 14,
      paddingVertical: 9,
    },
    userText: { fontSize: 15, lineHeight: 22, color: c.fg },
    assistant: { gap: 8 },

    thinking: { gap: 4 },
    thinkingHead: { flexDirection: "row", alignItems: "center", gap: 4, alignSelf: "flex-start" },
    thinkingLabel: { fontSize: 12.5, lineHeight: 18, color: c.fgFaint, fontStyle: "italic" },
    thinkingText: {
      fontSize: 12.5,
      lineHeight: 19,
      color: c.fgMuted,
      fontStyle: "italic",
      borderLeftWidth: 2,
      borderLeftColor: c.border,
      paddingLeft: 10,
      marginVertical: 2,
    },

    tool,
    toolFailed: { ...tool, borderColor: c.errBorder },
    toolHead: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      minHeight: 36,
      paddingHorizontal: 10,
      paddingVertical: 7,
    },
    pressed: { backgroundColor: c.hover },
    statusSlot: { width: 10, alignItems: "center", justifyContent: "center" },
    toolName: {
      fontFamily: MONO,
      fontSize: 11,
      lineHeight: 15,
      fontWeight: "600",
      letterSpacing: 0.2,
      color: c.fgMuted,
      flexShrink: 0,
      maxWidth: "45%",
    },
    toolSummary: { flex: 1, fontFamily: MONO, fontSize: 11.5, lineHeight: 16, color: c.fgFaint },
    dotDone: { ...dot, backgroundColor: c.ok },
    dotError: { ...dot, backgroundColor: c.err },
    toolBody: {
      gap: 8,
      paddingHorizontal: 10,
      paddingBottom: 10,
      paddingTop: 8,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: c.border,
    },
    outTitle,
    outTitleError: { ...outTitle, color: c.err },
    pre,
    preNext: { ...pre, marginTop: 4 },
    prompt: { color: c.accent },
    monoText: mono,
    monoError: { ...mono, color: c.err },
    images: { gap: 6, marginVertical: 4 },
    image: { width: "100%", height: 200, borderRadius: radius.sm, backgroundColor: c.inset },
    diffSame: { ...mono, color: c.fgMuted },
    diffAdd: { ...mono, color: c.ok },
    diffRemove: { ...mono, color: c.err },
  } as const;
}
