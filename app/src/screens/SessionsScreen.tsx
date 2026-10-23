import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Alert, RefreshControl, ScrollView, Text, View } from "react-native";
import { createSession, deleteSession, listSessions, openSession } from "../api";
import { GradientDot, Spinner } from "../components/brand";
import { ChatGlyph, PlusGlyph } from "../components/icons";
import { MachineSwitcher } from "../components/MachineSwitcher";
import {
  Banner,
  Button,
  EmptyState,
  Field,
  Group,
  Header,
  IconButton,
  Row,
  SectionHeader,
  Sheet,
} from "../components/ui";
import { reasonText, type Probe } from "../probe";
import { MONO, useColors, useStyles, type Palette } from "../theme";
import { dropTranscript, loadSessionList, saveSessionList } from "../transcripts";
import type { Machine, SessionSummary } from "../types";

interface Props {
  machine: Machine;
  /** The machine's last probe from the machines screen, if any. */
  probe: Probe | undefined;
  /** Probe the machine again (Retry on the unreachable banner). */
  onRetry: (machine: Machine) => void;
  onBack: () => void;
  onOpen: (machine: Machine, session: SessionSummary) => void;
  /** Every paired machine and their last probes, for the switcher in the title. */
  machines: readonly Machine[];
  probes: ReadonlyMap<string, Probe>;
  onProbeAll: () => void;
  onSwitch: (machine: Machine) => void;
}

function basename(path: string): string {
  return path.split("/").filter(Boolean).at(-1) ?? path;
}

function ago(timestamp: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 60) return "just now";
  if (seconds < 3_600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3_600)}h ago`;
  return `${Math.floor(seconds / 86_400)}d ago`;
}

export function SessionsScreen({
  machine,
  probe,
  onRetry,
  onBack,
  onOpen,
  machines,
  probes,
  onProbeAll,
  onSwitch,
}: Props): ReactNode {
  const colors = useColors();
  const styles = useStyles(createStyles);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [cwd, setCwd] = useState(machine.cwd);
  const [busy, setBusy] = useState(false);
  const [switching, setSwitching] = useState(false);
  /** The session list loaded here, so a stale unreachable probe no longer applies. */
  const [reached, setReached] = useState(false);
  /** The daemon has answered this screen's list; a saved list arriving later must not replace it. */
  const fetched = useRef(false);

  const load = useCallback(async (fresh: boolean) => {
    if (fresh) setRefreshing(true);
    setError(null);
    try {
      const list = await listSessions(machine);
      fetched.current = true;
      setSessions(list);
      saveSessionList(machine.id, list);
      setReached(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [machine]);

  useEffect(() => {
    // The last list this phone saw shows while the daemon answers, or when it cannot.
    void loadSessionList(machine.id).then((saved) => {
      if (fetched.current || saved === undefined) return;
      setSessions(saved);
      setLoading(false);
    });
    void load(false);
  }, [load, machine.id]);

  const create = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const session = await createSession(machine, cwd);
      setCreating(false);
      setSessions((current) => [session, ...current.filter((item) => item.id !== session.id)]);
      onOpen(machine, session);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }, [cwd, machine, onOpen]);

  const confirmDelete = useCallback(
    (session: SessionSummary) => {
      Alert.alert(`Delete ${session.title}?`, "This stops the OMP process for this session.", [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            void deleteSession(machine, session.id)
              .then(() => {
                dropTranscript(machine.id, session.id);
                setSessions((current) => current.filter((item) => item.id !== session.id));
              })
              .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)));
          },
        },
      ]);
    },
    [machine],
  );

  /** The terminal session being resumed on the computer before its chat opens. */
  const [opening, setOpening] = useState<string | null>(null);
  const open = useCallback(
    (session: SessionSummary) => {
      if (session.openElsewhere === true) {
        Alert.alert(
          "Open in a terminal",
          "Another omp process on the computer has this session open. Exit it there (or /exit) to continue it here.",
        );
        return;
      }
      if (session.origin === "daemon") {
        onOpen(machine, session);
        return;
      }
      // Resume first: a refusal (it was opened in a terminal since the list loaded) shows here, not as a dead chat.
      setOpening(session.id);
      setError(null);
      void openSession(machine, session.id)
        .then(() => onOpen(machine, { ...session, origin: "daemon" }))
        .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)))
        .finally(() => setOpening(null));
    },
    [machine, onOpen],
  );

  const openCreate = useCallback(() => setCreating(true), []);
  const retry = useCallback(() => {
    onRetry(machine);
    void load(true);
  }, [load, machine, onRetry]);
  const unreachable =
    probe?.state === "unreachable" && !reached ? `Unreachable: ${reasonText(probe.reason)}` : null;
  const running = sessions.filter((session) => session.status === "streaming").length;
  const mine = sessions.filter((session) => session.origin !== "omp");
  const terminal = sessions.filter((session) => session.origin === "omp");

  const rows = (list: SessionSummary[]) =>
    list.map((session, index) => {
      const live = session.status === "streaming";
      const state = live ? "running" : session.openElsewhere === true ? "in a terminal" : ago(session.updatedAt);
      return (
        <Row
          key={session.id}
          title={session.title}
          detail={
            <Text style={styles.detail} numberOfLines={1}>
              {basename(session.cwd)}
              {session.model !== undefined ? ` · ${session.model}` : ""}
            </Text>
          }
          trailing={
            <View style={styles.trailing}>
              {opening === session.id ? <Spinner size={10} /> : live ? <GradientDot size={7} /> : null}
              <Text
                style={live ? styles.timeLive : session.openElsewhere === true ? styles.timeElsewhere : styles.time}
                numberOfLines={1}
              >
                {state}
              </Text>
            </View>
          }
          last={index === list.length - 1}
          onPress={() => open(session)}
          onLongPress={session.origin === "daemon" ? () => confirmDelete(session) : undefined}
          accessibilityLabel={`${session.title}, ${state}`}
        />
      );
    });

  return (
    <View style={styles.root}>
      <Header
        title={machine.name}
        subtitle={`${machine.os} · OMP ${machine.version}`}
        onBack={onBack}
        onTitlePress={machines.length > 1 ? () => setSwitching(true) : undefined}
        titleLabel={`${machine.name}, switch machine`}
        right={
          <IconButton onPress={openCreate} label="New session">
            <PlusGlyph size={20} color={colors.fgMuted} />
          </IconButton>
        }
      />
      {unreachable !== null ? (
        <Banner text={unreachable} action={{ label: "Retry", onPress: retry }} />
      ) : error !== null && !creating ? (
        <Banner text={error} onPress={() => setError(null)} />
      ) : null}

      {loading ? (
        <View style={styles.center}>
          <Spinner size={14} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={sessions.length === 0 ? styles.emptyContent : styles.content}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} tintColor={colors.fgMuted} colors={[colors.accent]} progressBackgroundColor={colors.overlay} />
          }
        >
          {sessions.length === 0 ? (
            <EmptyState
              icon={<ChatGlyph size={24} color={colors.fg} />}
              title="No sessions yet"
              body={`Start one in ${basename(machine.cwd) || "the default directory"}.`}
              action={
                <Button
                  label="New session"
                  onPress={openCreate}
                  icon={<PlusGlyph size={18} color={colors.accentFg} />}
                />
              }
            />
          ) : (
            <>
              {mine.length > 0 ? (
                <>
                  <SectionHeader title="Sessions" meta={running > 0 ? `${running} running` : String(mine.length)} />
                  <Group>{rows(mine)}</Group>
                  <Text style={styles.footnote}>Long-press a session to delete it.</Text>
                </>
              ) : null}
              {terminal.length > 0 ? (
                <>
                  <SectionHeader title="From the terminal" meta={String(terminal.length)} />
                  <Group>{rows(terminal)}</Group>
                  <Text style={styles.footnote}>
                    OMP sessions started on the computer. Opening one continues it here; one still open in a terminal
                    stays there until it exits.
                  </Text>
                </>
              ) : null}
            </>
          )}
        </ScrollView>
      )}

      <Sheet visible={creating} title="New session" onClose={() => setCreating(false)}>
        <Text style={styles.hint}>
          The session starts a new OMP process on the computer. Leave the directory empty for {machine.cwd}.
        </Text>
        <Field label="Working directory" value={cwd} onChangeText={setCwd} placeholder={machine.cwd} autoFocus />
        {error !== null ? <Text style={styles.error}>{error}</Text> : null}
        <Button label="Start session" onPress={() => void create()} busy={busy} />
      </Sheet>

      <MachineSwitcher
        visible={switching}
        machines={machines}
        current={machine}
        probes={probes}
        onProbe={onProbeAll}
        onPick={onSwitch}
        onClose={() => setSwitching(false)}
      />
    </View>
  );
}

function createStyles(c: Palette) {
  const time = { fontFamily: MONO, fontSize: 11, lineHeight: 15, color: c.fgFaint } as const;
  return {
    root: { flex: 1, backgroundColor: c.bg },
    center: { flex: 1, alignItems: "center", justifyContent: "center" },
    content: { width: "100%", maxWidth: 600, alignSelf: "center", paddingHorizontal: 12, paddingBottom: 32 },
    emptyContent: { flexGrow: 1 },
    detail: { fontFamily: MONO, fontSize: 11.5, lineHeight: 16, color: c.fgMuted },
    trailing: { flexDirection: "row", alignItems: "center", gap: 6, flexShrink: 0 },
    time,
    timeLive: { ...time, color: c.accent },
    timeElsewhere: { ...time, color: c.warn },
    footnote: { fontSize: 12, lineHeight: 17, paddingTop: 10, paddingHorizontal: 4, color: c.fgFaint },
    hint: { fontSize: 13, lineHeight: 19, color: c.fgMuted, marginHorizontal: 2 },
    error: { fontFamily: MONO, fontSize: 12, lineHeight: 17, color: c.err, marginHorizontal: 2 },
  } as const;
}
