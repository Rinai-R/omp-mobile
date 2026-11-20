import * as Clipboard from "expo-clipboard";
import {
  createContext,
  Fragment,
  memo,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  Animated,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type FontVariant,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
  useWindowDimensions,
} from "react-native";
import Reanimated, {
  ReduceMotion,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
  type SharedValue,
  type WithTimingConfig,
} from "react-native-reanimated";
import { EASE_OUT, QUICK } from "../motion";
import { haptic } from "../haptics";
import type { Frame, SendFlight, Shown } from "../sendFlight";
import { editDiff } from "../diff";
import { imageUri, relayImageUri } from "../media";
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
import { MONO, SANS, SCALE, radius, type, useColors, useStyles, type Palette } from "../theme";
import type { ImagePart, Machine, MessageItem, NoticeItem, ToolItem } from "../types";
import { BrandMark, GradientFill, Orb, ShimmerText, Spinner, useEnter, usePulse } from "./brand";
import {
  AgentsGlyph,
  CheckGlyph,
  ChevronDownGlyph,
  CloseGlyph,
  CopyGlyph,
  FileGlyph,
  ForkGlyph,
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

/**
 * The list is inverted: it keeps each row's distance from the newest message,
 * so a row that opens grows upward and its own header slides off the top.
 * `onShift` moves the list by the height a row gained on a tap, which keeps
 * the tapped header where the finger left it, as in a list that grows down.
 */
const ShiftContext = createContext<(delta: number) => void>(() => undefined);

/** Marks the row around a control: its next change of height came from a tap. */
const ArmContext = createContext<() => void>(() => undefined);

/**
 * What a long press on a message opens (fork from it, copy it); undefined
 * where the daemon cannot fork, and the user's bubble stays selectable text.
 */
const MessageActionContext = createContext<((item: MessageItem) => void) | undefined>(undefined);

/** The flight of a message just sent, which the newest user row may be the landing of. */
const FlightContext = createContext<SendFlight | undefined>(undefined);

/**
 * The daemon's transcript is in (`live`): a turn seen running from here on is live, not
 * replayed history. `turns` remembers, per turn id, that it was seen running and whether its
 * finish has played, outside the divider: the divider remounts as the turn's rows regroup
 * on finishing, which would forget it was ever watched.
 */
const LiveContext = createContext<{ live: boolean; turns: Map<string, "watched" | "played"> }>({ live: false, turns: new Map() });

function useArm(): () => void {
  return useContext(ArmContext);
}

/**
 * Holds which turns are folded, for the rows under it; `onShift` keeps a
 * tapped row in place; `onMessageAction` opens a message's actions.
 */
export function TranscriptFolds({
  children,
  onShift,
  onMessageAction,
  flight,
  live = false,
}: {
  children: ReactNode;
  onShift?: (delta: number) => void;
  onMessageAction?: (item: MessageItem) => void;
  flight?: SendFlight;
  live?: boolean;
}): ReactNode {
  const [folded, setFolded] = useState<ReadonlySet<string>>(() => new Set());
  const [turns] = useState(() => new Map<string, "watched" | "played">());
  const liveValue = useMemo(() => ({ live, turns }), [live, turns]);
  const toggle = useCallback((turn: string) => {
    setFolded((current) => {
      const next = new Set(current);
      if (next.has(turn)) next.delete(turn);
      else next.add(turn);
      return next;
    });
  }, []);
  const value = useMemo(() => ({ folded, toggle }), [folded, toggle]);
  const shift = useCallback((delta: number) => onShift?.(delta), [onShift]);
  return (
    <ShiftContext.Provider value={shift}>
      <MessageActionContext.Provider value={onMessageAction}>
        <FlightContext.Provider value={flight}>
          <LiveContext.Provider value={liveValue}>
            <FoldContext.Provider value={value}>{children}</FoldContext.Provider>
          </LiveContext.Provider>
        </FlightContext.Provider>
      </MessageActionContext.Provider>
    </ShiftContext.Provider>
  );
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
  const flight = useContext(FlightContext);
  // Decided once, as the row mounts: the message just sent (the optimistic copy) lands here instead of playing the entrance.
  const [flying] = useState(() => row.kind === "user" && row.item.local === true && flight !== undefined && flight.wants(row.item.text.trim()));
  const hidden = (row.kind === "thinking" || row.kind === "activity") && folded.has(row.turn);
  let body: ReactNode;
  switch (row.kind) {
    case "user":
      body = <UserMessage item={row.item} machine={machine} flight={flying ? flight : undefined} />;
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
      body = <TurnTail text={row.text} at={row.at} last={row.last} />;
      break;
    case "notice":
      body = <NoticeLine item={row.item} />;
      break;
    default:
      body = null;
  }
  // Always the same wrapper: switching it off after the first frame would remount the row.
  return (
    <Enter animate={animate && !flying} gap={hidden ? 0 : row.gap}>
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
      return a.text === other.text && a.at === other.at && a.last === other.last;
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

/** A live row's entrance: a short fade and an 8 dp rise (just the fade under reduced motion). */
const RISE = 8;

function Enter({ animate, gap, children }: { animate: boolean; gap: number; children: ReactNode }): ReactNode {
  const value = useEnter(220, !animate);
  const reduced = useReducedMotion();
  const shift = useContext(ShiftContext);
  const height = useRef<number | undefined>(undefined);
  const armed = useRef(false);
  const arm = useCallback(() => {
    armed.current = true;
  }, []);
  const onLayout = useCallback(
    (event: LayoutChangeEvent) => {
      const next = event.nativeEvent.layout.height;
      const before = height.current;
      height.current = next;
      if (armed.current && before !== undefined && next !== before) {
        armed.current = false;
        shift(next - before);
      }
    },
    [shift],
  );
  const entrance = useAnimatedStyle(() => {
    const v = value.get();
    return { opacity: v, transform: [{ translateY: reduced ? 0 : (1 - v) * RISE }] };
  }, [reduced]);
  return (
    <ArmContext.Provider value={arm}>
    <Reanimated.View onLayout={onLayout} style={[{ marginTop: gap, paddingHorizontal: GUTTER }, entrance]}>
      {children}
    </Reanimated.View>
    </ArmContext.Provider>
  );
}

/** Follows `open` 0 → 1 on the UI thread, starting where it is so a quick second tap reverses it. */
function useOpenProgress(open: boolean): SharedValue<number> {
  const value = useSharedValue(open ? 1 : 0);
  useEffect(() => {
    value.set(withTiming(open ? 1 : 0, QUICK));
  }, [open, value]);
  return value;
}

/** False only during the first render: what is open as a row mounts shows at once, what opens on a tap fades in. */
function useMounted(): boolean {
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
  }, []);
  return mounted.current;
}

/**
 * What a row opens onto. It fades in when opened by a tap; its height is not
 * animated (that would lay the list out every frame), the fade carries the change.
 */
function Reveal({ play, style, children }: { play: boolean; style: StyleProp<ViewStyle>; children: ReactNode }): ReactNode {
  const value = useEnter(180, !play);
  const fade = useAnimatedStyle(() => ({ opacity: value.get() }));
  return <Reanimated.View style={[style, fade]}>{children}</Reanimated.View>;
}

/** A chevron that points down while closed and turns to point up as its row opens; `fade` also hides it while closed. */
function Turn({ open, fade = false }: { open: boolean; fade?: boolean }): ReactNode {
  const colors = useColors();
  const progress = useOpenProgress(open);
  const style = useAnimatedStyle(() => {
    const p = progress.get();
    return { opacity: fade ? p : 1, transform: [{ rotate: `${p * 180}deg` }] };
  }, [fade]);
  return (
    <Reanimated.View style={style}>
      <ChevronDownGlyph size={14} color={colors.fgFaint} />
    </Reanimated.View>
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
  const arm = useArm();
  const press = useCallback(() => {
    arm();
    toggle(row.id);
  }, [arm, row.id, toggle]);
  const beat = useFinishBeat(row);
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
        {beat !== undefined ? (
          <FinishMark progress={beat} />
        ) : (
          <BrandMark size={13} color={row.running ? undefined : row.end === "failed" ? colors.err : colors.fgGhost} />
        )}
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
        <FadeIn progress={beat}>
          <Text style={row.end === "failed" ? styles.dividerFailed : styles.dividerText} numberOfLines={1} maxFontSizeMultiplier={SCALE.meta}>
            {label}
          </Text>
        </FadeIn>
      )}
      {foldable ? (
        <View style={styles.dividerChevron}>
          <Turn open={open} />
        </View>
      ) : null}
    </Pressable>
  );
}

const BEAT: WithTimingConfig = { duration: 220, easing: EASE_OUT, reduceMotion: ReduceMotion.Never };

/**
 * The moment a turn seen running live finishes "Done": its progress 0 → 1 (220 ms),
 * with one success tap. Undefined for turns loaded finished, replayed, failed or stopped,
 * and for a finish that already played (a remount shows the plain mark).
 */
function useFinishBeat(row: Extract<Row, { kind: "turn" }>): SharedValue<number> | undefined {
  const { live, turns } = useContext(LiveContext);
  const progress = useSharedValue(0);
  const [beat, setBeat] = useState(false);
  // Idempotent, so safe while rendering: the mark outlives this divider.
  if (row.running && live && !turns.has(row.id)) turns.set(row.id, "watched");
  const due = !row.running && turns.get(row.id) === "watched";
  // Before paint: the frame the turn ends already draws the beat's first state, not the plain text.
  useLayoutEffect(() => {
    if (!due || turns.get(row.id) !== "watched") return;
    turns.set(row.id, "played");
    if (row.end !== "done") return;
    setBeat(true);
    haptic.done();
    progress.set(withTiming(1, BEAT));
  }, [due, progress, row.end, row.id, turns]);
  return beat ? progress : undefined;
}

/** The π giving way to a check: crossfade, the check growing from 0.8 (no growth under reduced motion). */
function FinishMark({ progress }: { progress: SharedValue<number> }): ReactNode {
  const colors = useColors();
  const reduced = useReducedMotion();
  const mark = useAnimatedStyle(() => ({ opacity: 1 - progress.get() }));
  const check = useAnimatedStyle(() => {
    const p = progress.get();
    return { opacity: p, transform: [{ scale: reduced ? 1 : 0.8 + 0.2 * p }] };
  }, [reduced]);
  return (
    <>
      <Reanimated.View style={[StyleSheet.absoluteFill, CENTER, mark]}>
        <BrandMark size={13} color={colors.fgGhost} />
      </Reanimated.View>
      <Reanimated.View style={check}>
        <CheckGlyph size={14} color={colors.ok} />
      </Reanimated.View>
    </>
  );
}

const CENTER = { alignItems: "center", justifyContent: "center" } as const;

/** Fades its child in with `progress`; a plain wrapper otherwise. */
function FadeIn({ progress, children }: { progress: SharedValue<number> | undefined; children: ReactNode }): ReactNode {
  const fallback = useSharedValue(1);
  const value = progress ?? fallback;
  const style = useAnimatedStyle(() => ({ opacity: value.get() }));
  return <Reanimated.View style={[FADE_WRAP, style]}>{children}</Reanimated.View>;
}

const FADE_WRAP = { flexShrink: 1 } as const;

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
  /** Blob images of a relay machine, fetched through its tunnel by part index. */
  const [fetched, setFetched] = useState<ReadonlyMap<number, string>>(new Map());
  useEffect(() => {
    let live = true;
    (parts ?? []).forEach((part, index) => {
      void relayImageUri(machine, part)?.then((uri) => {
        if (live && uri !== undefined) setFetched((current) => new Map(current).set(index, uri));
      });
    });
    return () => {
      live = false;
    };
  }, [machine, parts]);
  const uris = useMemo(
    () =>
      (parts ?? [])
        .map((part, index) => imageUri(machine, part) ?? fetched.get(index))
        .filter((uri): uri is string => uri !== undefined)
        .slice(0, max),
    [fetched, machine, max, parts],
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

/** The user's message: images above, then a tinted bubble, both on the right. A long press opens its actions. */
function UserMessage({ item, machine, flight }: { item: MessageItem; machine: Machine; flight?: SendFlight }): ReactNode {
  const styles = useStyles(createStyles);
  const colors = useColors();
  const action = useContext(MessageActionContext);
  const hasText = item.text.trim() !== "";
  // The actions offer Copy, so the bubble gives up text selection, which would take the long press.
  // Not until OMP has it: a fork from here needs OMP's copy of the message.
  const actionable = action !== undefined && item.createdAt !== undefined && item.local !== true;
  const bubble = hasText ? (
    <Pressable
      onLongPress={actionable ? () => action(item) : undefined}
      disabled={!actionable}
      style={item.local === true ? [styles.bubble, styles.bubbleSending] : styles.bubble}
      accessibilityHint={actionable ? t("fork.messageHint") : undefined}
    >
      <GradientFill colors={[colors.userA, colors.userB]} />
      <Text style={styles.bubbleText} selectable={!actionable} maxFontSizeMultiplier={SCALE.body}>
        {item.text.trim()}
      </Text>
    </Pressable>
  ) : null;
  return (
    <View style={styles.userRow}>
      <Thumbs parts={item.images} machine={machine} size={hasText ? 96 : 140} end />
      {flight !== undefined && bubble !== null ? (
        <Landing flight={flight} text={item.text.trim()}>
          {bubble}
        </Landing>
      ) : (
        bubble
      )}
      {item.local === true ? <Text style={styles.sending}>{item.queued === true ? t("composer.queuedLabel") : t("chat.sending")}</Text> : null}
    </View>
  );
}

/** The bubble a sent message flies into: hidden until the flight hands over, measured once laid out. */
function Landing({ flight, text, children }: { flight: SendFlight; text: string; children: ReactNode }): ReactNode {
  const opacity = useSharedValue(0);
  const rise = useSharedValue(0);
  const ref = useRef<View>(null);
  const id = useRef<number | undefined>(undefined);
  const measured = useRef(false);
  useLayoutEffect(() => {
    id.current = flight.claim(text, { opacity, rise });
    // Too late for the flight (or a remount after it): just show.
    if (id.current === undefined) opacity.set(1);
  }, [flight, opacity, rise, text]);
  const onLayout = useCallback(() => {
    const claimed = id.current;
    if (measured.current || claimed === undefined) return;
    measured.current = true;
    const node = ref.current;
    if (node === null) flight.placed(claimed, undefined);
    else node.measureInWindow((x, y, width, height) => flight.placed(claimed, { x, y, width, height } satisfies Frame));
  }, [flight]);
  const style = useAnimatedStyle(() => ({ opacity: opacity.get(), transform: [{ translateY: rise.get() }] }));
  return (
    <Reanimated.View ref={ref} onLayout={onLayout} style={[{ maxWidth: "100%" }, style]}>
      {children}
    </Reanimated.View>
  );
}

/** Room the user's bubble leaves on the left (`userRow`'s indent). */
const USER_INDENT = 48;

/**
 * The copy of a sent message's bubble that flies from the composer to its row
 * (see `sendFlight.ts`). It lies over the whole chat screen and takes no touches.
 */
export function SendFlightLayer({ flight }: { flight: SendFlight }): ReactNode {
  const styles = useStyles(createStyles);
  const colors = useColors();
  const { width } = useWindowDimensions();
  const [shown, setShown] = useState<Shown | null>(null);
  useEffect(() => {
    flight.listener = setShown;
    return () => {
      flight.listener = null;
    };
  }, [flight]);
  const values = flight.values;
  const box = useAnimatedStyle(() => {
    const p = values.progress.get();
    const scale = values.fromScale.get();
    return {
      opacity: values.visible.get() * (1 - SENDING_DIM * p),
      transform: [
        { translateX: values.fromX.get() + (values.toX.get() - values.fromX.get()) * p },
        { translateY: values.fromY.get() + (values.toY.get() - values.fromY.get()) * p },
        { scale: scale + (1 - scale) * p },
      ],
    };
  });
  // The bubble's tint arrives a little ahead of its place, so it reads as a bubble before it settles.
  const skin = useAnimatedStyle(() => ({ opacity: Math.min(1, values.progress.get() * 1.4) }));
  const id = shown?.id;
  return (
    <View
      ref={(node) => {
        flight.host = node;
      }}
      style={styles.flightHost}
      collapsable={false}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {/* Always mounted: a flight only waits for React to commit its text, never for the view to appear. */}
      <Reanimated.View collapsable={false} style={[styles.flight, { maxWidth: width - 2 * GUTTER - USER_INDENT }, box]}>
        {shown !== null ? (
          // Keyed, so each flight's text reports its layout, which is what lets the flight show.
          <View key={shown.id} style={styles.flightBody} onLayout={() => id !== undefined && flight.drawn(id)}>
            <Reanimated.View style={[styles.flightSkin, skin]}>
              <GradientFill colors={[colors.userA, colors.userB]} />
            </Reanimated.View>
            <Text style={styles.bubbleText} maxFontSizeMultiplier={SCALE.body}>
              {shown.text}
            </Text>
          </View>
        ) : null}
      </Reanimated.View>
    </View>
  );
}

/** A bubble still sending is drawn at 0.7 (`bubbleSending`): the flight lands at the same. */
const SENDING_DIM = 0.3;

function Caret(): ReactNode {
  const styles = useStyles(createStyles);
  const pulse = usePulse(true, 1000);
  const opacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 0.25] });
  return <Animated.Text style={[styles.caret, { opacity }]}>▍</Animated.Text>;
}

/** The reply: a translucent bubble on the left; images above its prose. */
function Reply({ item, machine }: { item: MessageItem; machine: Machine }): ReactNode {
  const styles = useStyles(createStyles);
  const streaming = item.streaming === true;
  const hasText = item.text.trim() !== "";
  return (
    <View style={styles.reply}>
      <Thumbs parts={item.images} machine={machine} />
      {hasText ? (
        <View style={styles.replyBubble}>
          <Markdown text={item.text} caret={streaming ? <Caret /> : undefined} />
        </View>
      ) : null}
    </View>
  );
}

/** A work row's leading slot: a 16 dp box holding the row's glyph, which turns into a chevron as the row opens. */
function Lead({ open, children }: { open: boolean; children: ReactNode }): ReactNode {
  const styles = useStyles(createStyles);
  const colors = useColors();
  const progress = useOpenProgress(open);
  const glyph = useAnimatedStyle(() => ({ opacity: 1 - progress.get() }));
  const chevron = useAnimatedStyle(() => {
    const p = progress.get();
    return { opacity: p, transform: [{ rotate: `${p * 180}deg` }] };
  });
  return (
    <View style={styles.lead}>
      <Reanimated.View style={glyph}>{children}</Reanimated.View>
      <Reanimated.View style={[styles.leadChevron, chevron]} pointerEvents="none">
        <ChevronDownGlyph size={14} color={colors.fgFaint} />
      </Reanimated.View>
    </View>
  );
}

/** "Thinking" while it streams, "Thought" after; opens in place onto the thinking, quiet and indented. */
function ThinkingRow({ item }: { item: MessageItem }): ReactNode {
  const styles = useStyles(createStyles);
  const colors = useColors();
  const [open, setOpen] = useState(false);
  const mounted = useMounted();
  const arm = useArm();
  const toggle = useCallback(() => {
    arm();
    setOpen((value) => !value);
  }, [arm]);
  const active = item.streaming === true && item.text.trim() === "";
  const label = active ? t("transcript.thinking") : thoughtLabel(item.thinkingMs);
  return (
    <View>
      <Pressable onPress={toggle} hitSlop={SLOP} style={styles.line} accessibilityRole="button" accessibilityState={{ expanded: open }} accessibilityLabel={label}>
        <Lead open={open}>
          {active ? <Orb size={15} /> : <ThinkGlyph size={14} color={colors.fgFaint} />}
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
        <Reveal play={mounted} style={styles.thinkingBody}>
          <Markdown text={(item.thinking ?? "").trim()} variant="thought" />
        </Reveal>
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
  const mounted = useMounted();
  const arm = useArm();
  const toggle = useCallback(() => {
    arm();
    setChosen((value) => !(value ?? (row.running || watched)));
  }, [arm, row.running, watched]);
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
        <Reveal play={mounted} style={styles.steps}>
          {row.steps.length > INLINE_STEPS ? (
            <Pressable
              onPress={() => {
                arm();
                setAll((value) => !value);
              }}
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
          {stretches(all ? row.steps : row.steps.slice(-INLINE_STEPS)).map((value) =>
            value.kind === "thought" ? (
              <ThinkingRow key={value.item.id} item={value.item} />
            ) : (
              <View key={value.tools[0]!.id} style={styles.toolGroup}>
                {value.tools.map((tool, index) => (
                  <Fragment key={tool.id}>
                    {index > 0 ? <View style={styles.toolSep} /> : null}
                    <ToolRow tool={tool} cwd={cwd} onOpen={onOpenStep} />
                  </Fragment>
                ))}
              </View>
            ),
          )}
        </Reveal>
      ) : null}
      {images.length > 0 ? (
        <View style={styles.groupImages}>
          <Thumbs parts={images} machine={machine} size={88} max={4} />
        </View>
      ) : null}
    </View>
  );
}

type Stretch = Extract<Step, { kind: "thought" }> | { kind: "tools"; tools: ToolItem[] };

/** Consecutive tool calls share one grouped container; a thought between them ends the group. */
function stretches(steps: readonly Step[]): Stretch[] {
  const out: Stretch[] = [];
  for (const step of steps) {
    if (step.kind === "thought") {
      out.push(step);
      continue;
    }
    const last = out[out.length - 1];
    if (last?.kind === "tools") last.tools.push(step.tool);
    else out.push({ kind: "tools", tools: [step.tool] });
  }
  return out;
}

/**
 * One call as a row in its group: `[tile] Title  summary   status`. Tapping it
 * opens the call in place (command output, a diff, the file it read); a long
 * press, or "Details" under it, opens the whole call in the step sheet.
 */
function ToolRow({ tool, cwd, onOpen }: { tool: ToolItem; cwd: string; onOpen: (step: Step) => void }): ReactNode {
  const styles = useStyles(createStyles);
  const colors = useColors();
  const [open, setOpen] = useState(false);
  const mounted = useMounted();
  const arm = useArm();
  const toggle = useCallback(() => {
    arm();
    setOpen((value) => !value);
  }, [arm]);
  const details = useCallback(() => onOpen({ kind: "tool", tool }), [onOpen, tool]);
  const running = tool.status === "running";
  const failed = tool.status === "error";
  const kind = toolKind(tool.name);
  const summary = toolSummaryLine(tool, cwd);
  const stat = stepStat(tool);
  const edit = stat !== undefined && /^\+\d+ −\d+$/.test(stat) ? stat.split(" ") : undefined;
  const title = toolTitle(tool);
  return (
    <View style={running ? styles.toolRowRun : undefined}>
      <Pressable
        onPress={toggle}
        onLongPress={details}
        style={({ pressed }) => (pressed ? [styles.toolLine, styles.pressed] : styles.toolLine)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={t("common.pair", { label: `${title} ${summary ?? ""}`.trim(), value: t(`step.status.${tool.status}`) })}
      >
        <View style={failed ? styles.tileErr : styles.tile}>
          {running ? <GradientFill radius={8} /> : null}
          <KindGlyph kind={kind} size={14} color={running ? "#ffffff" : failed ? colors.err : colors.tileFg} />
        </View>
        <View style={styles.toolText}>
          {running ? (
            <ShimmerText text={title} style={styles.toolTitle} maxFontSizeMultiplier={SCALE.meta} />
          ) : (
            <Text style={styles.toolTitle} numberOfLines={1} maxFontSizeMultiplier={SCALE.meta}>
              {title}
            </Text>
          )}
          {summary !== undefined ? (
            <Text style={styles.toolSummary} numberOfLines={1} maxFontSizeMultiplier={SCALE.meta}>
              {summary}
            </Text>
          ) : null}
        </View>
        {running ? (
          <View style={styles.statSlot}>
            <Spinner size={11} color={colors.accentB} />
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
            <Text style={styles.statAdd}>{edit[0]}</Text>
            <Text style={styles.statRemove}>{edit[1]?.replace("−", " −")}</Text>
          </Text>
        ) : (
          <Turn open={open} fade />
        )}
      </Pressable>
      {open || (running && kind === "run") ? (
        <Reveal play={mounted} style={styles.toolBody}>
          <ToolBody tool={tool} cwd={cwd} onDetails={details} />
        </Reveal>
      ) : null}
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

/** Under a finished turn: copy the reply, fork from it (where the daemon can), and the time it ended. */
function TurnTail({ text, at, last }: { text: string; at: number | undefined; last: MessageItem | undefined }): ReactNode {
  const styles = useStyles(createStyles);
  const colors = useColors();
  const [copied, copy] = useCopy(text);
  const action = useContext(MessageActionContext);
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
      {action !== undefined && last?.createdAt !== undefined ? (
        <Pressable
          onPress={() => action(last)}
          hitSlop={8}
          style={({ pressed }) => [styles.tailButton, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel={t("fork.here")}
        >
          <ForkGlyph size={15} color={colors.fgFaint} />
        </Pressable>
      ) : null}
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
  const bubbleShape = {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 8,
    borderWidth: 1,
    borderColor: c.userBorder,
    overflow: "hidden",
  } as const;

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

    userRow: { alignItems: "flex-end", gap: 8, paddingLeft: USER_INDENT },
    bubbleSending: { opacity: 1 - SENDING_DIM },
    sending: { fontFamily: SANS, fontSize: 11.5, lineHeight: 15, color: c.fgFaint, marginTop: -4, marginRight: 6 },
    bubble: { ...bubbleShape, maxWidth: "100%", paddingHorizontal: 16, paddingVertical: 12 },
    bubbleText: { fontFamily: SANS, fontSize: 15, lineHeight: 22, fontWeight: "400", color: c.fg },
    // The flying copy, over everything (elevation too: Android draws raised siblings, like the glass bars, above later ones).
    flightHost: { ...StyleSheet.absoluteFill, zIndex: 100, elevation: 100 },
    flight: { position: "absolute", left: 0, top: 0, transformOrigin: "left top" },
    // The bubble's text box (padding plus border); its shape is drawn by a skin that fades in.
    flightBody: { paddingHorizontal: 17, paddingVertical: 13 },
    flightSkin: { ...StyleSheet.absoluteFill, ...bubbleShape },

    reply: { gap: 10 },
    replyBubble: {
      paddingHorizontal: 16,
      paddingVertical: 12,
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
      borderBottomRightRadius: 24,
      borderBottomLeftRadius: 8,
      // No bubble: the reply reads as page text. The padding (border included) stays, so its width does not change.
      borderWidth: 1,
      borderColor: "transparent",
    },
    caret: { fontFamily: SANS, color: c.accentV },

    toolGroup: { borderRadius: radius.lg, backgroundColor: c.group, borderWidth: StyleSheet.hairlineWidth, borderColor: c.border, overflow: "hidden" },
    // Inset like an iOS grouped list: the hairline starts after the tile (padding 12 + tile 28 + gap 12).
    toolSep: { height: StyleSheet.hairlineWidth, marginLeft: 52, backgroundColor: c.separator },
    toolRowRun: { backgroundColor: c.dark ? "#00dbe412" : "#00a8b00d" },
    toolLine: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 48, paddingVertical: 10, paddingHorizontal: 12 },
    tile: { width: 28, height: 28, borderRadius: 8, overflow: "hidden", alignItems: "center", justifyContent: "center", backgroundColor: c.tile },
    tileErr: { width: 28, height: 28, borderRadius: 8, alignItems: "center", justifyContent: "center", backgroundColor: c.errSoft },
    // Title and path share a line when the path fits; otherwise the path wraps beneath, one line, ellipsized.
    toolText: { flex: 1, minWidth: 0, flexDirection: "row", flexWrap: "wrap", alignItems: "center", columnGap: 8 },
    toolTitle: { ...type.bodyMedium, color: c.fg, flexShrink: 1 },
    toolSummary: { ...type.mono, color: c.fgFaint, flexShrink: 1, maxWidth: "100%" },
    toolBody: { paddingHorizontal: 8, paddingBottom: 8, marginTop: -4 },

    line,
    lead: { width: 16, height: 16, marginRight: 6, alignItems: "center", justifyContent: "center" },
    leadChevron: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, alignItems: "center", justifyContent: "center" },
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
