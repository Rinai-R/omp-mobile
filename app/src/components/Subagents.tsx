import { useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { FlatList, Modal, StyleSheet, Text, View, useWindowDimensions, type ListRenderItem } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import Animated, { Extrapolation, interpolate, useAnimatedStyle, useReducedMotion, useSharedValue, withSpring, withTiming } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { fetchSubagent, listSubagents } from "../api";
import { heldOf } from "../cache";
import { t } from "../i18n/index.ts";
import { snapshotItems } from "../messages";
import { layoutRows, type Row, type Step } from "../rows";
import { callSubagents, mergeSubagent } from "../subagents";
import { SPRING_SCREEN } from "../motion";
import { MONO, SANS, useColors, useStyles, type Palette } from "../theme";
import type { AgentMessage, Machine, Subagent, ToolItem } from "../types";
import { Spinner } from "./brand";
import { FileLinksContext } from "./FileCards";
import { SubagentLinksContext } from "./SubagentLinks";
import { TranscriptFolds, TranscriptRow } from "./Transcript";
import { Banner, FADE_REDUCED, Group, Header, Row as ListRow, StatusDot } from "./ui";

/**
 * The subagents a `task` call started, and one subagent's transcript, read
 * from the computer (`subagents`). The daemon reads OMP's files, so both poll
 * while something runs: the list every few seconds, an open transcript faster.
 */
const LIST_POLL_MS = 3_000;
const TRANSCRIPT_POLL_MS = 2_000;

function statusColor(status: Subagent["status"], c: Palette): string {
  return status === "running" ? c.accent : status === "completed" ? c.ok : status === "failed" ? c.err : c.fgFaint;
}

/** The subagents of one `task` call, as rows that open each one's transcript. */
export function SubagentList({
  machine,
  sessionId,
  parent,
  tool,
  running,
  onOpen,
}: {
  machine: Machine;
  sessionId: string;
  /** The subagent whose transcript holds the call; null for the session's own. */
  parent: string | null;
  /** The `task` or `wait` call the subagents belong to. */
  tool: ToolItem;
  /** The call still runs: its subagents may not have started yet. */
  running: boolean;
  onOpen: (subagent: Subagent) => void;
}): ReactNode {
  const styles = useStyles(createStyles);
  const colors = useColors();
  const [list, setList] = useState<Subagent[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mine = useMemo(() => (list === null ? [] : callSubagents(list, parent, tool)), [list, parent, tool]);
  const busy = running || mine.some((subagent) => subagent.status === "running");
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = () => {
      listSubagents(machine, sessionId)
        .then((next) => {
          if (cancelled) return;
          setList(next);
          setError(null);
        })
        .catch((cause: unknown) => {
          if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
        })
        .finally(() => {
          if (!cancelled && busy) timer = setTimeout(load, LIST_POLL_MS);
        });
    };
    load();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [busy, machine, sessionId]);

  if (error === null && mine.length === 0 && !running) return null;
  return (
    <View style={styles.block}>
      <Text style={styles.label}>{t("subagents.title")}</Text>
      {error !== null ? <Text style={styles.error}>{error}</Text> : null}
      {mine.length === 0 ? (
        running ? <Text style={styles.note}>{t("subagents.starting")}</Text> : null
      ) : (
        <Group>
          {mine.map((subagent, index) => (
            <ListRow
              key={subagent.id}
              title={subagent.agentId}
              detail={subagent.description ?? subagent.task ?? subagent.agent}
              leading={subagent.status === "running" ? <Spinner size={12} /> : <StatusDot color={statusColor(subagent.status, colors)} />}
              trailing={<Text style={[styles.status, { color: statusColor(subagent.status, colors) }]}>{t(`subagents.status.${subagent.status}`)}</Text>}
              last={index === mine.length - 1}
              onPress={() => onOpen(subagent)}
            />
          ))}
        </Group>
      )}
    </View>
  );
}

/**
 * One subagent's transcript, full screen and read-only, with the chat's rows.
 * `renderStep` draws a step's details sheet: the caller's, so a subagent's own
 * `task` calls open their subagents the same way. It is a level deeper than
 * the list it came from, so it pushes in from the right and leaves the same way.
 */
export function SubagentScreen({
  machine,
  sessionId,
  subagent,
  cwd,
  onClose,
  renderStep,
}: {
  machine: Machine;
  sessionId: string;
  subagent: Subagent | null;
  cwd: string;
  onClose: () => void;
  renderStep: (step: Step | null, onClose: () => void, parent: string) => ReactNode;
}): ReactNode {
  const styles = useStyles(createStyles);
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const reduced = useReducedMotion();
  const visible = subagent !== null;
  const [mounted, setMounted] = useState(visible);
  const x = useSharedValue(width);
  const fade = useSharedValue(reduced ? 0 : 1);
  const laidOut = useRef(false);
  const pending = useRef(visible);
  const enter = useCallback(() => {
    if (reduced) {
      x.set(0);
      fade.set(withTiming(1, FADE_REDUCED));
    } else x.set(withSpring(0, SPRING_SCREEN));
  }, [fade, reduced, x]);
  const unmount = useCallback(() => {
    laidOut.current = false;
    setMounted(false);
    x.set(width);
  }, [width, x]);
  useEffect(() => {
    if (visible) {
      setMounted(true);
      // Reopened mid-exit: from where it is. Otherwise once the Modal has laid it out.
      if (laidOut.current) enter();
      else pending.current = true;
      return;
    }
    pending.current = false;
    const done = (finished?: boolean): void => {
      "worklet";
      if (finished === true) scheduleOnRN(unmount);
    };
    if (!laidOut.current) unmount();
    else if (reduced) fade.set(withTiming(0, FADE_REDUCED, done));
    else x.set(withSpring(width, SPRING_SCREEN, done));
    // Only `subagent` opening or closing drives this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);
  const onLayout = useCallback(() => {
    laidOut.current = true;
    if (!pending.current) return;
    pending.current = false;
    enter();
  }, [enter]);
  const slide = useAnimatedStyle(() => ({ opacity: fade.get(), transform: [{ translateX: x.get() }] }));
  // The sheet it came from dims as the transcript covers it.
  const scrim = useAnimatedStyle(() => ({ opacity: interpolate(x.get(), [0, width], [1, 0], Extrapolation.CLAMP) * fade.get() }));
  const [info, setInfo] = useState<Subagent | null>(subagent);
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<Step | null>(null);
  /** A subagent this one started, opened from its rows: shown over this one. */
  const [child, setChild] = useState<Subagent | null>(null);
  const outer = useContext(SubagentLinksContext);
  const outerFiles = useContext(FileLinksContext);
  // A subagent's writes are not the session's own: only what the daemon lists is offered.
  const files = useMemo(() => (outerFiles === null ? null : { ...outerFiles, own: false }), [outerFiles]);
  const messagesRef = useRef<AgentMessage[]>([]);
  const id = subagent?.id;

  // Leaving keeps the transcript on screen while it slides away; the next one starts clean.
  useEffect(() => {
    if (id === undefined) return;
    messagesRef.current = [];
    setMessages([]);
    setInfo(subagent);
    setError(null);
    setStep(null);
    setChild(null);
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = () => {
      const held = heldOf(messagesRef.current);
      fetchSubagent(machine, sessionId, id, held)
        .then((answer) => {
          if (cancelled) return;
          const next = mergeSubagent(messagesRef.current, held, answer);
          messagesRef.current = next;
          setMessages(next);
          setInfo(answer.subagent);
          setError(null);
          if (answer.subagent.status === "running") timer = setTimeout(load, TRANSCRIPT_POLL_MS);
        })
        .catch((cause: unknown) => {
          if (cancelled) return;
          setError(cause instanceof Error ? cause.message : String(cause));
          timer = setTimeout(load, TRANSCRIPT_POLL_MS * 2);
        });
    };
    load();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // `subagent` seeds the header; only another id is another transcript.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, machine, sessionId]);

  const running = info?.status === "running";
  const rows = useMemo(() => layoutRows(snapshotItems(messages), running).reverse(), [messages, running]);
  /** The open step as it is now: a running tool's output keeps arriving while its sheet is open. */
  const openStep = useMemo(() => {
    if (step === null || step.kind !== "tool") return step;
    for (const row of rows) {
      if (row.kind !== "activity") continue;
      const found = row.steps.find((item) => item.kind === "tool" && item.tool.id === step.tool.id);
      if (found !== undefined) return found;
    }
    return step;
  }, [rows, step]);
  const renderItem: ListRenderItem<Row> = ({ item }) => <TranscriptRow row={item} machine={machine} cwd={cwd} animate={false} onOpenStep={setStep} />;

  const subtitle = info === null ? undefined : [info.agent, t(`subagents.status.${info.status}`), t("subagents.messages", { count: messages.length })].filter(Boolean).join(" · ");
  return (
    <Modal visible={mounted} transparent animationType="none" statusBarTranslucent onRequestClose={onClose}>
      <GestureHandlerRootView style={styles.fill}>
        <Animated.View style={[styles.scrim, scrim]} />
        <Animated.View onLayout={onLayout} style={[styles.screen, { paddingTop: insets.top, paddingBottom: insets.bottom }, slide]}>
          <Header title={info?.agentId ?? ""} subtitle={subtitle} onBack={onClose} />
          {error !== null ? <Banner text={error} /> : null}
          <View style={styles.listWrap}>
            <SubagentLinksContext.Provider value={outer === null || id === undefined ? null : { list: outer.list, parent: id, open: setChild }}>
              <FileLinksContext.Provider value={files}>
                <TranscriptFolds>
                  <FlatList inverted data={rows} keyExtractor={(row) => row.id} renderItem={renderItem} contentContainerStyle={styles.list} initialNumToRender={14} windowSize={11} />
                </TranscriptFolds>
              </FileLinksContext.Provider>
            </SubagentLinksContext.Provider>
            {rows.length === 0 && error === null ? (
              <View style={styles.empty} pointerEvents="none">
                <Text style={styles.note}>{t("subagents.empty")}</Text>
              </View>
            ) : null}
          </View>
        </Animated.View>
      </GestureHandlerRootView>
      {id !== undefined ? renderStep(openStep, () => setStep(null), id) : null}
      {id !== undefined ? (
        <SubagentScreen machine={machine} sessionId={sessionId} subagent={child} cwd={cwd} onClose={() => setChild(null)} renderStep={renderStep} />
      ) : null}
    </Modal>
  );
}

function createStyles(c: Palette) {
  return {
    block: { gap: 6 },
    label: {
      fontFamily: MONO,
      fontSize: 10.5,
      lineHeight: 14,
      letterSpacing: 1.2,
      textTransform: "uppercase",
      color: c.fgGhost,
      paddingHorizontal: 2,
    },
    note: { fontFamily: SANS, fontSize: 13, lineHeight: 18, color: c.fgFaint, paddingHorizontal: 2 },
    error: { fontFamily: SANS, fontSize: 12.5, lineHeight: 18, color: c.err, paddingHorizontal: 2 },
    status: { fontFamily: MONO, fontSize: 11.5, lineHeight: 16 },
    fill: { flex: 1 },
    scrim: { ...StyleSheet.absoluteFill, backgroundColor: c.backdrop },
    screen: { flex: 1, backgroundColor: c.bg },
    listWrap: { flex: 1 },
    list: { paddingTop: 16, paddingBottom: 12 },
    empty: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, alignItems: "center", justifyContent: "center" },
  } as const;
}
