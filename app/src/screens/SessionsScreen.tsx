import { useCallback, useEffect, useState, type ReactNode } from "react";
import { ActivityIndicator, Alert, RefreshControl, ScrollView, Text, View } from "react-native";
import { createSession, deleteSession, listSessions } from "../api";
import { ChatGlyph, PlusGlyph } from "../components/icons";
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
import { useColors, useStyles, type Palette } from "../theme";
import type { Machine, SessionSummary } from "../types";

interface Props {
  machine: Machine;
  onBack: () => void;
  onOpen: (machine: Machine, session: SessionSummary) => void;
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

export function SessionsScreen({ machine, onBack, onOpen }: Props): ReactNode {
  const colors = useColors();
  const styles = useStyles(createStyles);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [cwd, setCwd] = useState(machine.cwd);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (fresh: boolean) => {
    if (fresh) setRefreshing(true);
    setError(null);
    try {
      setSessions(await listSessions(machine));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [machine]);

  useEffect(() => {
    void load(false);
  }, [load]);

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
              .then(() => setSessions((current) => current.filter((item) => item.id !== session.id)))
              .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)));
          },
        },
      ]);
    },
    [machine],
  );

  const openCreate = useCallback(() => setCreating(true), []);
  const running = sessions.filter((session) => session.status === "streaming").length;

  return (
    <View style={styles.root}>
      <Header
        title={machine.name}
        subtitle={`${machine.os} · OMP ${machine.version}`}
        onBack={onBack}
        right={
          <IconButton onPress={openCreate} label="New session">
            <PlusGlyph color={colors.text} />
          </IconButton>
        }
      />
      {error !== null && !creating ? <Banner text={error} onPress={() => setError(null)} /> : null}

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.textSecondary} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={sessions.length === 0 ? styles.emptyContent : styles.content}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} tintColor={colors.textSecondary} />
          }
        >
          {sessions.length === 0 ? (
            <EmptyState
              icon={<ChatGlyph size={26} color={colors.textSecondary} />}
              title="No sessions yet"
              body={`Start one in ${basename(machine.cwd) || "the default directory"}.`}
              action={
                <Button
                  label="New session"
                  onPress={openCreate}
                  icon={<PlusGlyph size={18} color={colors.onPrimary} />}
                />
              }
            />
          ) : (
            <>
              <SectionHeader title={running > 0 ? `Sessions · ${running} running` : "Sessions"} />
              <Group>
                {sessions.map((session, index) => {
                  const live = session.status === "streaming";
                  return (
                    <Row
                      key={session.id}
                      title={session.title}
                      detail={
                        <Text style={styles.detail} numberOfLines={1}>
                          {basename(session.cwd)} · {session.model ?? "default model"}
                        </Text>
                      }
                      trailing={
                        <View style={styles.trailing}>
                          {live ? <View style={styles.liveDot} /> : null}
                          <Text style={live ? styles.timeLive : styles.time} numberOfLines={1}>
                            {live ? "running" : ago(session.updatedAt)}
                          </Text>
                        </View>
                      }
                      last={index === sessions.length - 1}
                      onPress={() => onOpen(machine, session)}
                      onLongPress={() => confirmDelete(session)}
                      accessibilityLabel={`${session.title}, ${live ? "running" : ago(session.updatedAt)}`}
                    />
                  );
                })}
              </Group>
              <Text style={styles.footnote}>Long-press a session to delete it.</Text>
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
    </View>
  );
}

function createStyles(c: Palette) {
  const time = { fontSize: 12, lineHeight: 16, color: c.textTertiary } as const;
  return {
    root: { flex: 1, backgroundColor: c.bg },
    center: { flex: 1, alignItems: "center", justifyContent: "center" },
    content: { width: "100%", maxWidth: 600, alignSelf: "center", paddingHorizontal: 16, paddingBottom: 32 },
    emptyContent: { flexGrow: 1 },
    detail: { fontSize: 13, lineHeight: 18, color: c.textSecondary },
    trailing: { flexDirection: "row", alignItems: "center", gap: 5, flexShrink: 0 },
    liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: c.warn },
    time,
    timeLive: { ...time, color: c.warn, fontWeight: "600" },
    footnote: { fontSize: 13, lineHeight: 18, paddingTop: 8, paddingHorizontal: 4, color: c.textTertiary },
    hint: { fontSize: 13, lineHeight: 18, color: c.textSecondary, marginHorizontal: 4 },
    error: { fontSize: 13, lineHeight: 18, color: c.danger, marginHorizontal: 4 },
  } as const;
}
