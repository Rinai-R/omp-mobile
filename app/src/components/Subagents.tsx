import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { FlatList, Modal, Text, View, type ListRenderItem } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { fetchSubagent, listSubagents } from "../api";
import { heldOf } from "../cache";
import { t } from "../i18n/index.ts";
import { snapshotItems } from "../messages";
import { layoutRows, type Row, type Step } from "../rows";
import { mergeSubagent, subagentsOf } from "../subagents";
import { MONO, SANS, useColors, useStyles, type Palette } from "../theme";
import type { AgentMessage, Machine, Subagent } from "../types";
import { Spinner } from "./brand";
import { TranscriptFolds, TranscriptRow } from "./Transcript";
import { Banner, Group, Header, Row as ListRow, StatusDot } from "./ui";

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
  toolCallId,
  names,
  running,
  onOpen,
}: {
  machine: Machine;
  sessionId: string;
  /** The subagent whose transcript holds the call; null for the session's own. */
  parent: string | null;
  toolCallId: string;
  names: readonly string[];
  /** The call still runs: its subagents may not have started yet. */
  running: boolean;
  onOpen: (subagent: Subagent) => void;
}): ReactNode {
  const styles = useStyles(createStyles);
  const colors = useColors();
  const [list, setList] = useState<Subagent[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mine = useMemo(() => (list === null ? [] : subagentsOf(list, parent, toolCallId, names)), [list, names, parent, toolCallId]);
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
 * `task` calls open their subagents the same way.
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
  const [info, setInfo] = useState<Subagent | null>(subagent);
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<Step | null>(null);
  const messagesRef = useRef<AgentMessage[]>([]);
  const id = subagent?.id;

  useEffect(() => {
    messagesRef.current = [];
    setMessages([]);
    setInfo(subagent);
    setError(null);
    setStep(null);
    if (id === undefined) return;
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
    <Modal visible={subagent !== null} animationType="slide" statusBarTranslucent onRequestClose={onClose}>
      <View style={[styles.screen, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <Header title={info?.agentId ?? ""} subtitle={subtitle} onBack={onClose} />
        {error !== null ? <Banner text={error} /> : null}
        <View style={styles.listWrap}>
          <TranscriptFolds>
            <FlatList inverted data={rows} keyExtractor={(row) => row.id} renderItem={renderItem} contentContainerStyle={styles.list} initialNumToRender={14} windowSize={11} />
          </TranscriptFolds>
          {rows.length === 0 && error === null ? (
            <View style={styles.empty} pointerEvents="none">
              <Text style={styles.note}>{t("subagents.empty")}</Text>
            </View>
          ) : null}
        </View>
      </View>
      {id !== undefined ? renderStep(openStep, () => setStep(null), id) : null}
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
    screen: { flex: 1, backgroundColor: c.bg },
    listWrap: { flex: 1 },
    list: { paddingTop: 16, paddingBottom: 12 },
    empty: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, alignItems: "center", justifyContent: "center" },
  } as const;
}
