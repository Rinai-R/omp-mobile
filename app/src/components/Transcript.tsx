import * as Clipboard from "expo-clipboard";
import {
  createContext,
  memo,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Animated, Image, Modal, Pressable, ScrollView, StyleSheet, Text, View, type FontVariant } from "react-native";
import { editDiff } from "../diff";
import { imageUri } from "../media";
import { resultText } from "../messages";
import { t } from "../i18n/index.ts";
import {
  activityKinds,
  activityLabel,
  clockTime,
  liveLabel,
  stepStat,
  thoughtLabel,
  toolKind,
  toolSummaryLine,
  toolTitle,
  turnDuration,
  turnLabel,
  type Row,
  type Step,
  type ToolKind,
} from "../rows";
import { MONO, SANS, SCALE, radius, useColors, useStyles, type Palette } from "../theme";
import type { ImagePart, Machine, MessageItem, NoticeItem, ToolItem } from "../types";
import { BrandMark, ShimmerText, Spinner, useEnter, usePulse } from "./brand";
import {
  AgentsGlyph,
  CheckGlyph,
  ChevronDownGlyph,
  ChevronUpGlyph,
  CloseGlyph,
  CopyGlyph,
  FileGlyph,
  GlobeGlyph,
  ListGlyph,
  PencilGlyph,
  QuestionGlyph,
  SearchGlyph,
  TerminalGlyph,
  ThinkGlyph,
  ToolGlyph,
} from "./icons";
import { Markdown } from "./Markdown";

/**
 * The transcript as one conversation column (see `rows.ts`). The user's
 * message is the only surface: a tinted bubble on the right. OMP's turn has
 * no bubble, avatar or name; it opens with a one-line divider (how the turn
 * ended and how long it took, or what it is doing while it runs), then quiet
 * one-line work rows that open in place, then the reply as prose on the page.
 */

/** The column's side margin. */
const GUTTER = 16;
/** The visual line of a work row; the touch target reaches past it with hitSlop. */
const LINE = 24;
const SLOP = { top: 10, bottom: 10, left: 4, right: 4 } as const;

/** Steps an open activity lists at first; longer stretches show the newest ones until "Show all". */
const INLINE_STEPS = 8;
/** Lines a diff or a file shows in place; the step's sheet has the rest. */
const DIFF_LINES = 9;
const FILE_LINES = 8;
/** Characters of command output kept in place (the tail, where the result is). */
const TERMINAL_CHARS = 6_000;

/** Which turns are folded to their answer: the divider toggles its turn's work rows. */
interface Folds {
  folded: ReadonlySet<string>;
  toggle: (turn: string) => void;
}

const FoldContext = createContext<Folds>({ folded: new Set(), toggle: () => undefined });

/** Holds which turns are folded, for the rows under it. */
export function TranscriptFolds({ children }: { children: ReactNode }): ReactNode {
  const [folded, setFolded] = useState<ReadonlySet<string>>(() => new Set());
  const toggle = useCallback((turn: string) => {
    setFolded((current) => {
      const next = new Set(current);
      if (next.has(turn)) next.delete(turn);
      else next.add(turn);
      return next;
    });
  }, []);
  const value = useMemo(() => ({ folded, toggle }), [folded, toggle]);
  return <FoldContext.Provider value={value}>{children}</FoldContext.Provider>;
}

interface RowProps {
  row: Row;
  machine: Machine;
  cwd: string;
  /** Plays the entrance once: rows that arrived live, not rows loaded with the transcript. */
  animate: boolean;
  onOpenStep: (step: Step) => void;
}

function TranscriptRowImpl({ row, machine, cwd, animate, onOpenStep }: RowProps): ReactNode {
  const { folded } = useContext(FoldContext);
  const hidden = (row.kind === "thinking" || row.kind === "activity") && folded.has(row.turn);
  let body: ReactNode;
  switch (row.kind) {
    case "user":
      body = <UserMessage item={row.item} machine={machine} />;
      break;
    case "turn":
      body = <TurnDivider row={row} />;
      break;
    case "thinking":
      body = <ThinkingRow item={row.item} />;
      break;
    case "reply":
      body = <Reply item={row.item} machine={machine} />;
      break;
    case "activity":
      body = <ActivityRow row={row} machine={machine} cwd={cwd} onOpenStep={onOpenStep} />;
      break;
    case "error":
      body = <ErrorLine item={row.item} />;
      break;
    case "tail":
      body = <TurnTail text={row.text} at={row.at} />;
      break;
    case "notice":
      body = <NoticeLine item={row.item} />;
      break;
    default:
      body = null;
  }
  // Always the same wrapper: switching it off after the first frame would remount the row.
  return (
    <Enter animate={animate} gap={hidden ? 0 : row.gap}>
      {hidden ? null : body}
    </Enter>
  );
}

/** The object a step renders from: a changed step is a new object. */
function stepSource(step: Step): unknown {
  return step.kind === "tool" ? step.tool : step.item;
}

/** Rows are laid out afresh on every change; a row whose items are the same objects need not render again. */
function sameRow(a: Row, b: Row): boolean {
  if (a === b) return true;
  if (a.id !== b.id || a.kind !== b.kind || a.gap !== b.gap) return false;
  switch (a.kind) {
    case "turn": {
      const other = b as typeof a;
      return (
        a.running === other.running &&
        a.end === other.end &&
        a.startedAt === other.startedAt &&
        a.endedAt === other.endedAt &&
        a.members === other.members &&
        (a.live === undefined || other.live === undefined
          ? a.live === other.live
          : a.live.kind === other.live.kind && (a.live.kind !== "tool" || a.live.tool === (other.live as typeof a.live).tool))
      );
    }
    case "activity": {
      const other = b as typeof a;
      return (
        a.running === other.running &&
        a.failed === other.failed &&
        a.steps.length === other.steps.length &&
        a.steps.every((step, index) => stepSource(step) === stepSource(other.steps[index] as Step))
      );
    }
    case "tail": {
      const other = b as typeof a;
      return a.text === other.text && a.at === other.at;
    }
    default:
      return a.item === (b as typeof a).item;
  }
}

export const TranscriptRow = memo(
  TranscriptRowImpl,
  (prev, next) =>
    prev.machine === next.machine &&
    prev.cwd === next.cwd &&
    prev.animate === next.animate &&
    prev.onOpenStep === next.onOpenStep &&
    sameRow(prev.row, next.row),
);

function Enter({ animate, gap, children }: { animate: boolean; gap: number; children: ReactNode }): ReactNode {
  const value = useEnter(300, !animate);
  return (
    <Animated.View
      style={{
        marginTop: gap,
        paddingHorizontal: GUTTER,
        opacity: value,
        transform: [{ translateY: value.interpolate({ inputRange: [0, 1], outputRange: [6, 0] }) }],
      }}
    >
      {children}
    </Animated.View>
  );
}

/** Seconds since `from` that tick while `active`. */
function useNow(active: boolean): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return undefined;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

/**
 * The turn's divider: "Done in 3m 12s ⌃" over a hairline, or while the turn
 * runs, what OMP is doing in a gradient shimmer and how long it has run.
 * Tapping it folds the turn's work rows away, leaving the answer.
 */
function TurnDivider({ row }: { row: Extract<Row, { kind: "turn" }> }): ReactNode {
  const styles = useStyles(createStyles);
  const colors = useColors();
  const { folded, toggle } = useContext(FoldContext);
  const open = !folded.has(row.id);
  const now = useNow(row.running);
  const pulse = usePulse(row.running, 1400);
  const markOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 0.45] });
  const press = useCallback(() => toggle(row.id), [row.id, toggle]);
  const foldable = row.members > 0;
  const label = row.running ? liveLabel(row.live) : turnLabel(row);
  const elapsed = row.running && row.startedAt !== undefined ? turnDuration(Math.max(0, now - row.startedAt)) : undefined;
  return (
    <Pressable
      onPress={foldable ? press : undefined}
      disabled={!foldable}
      style={styles.divider}
      accessibilityRole="button"
      accessibilityState={{ expanded: open }}
      accessibilityLabel={`${label}${elapsed !== undefined ? `, ${elapsed}` : ""}`}
      accessibilityHint={foldable ? (open ? t("turn.foldA11y") : t("turn.unfoldA11y")) : undefined}
    >
      <Animated.View style={[styles.dividerMark, row.running ? { opacity: markOpacity } : null]}>
        <BrandMark size={13} color={row.running ? undefined : row.end === "failed" ? colors.err : colors.fgGhost} />
      </Animated.View>
      {row.running ? (
        <>
          <ShimmerText text={label} style={styles.dividerLive} maxFontSizeMultiplier={SCALE.meta} />
          {elapsed !== undefined ? (
            <Text style={styles.dividerElapsed} maxFontSizeMultiplier={SCALE.meta} numberOfLines={1}>
              {` · ${elapsed}`}
            </Text>
          ) : null}
        </>
      ) : (
        <Text style={row.end === "failed" ? styles.dividerFailed : styles.dividerText} numberOfLines={1} maxFontSizeMultiplier={SCALE.meta}>
          {label}
        </Text>
      )}
      {foldable ? (
        <View style={styles.dividerChevron}>
          {open ? <ChevronUpGlyph size={14} color={colors.fgFaint} /> : <ChevronDownGlyph size={14} color={colors.fgFaint} />}
        </View>
      ) : null}
    </Pressable>
  );
}

/** Images on a message or a step; tapping one opens it full screen. */
export function Thumbs({
  parts,
  machine,
  size = 112,
  max = 6,
  end = false,
}: {
  parts: ImagePart[] | undefined;
  machine: Machine;
  size?: number;
  max?: number;
  /** Line them up on the right, over the user's bubble. */
  end?: boolean;
}): ReactNode {
  const styles = useStyles(createStyles);
  const [open, setOpen] = useState<string | null>(null);
  const uris = useMemo(
    () =>
      (parts ?? [])
        .map((part) => imageUri(machine, part))
        .filter((uri): uri is string => uri !== undefined)
        .slice(0, max),
    [machine, max, parts],
  );
  if (uris.length === 0) return null;
  const headers = { authorization: `Bearer ${machine.token}` };
  return (
    <View style={end ? styles.thumbsEnd : styles.thumbs}>
      {uris.map((uri, index) => (
        <Pressable key={`${index}-${uri.slice(-24)}`} onPress={() => setOpen(uri)} accessibilityRole="imagebutton" accessibilityLabel={t("transcript.openImage")}>
          <Image source={{ uri, headers }} style={[styles.thumb, { width: size, height: size }]} resizeMode="cover" />
        </Pressable>
      ))}
      <Modal visible={open !== null} transparent animationType="fade" statusBarTranslucent onRequestClose={() => setOpen(null)}>
        <Pressable style={styles.viewer} onPress={() => setOpen(null)} accessibilityLabel={t("transcript.closeImage")}>
          {open !== null ? <Image source={{ uri: open, headers }} style={styles.viewerImage} resizeMode="contain" /> : null}
          <View style={styles.viewerClose}>
            <CloseGlyph size={18} color="#ffffff" />
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

/** The user's message: images above, then a tinted bubble, both on the right. */
function UserMessage({ item, machine }: { item: MessageItem; machine: Machine }): ReactNode {
  const styles = useStyles(createStyles);
  const hasText = item.text.trim() !== "";
  return (
    <View style={styles.userRow}>
      <Thumbs parts={item.images} machine={machine} size={hasText ? 96 : 140} end />
      {hasText ? (
        <View style={styles.bubble}>
          <Text style={styles.bubbleText} selectable maxFontSizeMultiplier={SCALE.body}>
            {item.text.trim()}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

function Caret(): ReactNode {
  const styles = useStyles(createStyles);
  const pulse = usePulse(true, 1000);
  const opacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 0.25] });
  return <Animated.Text style={[styles.caret, { opacity }]}>▍</Animated.Text>;
}

/** The reply: prose straight on the page, with no bubble. */
function Reply({ item, machine }: { item: MessageItem; machine: Machine }): ReactNode {
  const styles = useStyles(createStyles);
  const streaming = item.streaming === true;
  const hasText = item.text.trim() !== "";
  return (
    <View style={styles.reply}>
      <Thumbs parts={item.images} machine={machine} />
      {hasText ? <Markdown text={item.text} caret={streaming ? <Caret /> : undefined} /> : null}
    </View>
  );
}

/** A work row's leading slot: a 16 dp box holding the row's glyph, or a chevron once it is open. */
function Lead({ open, children }: { open: boolean; children: ReactNode }): ReactNode {
  const styles = useStyles(createStyles);
  const colors = useColors();
  return <View style={styles.lead}>{open ? <ChevronUpGlyph size={14} color={colors.fgFaint} /> : children}</View>;
}

/** "Thinking" while it streams, "Thought" after; opens in place onto the thinking, quiet and indented. */
function ThinkingRow({ item }: { item: MessageItem }): ReactNode {
  const styles = useStyles(createStyles);
  const colors = useColors();
  const [open, setOpen] = useState(false);
  const toggle = useCallback(() => setOpen((value) => !value), []);
  const active = item.streaming === true && item.text.trim() === "";
  const label = active ? t("transcript.thinking") : thoughtLabel(item.thinkingMs);
  return (
    <View>
      <Pressable onPress={toggle} hitSlop={SLOP} style={styles.line} accessibilityRole="button" accessibilityState={{ expanded: open }} accessibilityLabel={label}>
        <Lead open={open}>
          <ThinkGlyph size={14} color={active ? colors.accentV : colors.fgFaint} />
        </Lead>
        {active ? (
          <ShimmerText text={label} style={styles.lineTitle} maxFontSizeMultiplier={SCALE.meta} />
        ) : (
          <Text style={styles.lineTitle} numberOfLines={1} maxFontSizeMultiplier={SCALE.meta}>
            {label}
          </Text>
        )}
      </Pressable>
      {open ? (
        <View style={styles.thinkingBody}>
          <Markdown text={(item.thinking ?? "").trim()} variant="thought" />
        </View>
      ) : null}
    </View>
  );
}

export function KindGlyph({ kind, size = 13, color }: { kind: ToolKind; size?: number; color: string }): ReactNode {
  switch (kind) {
    case "read":
      return <FileGlyph size={size} color={color} />;
    case "edit":
    case "write":
      return <PencilGlyph size={size} color={color} />;
    case "run":
      return <TerminalGlyph size={size} color={color} />;
    case "search":
      return <SearchGlyph size={size} color={color} />;
    case "web":
      return <GlobeGlyph size={size} color={color} />;
    case "plan":
      return <ListGlyph size={size} color={color} />;
    case "agent":
      return <AgentsGlyph size={size} color={color} />;
    case "ask":
      return <QuestionGlyph size={size} color={color} />;
    default:
      return <ToolGlyph size={size} color={color} />;
  }
}

/**
 * A stretch of tool calls as one quiet line naming the kinds of work ("Ran
 * commands"). It opens in place onto one line per call. It is open while it
 * runs, and stays open after a run watched here; one loaded with the
 * transcript starts closed.
 */
function ActivityRow({
  row,
  machine,
  cwd,
  onOpenStep,
}: {
  row: Extract<Row, { kind: "activity" }>;
  machine: Machine;
  cwd: string;
  onOpenStep: (step: Step) => void;
}): ReactNode {
  const styles = useStyles(createStyles);
  const colors = useColors();
  const [chosen, setChosen] = useState<boolean | null>(null);
  const [watched, setWatched] = useState(row.running);
  if (row.running && !watched) setWatched(true);
  const open = chosen ?? (row.running || watched);
  const [all, setAll] = useState(false);
  const toggle = useCallback(() => setChosen((value) => !(value ?? (row.running || watched))), [row.running, watched]);
  const title = activityLabel(row.steps);
  const lead = activityKinds(row.steps)[0] ?? "other";
  const images = row.steps.flatMap((value) => (value.kind === "tool" ? (value.tool.images ?? []) : []));
  return (
    <View>
      <Pressable
        onPress={toggle}
        hitSlop={SLOP}
        style={styles.groupHead}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={row.failed > 0 ? `${title}, ${t("step.failed")}` : title}
      >
        <Lead open={open}>
          <KindGlyph kind={lead} size={14} color={colors.fgFaint} />
        </Lead>
        {row.running ? (
          <ShimmerText text={title} style={styles.groupTitle} maxFontSizeMultiplier={SCALE.meta} />
        ) : (
          <Text style={styles.groupTitle} numberOfLines={1} maxFontSizeMultiplier={SCALE.meta}>
            {title}
          </Text>
        )}
        {row.failed > 0 && !row.running ? <View style={styles.failDot} /> : null}
      </Pressable>
      {open ? (
        <View style={styles.steps}>
          {row.steps.length > INLINE_STEPS ? (
            <Pressable
              onPress={() => setAll((value) => !value)}
              hitSlop={SLOP}
              style={styles.more}
              accessibilityRole="button"
              accessibilityState={{ expanded: all }}
            >
              <Text style={styles.moreText} maxFontSizeMultiplier={SCALE.meta}>
                {all ? t("transcript.showFewer") : t("transcript.showAll", { count: row.steps.length })}
              </Text>
            </Pressable>
          ) : null}
          {(all ? row.steps : row.steps.slice(-INLINE_STEPS)).map((value) =>
            value.kind === "thought" ? (
              <ThinkingRow key={value.item.id} item={value.item} />
            ) : (
              <ToolRow key={value.tool.id} tool={value.tool} cwd={cwd} onOpen={onOpenStep} />
            ),
          )}
        </View>
      ) : null}
      {images.length > 0 ? (
        <View style={styles.groupImages}>
          <Thumbs parts={images} machine={machine} size={88} max={4} />
        </View>
      ) : null}
    </View>
  );
}

/**
 * One call: `[glyph] Title · summary   +3 −1`, grey and one line. Tapping it
 * opens the call in place (command output, a diff, the file it read); a long
 * press, or "Details" under it, opens the whole call in the step sheet.
 */
function ToolRow({ tool, cwd, onOpen }: { tool: ToolItem; cwd: string; onOpen: (step: Step) => void }): ReactNode {
  const styles = useStyles(createStyles);
  const colors = useColors();
  const [open, setOpen] = useState(false);
  const toggle = useCallback(() => setOpen((value) => !value), []);
  const details = useCallback(() => onOpen({ kind: "tool", tool }), [onOpen, tool]);
  const running = tool.status === "running";
  const failed = tool.status === "error";
  const kind = toolKind(tool.name);
  const summary = toolSummaryLine(tool, cwd);
  const stat = stepStat(tool);
  const edit = stat !== undefined && /^\+\d+ −\d+$/.test(stat) ? stat.split(" ") : undefined;
  const title = toolTitle(tool);
  return (
    <View>
      <Pressable
        onPress={toggle}
        onLongPress={details}
        hitSlop={SLOP}
        style={styles.line}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={t("common.pair", { label: `${title} ${summary ?? ""}`.trim(), value: t(`step.status.${tool.status}`) })}
      >
        <Lead open={open}>
          <KindGlyph kind={kind} size={14} color={failed ? colors.err : colors.fgFaint} />
        </Lead>
        <Text style={styles.lineTitle} numberOfLines={1} maxFontSizeMultiplier={SCALE.meta}>
          {title}
        </Text>
        {summary !== undefined ? (
          <>
            <View style={styles.sep} />
            <Text style={failed ? styles.lineSummaryErr : styles.lineSummary} numberOfLines={1} maxFontSizeMultiplier={SCALE.meta}>
              {summary}
            </Text>
          </>
        ) : (
          <View style={styles.fill} />
        )}
        {running ? (
          <View style={styles.statSlot}>
            <Spinner size={10} color={colors.accentV} />
          </View>
        ) : failed ? (
          <View style={styles.badge}>
            <View style={styles.badgeDot} />
            <Text style={styles.badgeText} maxFontSizeMultiplier={SCALE.ui}>
              {t("step.failed")}
            </Text>
          </View>
        ) : edit !== undefined ? (
          <Text style={styles.stat} maxFontSizeMultiplier={SCALE.ui}>
            <Text style={open ? styles.statAdd : undefined}>{edit[0]}</Text>
            <Text style={open ? styles.statRemove : undefined}>{edit[1]?.replace("−", " −")}</Text>
          </Text>
        ) : null}
      </Pressable>
      {open ? <ToolBody tool={tool} cwd={cwd} onDetails={details} /> : null}
    </View>
  );
}

function outputOf(tool: ToolItem): string | undefined {
  const value = tool.result ?? tool.partial;
  if (value === undefined || value === null) return undefined;
  const text = resultText(value);
  if (text !== undefined) return text;
  if (typeof value === "object" && "content" in value) return undefined;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

/** A call opened in place: a terminal for commands, a diff for edits, the first lines of anything else. */
function ToolBody({ tool, cwd, onDetails }: { tool: ToolItem; cwd: string; onDetails: () => void }): ReactNode {
  const kind = toolKind(tool.name);
  const args = tool.args !== null && typeof tool.args === "object" ? (tool.args as Record<string, unknown>) : {};
  const command = str(args.command);
  if (command !== undefined) return <Terminal tool={tool} command={command} onDetails={onDetails} />;
  if (kind === "edit") {
    const lines = editDiff(tool.args, tool.result);
    if (lines !== undefined) return <DiffCard lines={lines} label={toolSummaryLine(tool, cwd)} onDetails={onDetails} />;
  }
  const text = kind === "write" ? (str(args.content) ?? outputOf(tool)) : outputOf(tool);
  return <FileCard text={text} label={toolSummaryLine(tool, cwd)} running={tool.status === "running"} error={tool.isError === true} onDetails={onDetails} />;
}

/** A small text button under a card: the whole call, in its sheet. */
function DetailsLink({ label, onPress }: { label: string; onPress: () => void }): ReactNode {
  const styles = useStyles(createStyles);
  return (
    <Pressable onPress={onPress} hitSlop={SLOP} style={styles.detailsLink} accessibilityRole="button">
      <Text style={styles.detailsText} maxFontSizeMultiplier={SCALE.ui}>
        {label}
      </Text>
    </Pressable>
  );
}

function useCopy(text: string): [boolean, () => void] {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = useCallback(() => {
    void Clipboard.setStringAsync(text)
      .then(() => {
        setCopied(true);
        clearTimeout(timer.current);
        timer.current = setTimeout(() => setCopied(false), 1_200);
      })
      .catch(() => undefined);
  }, [text]);
  return [copied, copy];
}

/**
 * Command output: a soft panel with a status dot in its gutter, the command
 * as its header, then the output's tail in a capped box that scrolls.
 */
function Terminal({ tool, command, onDetails }: { tool: ToolItem; command: string; onDetails: () => void }): ReactNode {
  const styles = useStyles(createStyles);
  const colors = useColors();
  const output = (outputOf(tool) ?? "").replace(/\s+$/, "");
  const [copied, copy] = useCopy(command);
  const shown = output.length > TERMINAL_CHARS ? `…${output.slice(-TERMINAL_CHARS)}` : output;
  const lines = output === "" ? 0 : output.split("\n").length;
  const scroll = useRef<ScrollView>(null);
  const dot = tool.status === "running" ? null : tool.status === "error" ? colors.err : colors.ok;
  return (
    <View style={styles.cardWrap}>
      <View style={styles.terminal}>
        <View style={styles.termHead}>
          <View style={styles.termGutter}>
            {dot === null ? <Spinner size={9} color={colors.accentV} /> : <View style={[styles.termDot, { backgroundColor: dot }]} />}
          </View>
          <Text style={styles.termCommand} selectable maxFontSizeMultiplier={SCALE.code}>
            <Text style={styles.termPrompt}>$ </Text>
            {command}
          </Text>
          <Pressable onPress={copy} hitSlop={8} style={styles.termCopy} accessibilityRole="button" accessibilityLabel={t("tool.copy")}>
            <Text style={copied ? styles.termCopied : styles.termCopyText} maxFontSizeMultiplier={SCALE.ui}>
              {copied ? t("markdown.copied") : t("tool.copy")}
            </Text>
          </Pressable>
        </View>
        <View style={styles.termRule} />
        {shown === "" ? (
          <Text style={styles.termEmpty} maxFontSizeMultiplier={SCALE.code}>
            {tool.status === "running" ? t("tool.running") : t("tool.noOutput")}
          </Text>
        ) : (
          <ScrollView
            ref={scroll}
            style={styles.termScroll}
            nestedScrollEnabled
            onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: false })}
          >
            <Text style={tool.isError === true ? styles.termOutErr : styles.termOut} selectable maxFontSizeMultiplier={SCALE.code}>
              {shown}
            </Text>
          </ScrollView>
        )}
      </View>
      {lines > 12 || output.length > TERMINAL_CHARS ? <DetailsLink label={t("tool.full")} onPress={onDetails} /> : null}
    </View>
  );
}

/** An edit as a diff: added and removed lines tinted, each with a coloured bar at its left edge. */
function DiffCard({
  lines,
  label,
  onDetails,
}: {
  lines: { kind: "same" | "add" | "remove"; text: string }[];
  label: string | undefined;
  onDetails: () => void;
}): ReactNode {
  const styles = useStyles(createStyles);
  // Start at the first change: unchanged lines before it are context the sheet still has.
  const first = Math.max(0, lines.findIndex((line) => line.kind !== "same") - 2);
  const shown = lines.slice(first, first + DIFF_LINES);
  return (
    <View style={styles.cardWrap}>
      <View style={styles.card}>
        {label !== undefined ? (
          <Text style={styles.cardLabel} numberOfLines={1} maxFontSizeMultiplier={SCALE.ui}>
            {label}
          </Text>
        ) : null}
        <View style={styles.diffLines}>
          {shown.map((line, index) => (
            <Text
              key={index}
              style={line.kind === "add" ? styles.diffAdd : line.kind === "remove" ? styles.diffRemove : styles.diffSame}
              selectable
              maxFontSizeMultiplier={SCALE.code}
            >
              {line.kind === "add" ? "+ " : line.kind === "remove" ? "- " : "  "}
              {line.text}
            </Text>
          ))}
        </View>
      </View>
      {lines.length > shown.length ? <DetailsLink label={t("tool.moreLines", { count: lines.length - shown.length })} onPress={onDetails} /> : <DetailsLink label={t("tool.details")} onPress={onDetails} />}
    </View>
  );
}

/** The first lines of what a call read, wrote or returned. */
function FileCard({
  text,
  label,
  running,
  error,
  onDetails,
}: {
  text: string | undefined;
  label: string | undefined;
  running: boolean;
  error: boolean;
  onDetails: () => void;
}): ReactNode {
  const styles = useStyles(createStyles);
  const all = (text ?? "").replace(/\s+$/, "").split("\n");
  const shown = all.slice(0, FILE_LINES).join("\n");
  return (
    <View style={styles.cardWrap}>
      <View style={styles.card}>
        {label !== undefined ? (
          <Text style={styles.cardLabel} numberOfLines={1} maxFontSizeMultiplier={SCALE.ui}>
            {label}
          </Text>
        ) : null}
        <Text style={error ? styles.cardTextErr : styles.cardText} selectable maxFontSizeMultiplier={SCALE.code}>
          {shown !== "" ? shown : running ? t("tool.running") : t("tool.noOutput")}
        </Text>
      </View>
      <DetailsLink label={all.length > FILE_LINES ? t("tool.moreLines", { count: all.length - FILE_LINES }) : t("tool.details")} onPress={onDetails} />
    </View>
  );
}

/** A turn that ended on an error: a red dot, "Failed", and what went wrong. */
function ErrorLine({ item }: { item: MessageItem }): ReactNode {
  const styles = useStyles(createStyles);
  return (
    <View style={styles.errorRow}>
      <View style={styles.errorDot} />
      <Text style={styles.errorText} selectable maxFontSizeMultiplier={SCALE.meta}>
        <Text style={styles.errorTitle}>{t("turn.failed")}</Text>
        {"  "}
        {item.error}
      </Text>
    </View>
  );
}

/** Under a finished turn: copy the reply, and the time it ended. */
function TurnTail({ text, at }: { text: string; at: number | undefined }): ReactNode {
  const styles = useStyles(createStyles);
  const colors = useColors();
  const [copied, copy] = useCopy(text);
  return (
    <View style={styles.tail}>
      <Pressable
        onPress={copy}
        hitSlop={8}
        style={({ pressed }) => [styles.tailButton, pressed && styles.pressed]}
        accessibilityRole="button"
        accessibilityLabel={copied ? t("turn.copied") : t("turn.copy")}
      >
        {copied ? <CheckGlyph size={15} color={colors.ok} /> : <CopyGlyph size={15} color={colors.fgFaint} />}
      </Pressable>
      {at !== undefined ? (
        <Text style={styles.tailTime} maxFontSizeMultiplier={SCALE.ui}>
          {clockTime(at)}
        </Text>
      ) : null}
    </View>
  );
}

function NoticeLine({ item }: { item: NoticeItem }): ReactNode {
  const styles = useStyles(createStyles);
  return (
    <View style={styles.notice}>
      <View style={item.level === "error" ? styles.noticeDotErr : item.level === "warning" ? styles.noticeDotWarn : styles.noticeDot} />
      <Text
        style={item.level === "error" ? styles.noticeTextErr : item.level === "warning" ? styles.noticeTextWarn : styles.noticeText}
        selectable
        maxFontSizeMultiplier={SCALE.meta}
      >
        {item.text}
      </Text>
    </View>
  );
}

function createStyles(c: Palette) {
  const meta = { fontFamily: SANS, fontSize: 13, lineHeight: 20, fontWeight: "400", color: c.fgFaint } as const;
  const mono = { fontFamily: MONO, fontSize: 12, lineHeight: 19, fontWeight: "400", color: c.fgMuted } as const;
  const card = {
    borderRadius: radius.lg,
    backgroundColor: c.codeBg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: c.border,
    overflow: "hidden",
  } as const;
  const diffLine = { ...mono, paddingHorizontal: 14 } as const;
  const dot = { width: 6, height: 6, borderRadius: 3, marginTop: 7, backgroundColor: c.fgGhost } as const;
  const line = { flexDirection: "row", alignItems: "center", minHeight: LINE, alignSelf: "stretch" } as const;
  return {
    pressed: { backgroundColor: c.hover },
    fill: { flex: 1 },

    divider: {
      flexDirection: "row",
      alignItems: "center",
      minHeight: 33,
      paddingBottom: 8,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: c.borderStrong,
    },
    dividerMark: { width: 16, height: 16, marginRight: 7, alignItems: "center", justifyContent: "center" },
    dividerText: { ...meta, fontSize: 14, lineHeight: 24, flexShrink: 1, fontVariant: ["tabular-nums"] as FontVariant[] },
    dividerFailed: { ...meta, fontSize: 14, lineHeight: 24, flexShrink: 1, color: c.err },
    dividerLive: { ...meta, fontSize: 13.5, lineHeight: 24, color: c.fgFaint },
    dividerElapsed: { ...meta, fontSize: 13.5, lineHeight: 24, color: c.fgGhost, fontVariant: ["tabular-nums"] as FontVariant[] },
    dividerChevron: { marginLeft: 4 },

    userRow: { alignItems: "flex-end", gap: 8 },
    bubble: {
      maxWidth: "82%",
      paddingHorizontal: 16,
      paddingVertical: 10,
      borderRadius: radius.xl,
      backgroundColor: c.userBubble,
    },
    bubbleText: { fontFamily: SANS, fontSize: 15, lineHeight: 22, fontWeight: "400", color: c.fg },

    reply: { gap: 10 },
    caret: { fontFamily: SANS, color: c.accentV },

    line,
    lead: { width: 16, height: 16, marginRight: 6, alignItems: "center", justifyContent: "center" },
    lineTitle: { ...meta, lineHeight: LINE, flexShrink: 0, maxWidth: "60%" },
    sep: { width: 2.5, height: 2.5, borderRadius: 1.25, marginHorizontal: 7, backgroundColor: c.fgGhost },
    lineSummary: { ...meta, lineHeight: LINE, flex: 1, minWidth: 0 },
    lineSummaryErr: { ...meta, lineHeight: LINE, flex: 1, minWidth: 0, color: c.err },
    thinkingBody: { paddingLeft: 22, paddingTop: 4, paddingBottom: 4 },

    groupHead: { ...line },
    groupTitle: { ...meta, fontSize: 14, lineHeight: LINE, flexShrink: 1 },
    failDot: { width: 5, height: 5, borderRadius: 2.5, marginLeft: 8, backgroundColor: c.err },
    groupImages: { paddingTop: 8, paddingLeft: 22 },
    steps: { gap: 6, paddingTop: 6 },
    more: { minHeight: LINE, justifyContent: "center", paddingLeft: 22, alignSelf: "flex-start" },
    moreText: { ...meta, color: c.fgMuted },

    statSlot: { marginLeft: 10, width: 16, alignItems: "center" },
    stat: { marginLeft: 10, fontFamily: MONO, fontSize: 11, lineHeight: LINE, color: c.fgFaint },
    statAdd: { color: c.ok },
    statRemove: { color: c.err },
    badge: { flexDirection: "row", alignItems: "center", gap: 5, marginLeft: 8 },
    badgeDot: { width: 4, height: 4, borderRadius: 2, backgroundColor: c.err },
    badgeText: { ...meta, fontSize: 12, color: c.err },

    cardWrap: { marginTop: 4, marginBottom: 4, marginLeft: 4, gap: 2 },
    card: { ...card, paddingTop: 10, paddingBottom: 12 },
    cardLabel: { fontFamily: MONO, fontSize: 11, lineHeight: 18, color: c.fgFaint, paddingHorizontal: 14, marginBottom: 4 },
    cardText: { ...mono, paddingHorizontal: 14 },
    cardTextErr: { ...mono, paddingHorizontal: 14, color: c.err },
    diffLines: {},
    diffSame: diffLine,
    diffAdd: { ...diffLine, color: c.ok, backgroundColor: c.okSoft, borderLeftWidth: 3, borderLeftColor: c.ok, paddingLeft: 11 },
    diffRemove: { ...diffLine, color: c.err, backgroundColor: c.errSoft, borderLeftWidth: 3, borderLeftColor: c.err, paddingLeft: 11 },
    detailsLink: { alignSelf: "flex-start", paddingLeft: 14, minHeight: 26, justifyContent: "center" },
    detailsText: { ...meta, fontSize: 12, lineHeight: 18 },

    terminal: card,
    termHead: { flexDirection: "row", alignItems: "flex-start", paddingTop: 9, paddingBottom: 9, paddingRight: 12 },
    termGutter: { width: 28, height: 18, alignItems: "center", justifyContent: "center" },
    termDot: { width: 6, height: 6, borderRadius: 3 },
    termPrompt: { color: c.fgFaint },
    termCommand: { flex: 1, minWidth: 0, fontFamily: MONO, fontSize: 12, lineHeight: 18, color: c.fg },
    termCopy: { marginLeft: 10, minHeight: 18, justifyContent: "center" },
    termCopyText: { ...meta, lineHeight: 18, color: c.fgMuted },
    termCopied: { ...meta, lineHeight: 18, color: c.ok },
    termRule: { height: StyleSheet.hairlineWidth, backgroundColor: c.border },
    termScroll: { maxHeight: 224 },
    termOut: { fontFamily: MONO, fontSize: 12, lineHeight: 18, color: c.fgMuted, paddingTop: 10, paddingBottom: 12, paddingLeft: 28, paddingRight: 14 },
    termOutErr: { fontFamily: MONO, fontSize: 12, lineHeight: 18, color: c.err, paddingTop: 10, paddingBottom: 12, paddingLeft: 28, paddingRight: 14 },
    termEmpty: { fontFamily: MONO, fontSize: 12, lineHeight: 18, color: c.fgFaint, paddingTop: 10, paddingBottom: 12, paddingLeft: 28 },

    thumbs: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
    thumbsEnd: { flexDirection: "row", flexWrap: "wrap", justifyContent: "flex-end", gap: 8, maxWidth: "82%" },
    thumb: { borderRadius: radius.md, backgroundColor: c.inset },
    viewer: { flex: 1, backgroundColor: "#000000f2", alignItems: "center", justifyContent: "center" },
    viewerImage: { width: "100%", height: "86%" },
    viewerClose: {
      position: "absolute",
      top: 48,
      right: 20,
      width: 36,
      height: 36,
      borderRadius: 18,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: "#ffffff22",
    },

    errorRow: { flexDirection: "row", gap: 8 },
    errorDot: { ...dot, backgroundColor: c.err },
    errorText: { ...meta, flex: 1, color: c.fgMuted },
    errorTitle: { fontWeight: "600", color: c.err },

    tail: { flexDirection: "row", alignItems: "center", gap: 6, marginLeft: -6 },
    tailButton: { width: 30, height: 30, borderRadius: radius.sm, alignItems: "center", justifyContent: "center" },
    tailTime: { ...meta, color: c.fgGhost, fontVariant: ["tabular-nums"] as FontVariant[] },

    notice: { flexDirection: "row", gap: 8 },
    noticeDot: dot,
    noticeDotWarn: { ...dot, backgroundColor: c.warn },
    noticeDotErr: { ...dot, backgroundColor: c.err },
    noticeText: { ...meta, flex: 1 },
    noticeTextWarn: { ...meta, flex: 1, color: c.warn },
    noticeTextErr: { ...meta, flex: 1, color: c.err },
  } as const;
}
