import { memo, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Animated,
  FlatList,
  Image,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type PressableStateCallbackType,
} from "react-native";
import { imageUri } from "../media";
import {
  activitySummary,
  duration,
  liveStep,
  stepStat,
  stepTarget,
  stepTitle,
  toolCount,
  toolKind,
  type Row,
  type Step,
  type ToolKind,
} from "../rows";
import { MONO, SANS, radius, useColors, useStyles, type Palette } from "../theme";
import type { ImagePart, Machine, MessageItem, NoticeItem } from "../types";
import { BrandMark, Spinner, useEnter, usePulse } from "./brand";
import {
  AgentsGlyph,
  CheckGlyph,
  CloseGlyph,
  FileGlyph,
  GlobeGlyph,
  ListGlyph,
  PencilGlyph,
  QuestionGlyph,
  SearchGlyph,
  SparkGlyph,
  TerminalGlyph,
  ToolGlyph,
} from "./icons";
import { Markdown } from "./Markdown";
import { Disclosure, Sheet } from "./ui";

/** Steps an open card lists inline; longer stretches show the newest ones and open the rest in a sheet. */
const INLINE_STEPS = 8;

/**
 * The transcript's rows (see `rows.ts`): a turn header, the user's bubble, a
 * reply's prose, an activity card per stretch of tool calls, and notices.
 */

interface RowProps {
  row: Row;
  machine: Machine;
  cwd: string;
  /** Plays the entrance once: rows that arrived live, not rows loaded with the transcript. */
  animate: boolean;
  onOpenStep: (step: Step) => void;
}

function TranscriptRowImpl({ row, machine, cwd, animate, onOpenStep }: RowProps): ReactNode {
  let body: ReactNode;
  switch (row.kind) {
    case "user":
      body = <UserBubble item={row.item} machine={machine} />;
      break;
    case "turn":
      body = <TurnHeader />;
      break;
    case "reply":
      body = <Reply item={row.item} machine={machine} />;
      break;
    case "activity":
      body = <ActivityCard row={row} machine={machine} cwd={cwd} onOpenStep={onOpenStep} />;
      break;
    case "notice":
      body = <NoticeLine item={row.item} />;
      break;
    default:
      body = null;
  }
  // Always the same wrapper: switching it off after the first frame would remount the row.
  return <Enter animate={animate}>{body}</Enter>;
}

/** The object a step renders from: a changed step is a new object. */
function stepSource(step: Step): unknown {
  return step.kind === "tool" ? step.tool : step.item;
}

/** Rows are laid out afresh on every change; a row whose items are the same objects need not render again. */
function sameRow(a: Row, b: Row): boolean {
  if (a === b) return true;
  if (a.id !== b.id || a.kind !== b.kind) return false;
  switch (a.kind) {
    case "turn":
      return true;
    case "activity": {
      const other = b as typeof a;
      return (
        a.running === other.running &&
        a.failed === other.failed &&
        a.steps.length === other.steps.length &&
        a.steps.every((step, index) => stepSource(step) === stepSource(other.steps[index] as Step))
      );
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

function Enter({ animate, children }: { animate: boolean; children: ReactNode }): ReactNode {
  const value = useEnter(300, !animate);
  return (
    <Animated.View
      style={{ opacity: value, transform: [{ translateY: value.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) }] }}
    >
      {children}
    </Animated.View>
  );
}

function TurnHeader(): ReactNode {
  const styles = useStyles(createStyles);
  return (
    <View style={styles.turn} accessibilityRole="header" accessibilityLabel="OMP">
      <View style={styles.turnMark}>
        <BrandMark size={11} />
      </View>
      <Text style={styles.turnName}>omp</Text>
    </View>
  );
}

/** Images on a message or a step; tapping one opens it full screen. */
export function Thumbs({
  parts,
  machine,
  size = 112,
  max = 6,
}: {
  parts: ImagePart[] | undefined;
  machine: Machine;
  size?: number;
  max?: number;
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
    <View style={styles.thumbs}>
      {uris.map((uri, index) => (
        <Pressable key={`${index}-${uri.slice(-24)}`} onPress={() => setOpen(uri)} accessibilityRole="imagebutton" accessibilityLabel="Open image">
          <Image source={{ uri, headers }} style={[styles.thumb, { width: size, height: size }]} resizeMode="cover" />
        </Pressable>
      ))}
      <Modal visible={open !== null} transparent animationType="fade" statusBarTranslucent onRequestClose={() => setOpen(null)}>
        <Pressable style={styles.viewer} onPress={() => setOpen(null)} accessibilityLabel="Close image">
          {open !== null ? <Image source={{ uri: open, headers }} style={styles.viewerImage} resizeMode="contain" /> : null}
          <View style={styles.viewerClose}>
            <CloseGlyph size={18} color="#ffffff" />
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

function UserBubble({ item, machine }: { item: MessageItem; machine: Machine }): ReactNode {
  const styles = useStyles(createStyles);
  const hasText = item.text.trim() !== "";
  return (
    <View style={styles.userRow}>
      <View style={styles.bubble}>
        <Thumbs parts={item.images} machine={machine} size={hasText ? 96 : 140} />
        {hasText ? (
          <Text style={styles.bubbleText} selectable>
            {item.text.trim()}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

function Caret(): ReactNode {
  const styles = useStyles(createStyles);
  const pulse = usePulse(true, 1000);
  const opacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 0.25] });
  return <Animated.Text style={[styles.caret, { opacity }]}>▍</Animated.Text>;
}

function Reply({ item, machine }: { item: MessageItem; machine: Machine }): ReactNode {
  const styles = useStyles(createStyles);
  const streaming = item.streaming === true;
  const thinking = item.thinking !== undefined && item.thinking.trim() !== "" ? item.thinking : null;
  const hasText = item.text.trim() !== "";
  return (
    <View style={styles.reply}>
      {thinking !== null ? <Thought text={thinking} active={streaming && !hasText} /> : null}
      <Thumbs parts={item.images} machine={machine} />
      {hasText ? <Markdown text={item.text} caret={streaming ? <Caret /> : undefined} /> : null}
    </View>
  );
}

/** "Thinking…" while it streams, "Thought" after; opens onto the text. */
function Thought({ text, active }: { text: string; active: boolean }): ReactNode {
  const styles = useStyles(createStyles);
  const colors = useColors();
  const [open, setOpen] = useState(false);
  const toggle = useCallback(() => setOpen((value) => !value), []);
  const pulse = usePulse(active, 1400);
  const opacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 0.4] });
  return (
    <View style={styles.thought}>
      <Pressable
        onPress={toggle}
        hitSlop={8}
        style={styles.thoughtHead}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
      >
        <SparkGlyph size={13} color={colors.fgFaint} />
        <Animated.Text style={[styles.thoughtLabel, { opacity }]}>{active ? "Thinking…" : "Thought"}</Animated.Text>
        <Disclosure open={open} size={12} />
      </Pressable>
      {open ? (
        <Text style={styles.thoughtText} selectable>
          {text.trim()}
        </Text>
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

/** Seconds since `from` that tick while `active`; the span to `to` once it ended. */
function useElapsed(from: number | undefined, to: number | undefined, active: boolean): number | undefined {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active || from === undefined) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [active, from]);
  if (from === undefined) return undefined;
  if (active) return Math.max(0, now - from);
  return to === undefined ? undefined : Math.max(0, to - from);
}

function ActivityCard({
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
  /** null follows the card's state: open while it runs, closed once done. */
  const [chosen, setChosen] = useState<boolean | null>(null);
  const open = chosen ?? row.running;
  const [all, setAll] = useState(false);
  // Mounted from the first opening on (it keeps its closing slide), not for every card in a long transcript.
  const [allMounted, setAllMounted] = useState(false);
  if (all && !allMounted) setAllMounted(true);
  const toggle = useCallback(() => setChosen((value) => !(value ?? row.running)), [row.running]);
  const pulse = usePulse(row.running, 1600);
  const titleOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 0.55] });
  const tools = row.steps.filter((value): value is Extract<Step, { kind: "tool" }> => value.kind === "tool").map((value) => value.tool);
  const started = tools.find((tool) => tool.startedAt !== undefined)?.startedAt;
  const ended = tools.every((tool) => tool.endedAt !== undefined) ? Math.max(...tools.map((tool) => tool.endedAt ?? 0)) : undefined;
  const elapsed = useElapsed(started, ended, row.running);
  const live = liveStep(row.steps);
  const title = row.running
    ? live === undefined
      ? "Working…"
      : live.kind === "tool"
        ? stepTitle(live.tool)
        : "Thinking…"
    : activitySummary(row.steps);
  const count = toolCount(row.steps);
  const meta = [`${count} step${count === 1 ? "" : "s"}`, elapsed !== undefined ? duration(elapsed) : undefined]
    .filter(Boolean)
    .join(" · ");
  const images = tools.flatMap((tool) => tool.images ?? []);
  const headStyle = useCallback(
    ({ pressed }: PressableStateCallbackType) => [styles.actHead, pressed && styles.pressed],
    [styles],
  );
  return (
    <View style={row.failed > 0 && !row.running ? styles.actFailed : styles.act}>
      <Pressable
        onPress={toggle}
        style={headStyle}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`${title}, ${meta}`}
      >
        <View style={styles.actStatus}>
          {row.running ? (
            <Spinner size={14} color={colors.accent} />
          ) : row.failed > 0 ? (
            <View style={styles.actBadgeErr}>
              <Text style={styles.actBadgeErrText}>!</Text>
            </View>
          ) : (
            <View style={styles.actBadgeOk}>
              <CheckGlyph size={10} color={colors.ok} />
            </View>
          )}
        </View>
        <Animated.Text
          style={[row.running ? styles.actTitleLive : styles.actTitle, row.running ? { opacity: titleOpacity } : null]}
          numberOfLines={1}
        >
          {title}
        </Animated.Text>
        <Text style={styles.actMeta} numberOfLines={1}>
          {row.failed > 0 ? <Text style={styles.actMetaErr}>{`${row.failed} failed · `}</Text> : null}
          {meta}
        </Text>
        <Disclosure open={open} size={12} />
      </Pressable>
      {open ? (
        <View style={styles.steps}>
          {row.steps.length > INLINE_STEPS ? (
            <Pressable
              onPress={() => setAll(true)}
              style={({ pressed }) => [styles.more, pressed && styles.pressed]}
              accessibilityRole="button"
            >
              <Text style={styles.moreText}>
                {`${row.steps.length - INLINE_STEPS} earlier step${row.steps.length - INLINE_STEPS === 1 ? "" : "s"} · show all`}
              </Text>
            </Pressable>
          ) : null}
          {row.steps.slice(-INLINE_STEPS).map((value) => (
            <StepRow key={stepKey(value)} step={value} cwd={cwd} onOpen={onOpenStep} />
          ))}
        </View>
      ) : null}
      {allMounted ? (
        <AllSteps visible={all} steps={row.steps} cwd={cwd} onOpenStep={onOpenStep} onClose={() => setAll(false)} />
      ) : null}
      {images.length > 0 ? (
        <View style={styles.actImages}>
          <Thumbs parts={images} machine={machine} size={88} max={4} />
        </View>
      ) : null}
    </View>
  );
}

function stepKey(value: Step): string {
  return value.kind === "tool" ? value.tool.id : value.item.id;
}

/** Every step of a long stretch, newest last, in a virtualized list. */
function AllSteps({
  visible,
  steps,
  cwd,
  onOpenStep,
  onClose,
}: {
  visible: boolean;
  steps: readonly Step[];
  cwd: string;
  onOpenStep: (step: Step) => void;
  onClose: () => void;
}): ReactNode {
  const { height } = useWindowDimensions();
  const count = toolCount(steps);
  return (
    <Sheet visible={visible} title={`${count} step${count === 1 ? "" : "s"}`} onClose={onClose} scroll={false}>
      {visible ? (
        <FlatList
          style={{ maxHeight: height * 0.72 }}
          data={steps}
          keyExtractor={stepKey}
          renderItem={({ item }) => <StepRow step={item} cwd={cwd} onOpen={onOpenStep} />}
          initialScrollIndex={Math.max(0, steps.length - 1)}
          getItemLayout={(_, index) => ({ length: STEP_HEIGHT, offset: STEP_HEIGHT * index, index })}
          initialNumToRender={20}
        />
      ) : null}
    </Sheet>
  );
}

/** A step row's fixed height, so long lists can jump to their end. */
const STEP_HEIGHT = 50;

function StepRow({ step, cwd, onOpen }: { step: Step; cwd: string; onOpen: (step: Step) => void }): ReactNode {
  const styles = useStyles(createStyles);
  const colors = useColors();
  const style = useCallback(({ pressed }: PressableStateCallbackType) => [styles.step, pressed && styles.pressed], [styles]);
  const press = useCallback(() => onOpen(step), [onOpen, step]);
  if (step.kind === "thought") {
    return (
      <Pressable onPress={press} style={style} accessibilityRole="button" accessibilityLabel="Thought">
        <View style={styles.stepIcon}>
          <SparkGlyph size={13} color={colors.fgFaint} />
        </View>
        <View style={styles.stepText}>
          <Text style={styles.stepTitleQuiet} numberOfLines={1}>
            {step.item.streaming === true ? "Thinking…" : "Thought"}
          </Text>
          <Text style={styles.stepTarget} numberOfLines={1}>
            {(step.item.thinking ?? "").replace(/\s+/g, " ").trim()}
          </Text>
        </View>
      </Pressable>
    );
  }
  const tool = step.tool;
  const running = tool.status === "running";
  const failed = tool.status === "error";
  const kind = toolKind(tool.name);
  const target = stepTarget(tool, cwd);
  const stat = stepStat(tool);
  const edit = stat !== undefined && /^\+\d+ −\d+$/.test(stat) ? stat.split(" ") : undefined;
  return (
    <Pressable onPress={press} style={style} accessibilityRole="button" accessibilityLabel={`${stepTitle(tool)}, ${tool.status}`}>
      <View style={failed ? styles.stepIconErr : running ? styles.stepIconLive : styles.stepIcon}>
        <KindGlyph kind={kind} color={failed ? colors.err : running ? colors.accent : colors.fgFaint} />
      </View>
      <View style={styles.stepText}>
        <Text style={running ? styles.stepTitleLive : styles.stepTitle} numberOfLines={1}>
          {stepTitle(tool)}
        </Text>
        {target !== undefined ? (
          <Text style={styles.stepTarget} numberOfLines={1}>
            {target}
          </Text>
        ) : null}
      </View>
      {running ? (
        <Spinner size={11} color={colors.accent} />
      ) : edit !== undefined ? (
        <Text style={styles.stepStat}>
          <Text style={styles.statAdd}>{edit[0]}</Text> <Text style={styles.statRemove}>{edit[1]}</Text>
        </Text>
      ) : stat !== undefined ? (
        <Text style={failed ? styles.stepStatErr : styles.stepStat}>{stat}</Text>
      ) : null}
    </Pressable>
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
      >
        {item.text}
      </Text>
    </View>
  );
}

function createStyles(c: Palette) {
  const card = {
    marginHorizontal: 16,
    marginTop: 4,
    marginBottom: 10,
    borderRadius: radius.lg + 2,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: c.border,
    backgroundColor: c.panel,
    overflow: "hidden",
  } as const;
  const iconTile = { width: 26, height: 26, borderRadius: 8, alignItems: "center", justifyContent: "center", backgroundColor: c.well } as const;
  const stepTitle = { fontFamily: SANS, fontSize: 13.5, lineHeight: 18, fontWeight: "400", color: c.fgMuted } as const;
  const mono = { fontFamily: MONO, fontSize: 11, lineHeight: 15, fontWeight: "400", color: c.fgGhost } as const;
  const noticeDot = { width: 5, height: 5, borderRadius: 3, marginTop: 6, backgroundColor: c.fgGhost } as const;
  const noticeText = { flex: 1, fontFamily: MONO, fontSize: 11.5, lineHeight: 17, color: c.fgFaint } as const;
  const badge = { width: 16, height: 16, borderRadius: 8, alignItems: "center", justifyContent: "center" } as const;
  const actTitle = { flex: 1, minWidth: 0, fontFamily: SANS, fontSize: 13.5, lineHeight: 18, fontWeight: "400", color: c.fgMuted } as const;
  return {
    pressed: { backgroundColor: c.hover },

    turn: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16, marginTop: 14, marginBottom: 8 },
    turnMark: {
      width: 20,
      height: 20,
      borderRadius: 6,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: c.raised,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
    },
    turnName: { fontFamily: MONO, fontSize: 11.5, lineHeight: 15, fontWeight: "500", color: c.fgFaint },

    userRow: { flexDirection: "row", justifyContent: "flex-end", paddingLeft: 56, paddingRight: 14, marginTop: 14, marginBottom: 4 },
    bubble: {
      maxWidth: "100%",
      gap: 8,
      paddingHorizontal: 14,
      paddingVertical: 10,
      borderRadius: 20,
      borderBottomRightRadius: 6,
      backgroundColor: c.userBubble,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
    },
    bubbleText: { fontFamily: SANS, fontSize: 15, lineHeight: 22, fontWeight: "400", color: c.fg },

    reply: { paddingHorizontal: 16, gap: 8, marginBottom: 8 },
    caret: { fontFamily: SANS, color: c.accent },
    thought: { gap: 6 },
    thoughtHead: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start", paddingVertical: 2 },
    thoughtLabel: { fontFamily: SANS, fontSize: 13, lineHeight: 18, fontWeight: "400", color: c.fgFaint },
    thoughtText: {
      fontFamily: SANS,
      fontSize: 13,
      lineHeight: 20,
      color: c.fgFaint,
      borderLeftWidth: 2,
      borderLeftColor: c.border,
      paddingLeft: 12,
    },

    thumbs: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
    thumb: { borderRadius: 12, backgroundColor: c.inset },
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

    act: card,
    actFailed: { ...card, borderColor: c.errBorder },
    actHead: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 44, paddingHorizontal: 12, paddingVertical: 10 },
    actStatus: { width: 16, alignItems: "center", justifyContent: "center" },
    actBadgeOk: { ...badge, backgroundColor: c.okSoft },
    actBadgeErr: { ...badge, backgroundColor: c.errSoft },
    actBadgeErrText: { fontFamily: SANS, fontSize: 11, lineHeight: 14, fontWeight: "600", color: c.err },
    actTitle,
    actTitleLive: { ...actTitle, color: c.fg },
    actMeta: { flexShrink: 0, maxWidth: "45%", fontFamily: MONO, fontSize: 11, lineHeight: 15, color: c.fgGhost },
    actMetaErr: { color: c.err },
    actImages: { paddingHorizontal: 12, paddingBottom: 12 },
    steps: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border, paddingVertical: 4 },
    step: { flexDirection: "row", alignItems: "center", gap: 10, height: STEP_HEIGHT, paddingHorizontal: 12 },
    more: { height: 36, justifyContent: "center", paddingHorizontal: 48 },
    moreText: { fontFamily: MONO, fontSize: 11, lineHeight: 15, color: c.fgFaint },
    stepIcon: iconTile,
    stepIconLive: { ...iconTile, backgroundColor: c.accentMuted },
    stepIconErr: { ...iconTile, backgroundColor: c.errSoft },
    stepText: { flex: 1, minWidth: 0, gap: 1 },
    stepTitle,
    stepTitleLive: { ...stepTitle, color: c.fg },
    stepTitleQuiet: { ...stepTitle, color: c.fgFaint },
    stepTarget: mono,
    stepStat: { ...mono, color: c.fgFaint },
    stepStatErr: { ...mono, color: c.err },
    statAdd: { color: c.ok },
    statRemove: { color: c.err },

    notice: { flexDirection: "row", gap: 8, paddingHorizontal: 20, paddingVertical: 6 },
    noticeDot,
    noticeDotWarn: { ...noticeDot, backgroundColor: c.warn },
    noticeDotErr: { ...noticeDot, backgroundColor: c.err },
    noticeText,
    noticeTextWarn: { ...noticeText, color: c.warn },
    noticeTextErr: { ...noticeText, color: c.err },
  } as const;
}
