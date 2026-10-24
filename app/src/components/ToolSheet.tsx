import { useMemo, type ReactNode } from "react";
import { ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { diffLines, editInput, editSides, type DiffLine } from "../diff";
import { resultText } from "../messages";
import { stepStat, stepTarget, stepTitle, toolKind, type Step } from "../rows";
import { MONO, SANS, radius, useColors, useStyles, type Palette } from "../theme";
import type { Machine } from "../types";
import { t } from "../i18n/index.ts";
import { KindGlyph, Thumbs } from "./Transcript";
import { Sheet } from "./ui";

/** One step of an activity card in full: what was asked, what came back, the images. */

function pretty(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value ?? null, null, 2);
  } catch {
    return String(value);
  }
}

/** Arguments without what the sheet already shows: OMP's `i` intent line and a shell command. */
function restArgs(args: unknown): unknown {
  if (args === null || typeof args !== "object" || Array.isArray(args)) return args;
  const rest: Record<string, unknown> = { ...(args as Record<string, unknown>) };
  delete rest.i;
  delete rest.command;
  return Object.keys(rest).length === 0 ? undefined : rest;
}

/** An edit's lines: OMP's own result diff, the call's two sides diffed, or its preformatted input. */
function editDiff(args: unknown, result: unknown): DiffLine[] | undefined {
  const details = result !== null && typeof result === "object" ? (result as { details?: { diff?: unknown } }).details : undefined;
  if (typeof details?.diff === "string" && details.diff.trim() !== "") {
    return details.diff.split("\n").map((line): DiffLine => {
      if (/^\+\s*\d+\|/.test(line)) return { kind: "add", text: line.slice(1) };
      if (/^-\s*\d+\|/.test(line)) return { kind: "remove", text: line.slice(1) };
      return { kind: "same", text: line.replace(/^ /, "") };
    });
  }
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

/** Long outputs are cut so the sheet stays responsive; the computer keeps the whole result. */
const OUTPUT_LIMIT = 40_000;
/** Diff lines shown; each is its own Text, and thousands of them freeze the sheet. */
const DIFF_LIMIT = 1_500;

export function ToolSheet({
  step,
  machine,
  cwd,
  onClose,
}: {
  step: Step | null;
  machine: Machine;
  cwd: string;
  onClose: () => void;
}): ReactNode {
  const styles = useStyles(createStyles);
  const colors = useColors();
  const { height } = useWindowDimensions();
  const content = useMemo(() => {
    if (step === null) return null;
    if (step.kind === "thought") {
      return { title: t("transcript.thought"), body: <Text style={styles.prose} selectable>{(step.item.thinking ?? "").trim()}</Text> };
    }
    const tool = step.tool;
    const target = stepTarget(tool, cwd);
    const stat = stepStat(tool);
    const kind = toolKind(tool.name);
    const diff = kind === "edit" ? editDiff(tool.args, tool.result) : undefined;
    const rest = restArgs(tool.args);
    const output = tool.result ?? tool.partial;
    const text = output === undefined ? undefined : (resultText(output) ?? pretty(output));
    const cut = text !== undefined && text.length > OUTPUT_LIMIT;
    const command =
      tool.args !== null && typeof tool.args === "object" && typeof (tool.args as { command?: unknown }).command === "string"
        ? (tool.args as { command: string }).command
        : undefined;
    return {
      title: stepTitle(tool),
      body: (
        <>
          <View style={styles.meta}>
            <View style={styles.metaIcon}>
              <KindGlyph kind={kind} size={13} color={tool.status === "error" ? colors.err : colors.fgFaint} />
            </View>
            <Text style={styles.metaText} numberOfLines={1}>
              {tool.name}
              {stat !== undefined ? ` · ${stat}` : tool.status === "running" ? ` · ${t("step.status.running")}` : ""}
            </Text>
          </View>
          {command !== undefined ? (
            <Block label={t("tool.command")} wrap>
              <Text style={styles.code} selectable>
                <Text style={styles.prompt}>$ </Text>
                {command}
              </Text>
            </Block>
          ) : target !== undefined && diff === undefined ? (
            <Block label={t("tool.target")}>
              <Text style={styles.code} selectable>
                {target}
              </Text>
            </Block>
          ) : null}
          {diff !== undefined ? (
            <Block label={target ?? t("tool.changes")}>
              {diff.slice(0, DIFF_LIMIT).map((line, index) => (
                <Text
                  key={index}
                  style={line.kind === "add" ? styles.add : line.kind === "remove" ? styles.remove : styles.same}
                  selectable
                >
                  {line.kind === "add" ? "+ " : line.kind === "remove" ? "- " : "  "}
                  {line.text}
                </Text>
              ))}
              {diff.length > DIFF_LIMIT ? (
                <Text style={styles.same}>{t("tool.moreLines", { count: diff.length - DIFF_LIMIT })}</Text>
              ) : null}
            </Block>
          ) : rest !== undefined && kind !== "write" ? (
            <Block label={t("tool.input")}>
              <Text style={styles.code} selectable>
                {clip(pretty(rest))}
              </Text>
            </Block>
          ) : null}
          {kind === "write" && typeof (tool.args as { content?: unknown } | null)?.content === "string" ? (
            <Block label={t("tool.content")}>
              <Text style={styles.code} selectable>
                {(tool.args as { content: string }).content.slice(0, OUTPUT_LIMIT)}
              </Text>
            </Block>
          ) : null}
          {tool.images !== undefined && tool.images.length > 0 ? (
            <View style={styles.images}>
              <Thumbs parts={tool.images} machine={machine} size={150} max={8} />
            </View>
          ) : null}
          {text !== undefined && text.trim() !== "" ? (
            <Block label={tool.isError === true ? t("tool.error") : t("tool.output")} error={tool.isError === true} wrap={tool.isError === true}>
              <Text style={tool.isError === true ? styles.codeErr : styles.code} selectable>
                {cut ? `${text.slice(0, OUTPUT_LIMIT)}\n…` : text}
              </Text>
            </Block>
          ) : null}
        </>
      ),
    };
  }, [colors, cwd, machine, step, styles]);

  return (
    <Sheet visible={step !== null} title={content?.title ?? ""} onClose={onClose} scroll={false}>
      <ScrollView style={{ maxHeight: height * 0.72 }} contentContainerStyle={styles.scroll}>
        {content?.body}
      </ScrollView>
    </Sheet>
  );
}

function clip(text: string): string {
  return text.length > OUTPUT_LIMIT ? `${text.slice(0, OUTPUT_LIMIT)}\n…` : text;
}

/** A labelled mono block; `wrap` breaks long lines (commands, errors), else it scrolls sideways (code, diffs). */
function Block({
  label,
  error = false,
  wrap = false,
  children,
}: {
  label: string;
  error?: boolean;
  wrap?: boolean;
  children: ReactNode;
}): ReactNode {
  const styles = useStyles(createStyles);
  return (
    <View style={styles.block}>
      <Text style={error ? styles.labelErr : styles.label} numberOfLines={1}>
        {label}
      </Text>
      {wrap ? (
        <View style={[styles.pre, styles.preInner]}>{children}</View>
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.pre} contentContainerStyle={styles.preInner}>
          <View>{children}</View>
        </ScrollView>
      )}
    </View>
  );
}

function createStyles(c: Palette) {
  const code = { fontFamily: MONO, fontSize: 12, lineHeight: 18, color: c.fg } as const;
  const label = {
    fontFamily: MONO,
    fontSize: 10.5,
    lineHeight: 14,
    letterSpacing: 1.2,
    textTransform: "uppercase",
    color: c.fgGhost,
    paddingHorizontal: 2,
  } as const;
  return {
    scroll: { gap: 14, paddingBottom: 8 },
    meta: { flexDirection: "row", alignItems: "center", gap: 8 },
    metaIcon: { width: 24, height: 24, borderRadius: 8, alignItems: "center", justifyContent: "center", backgroundColor: c.well },
    metaText: { flex: 1, fontFamily: MONO, fontSize: 11.5, lineHeight: 16, color: c.fgFaint },
    block: { gap: 6 },
    label,
    labelErr: { ...label, color: c.err },
    pre: {
      borderRadius: radius.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
      backgroundColor: c.inset,
    },
    preInner: { paddingHorizontal: 12, paddingVertical: 10 },
    code,
    codeErr: { ...code, color: c.err },
    prompt: { color: c.accent },
    add: { ...code, color: c.ok },
    remove: { ...code, color: c.err },
    same: { ...code, color: c.fgFaint },
    images: { marginTop: 2 },
    prose: { fontFamily: SANS, fontSize: 14, lineHeight: 22, color: c.fgMuted },
  } as const;
}
