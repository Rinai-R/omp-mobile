import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { createSession, deleteSession, listSessions } from "../api";
import { Button, Field, Sheet, StatusDot, styles as ui } from "../components/ui";
import { radius, type, useColors } from "../theme";
import type { Machine, SessionSummary } from "../types";

interface Props {
  machine: Machine;
  onBack: () => void;
  onOpen: (machine: Machine, session: SessionSummary) => void;
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
  const styles = useStyles(colors);
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

  return (
    <View style={[styles.root, { backgroundColor: colors.bg }]}>
      <View style={styles.header}>
        <Pressable onPress={onBack} hitSlop={12} accessibilityRole="button" accessibilityLabel="Back">
          <Text style={{ color: colors.textSecondary, fontSize: 28, marginTop: -4 }}>‹</Text>
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={[type.heading, { color: colors.text }]}>{machine.name}</Text>
          <Text style={[type.small, { color: colors.textSecondary }]}>{machine.os} · OMP {machine.version}</Text>
        </View>
        <Pressable
          onPress={() => setCreating(true)}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="New session"
        >
          <Text style={{ color: colors.link, fontSize: 28, marginTop: -4 }}>+</Text>
        </Pressable>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.textSecondary} />
        </View>
      ) : (
        <FlatList
          data={sessions}
          keyExtractor={(session) => session.id}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} tintColor={colors.textSecondary} />}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={[type.heading, { color: colors.text }]}>No sessions yet</Text>
              <Text style={[type.body, { color: colors.textSecondary, textAlign: "center", marginTop: 8 }]}>
                Start one in {machine.cwd.split("/").filter(Boolean).at(-1) ?? "the default directory"}.
              </Text>
              <View style={{ height: 18 }} />
              <Button label="New session" onPress={() => setCreating(true)} />
            </View>
          }
          renderItem={({ item }) => (
            <Pressable
              onPress={() => onOpen(machine, item)}
              onLongPress={() => confirmDelete(item)}
              style={({ pressed }) => [
                styles.card,
                { backgroundColor: pressed ? colors.pressed : colors.surface, borderColor: colors.border },
              ]}
            >
              <StatusDot color={item.status === "streaming" ? colors.warn : colors.success} size={7} />
              <View style={{ flex: 1, gap: 4 }}>
                <Text style={[type.heading, { color: colors.text }]} numberOfLines={1}>
                  {item.title}
                </Text>
                <Text style={[type.small, { color: colors.textSecondary }]} numberOfLines={1}>
                  {item.cwd} · {item.model ?? "default model"}
                </Text>
              </View>
              <View style={{ alignItems: "flex-end", gap: 4 }}>
                <Text style={[type.tiny, { color: colors.textTertiary }]}>{item.status === "streaming" ? "running" : ago(item.updatedAt)}</Text>
                <Text style={{ color: colors.textTertiary, fontSize: 20 }}>›</Text>
              </View>
            </Pressable>
          )}
          ListHeaderComponent={error !== null ? <Text style={[type.small, { color: colors.danger, marginBottom: 10 }]}>{error}</Text> : null}
        />
      )}

      <Sheet visible={creating} title="New session" onClose={() => setCreating(false)}>
        <Text style={[type.small, { color: colors.textSecondary }]}>
          The session starts a new OMP process on the computer. Leave the directory empty for {machine.cwd}.
        </Text>
        <Field label="Working directory" value={cwd} onChangeText={setCwd} placeholder={machine.cwd} autoFocus />
        {error !== null ? <Text style={[type.small, { color: colors.danger }]}>{error}</Text> : null}
        <Button label="Start session" onPress={() => void create()} busy={busy} />
      </Sheet>
    </View>
  );
}

function useStyles(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    root: { flex: 1 },
    header: {
      flexDirection: "row",
      alignItems: "center",
      gap: 14,
      paddingHorizontal: 20,
      paddingTop: 16,
      paddingBottom: 14,
    },
    list: { paddingHorizontal: 16, paddingBottom: 40, flexGrow: 1 },
    card: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      padding: 14,
      borderRadius: radius.lg,
      borderWidth: StyleSheet.hairlineWidth,
      marginBottom: 10,
    },
    center: { flex: 1, alignItems: "center", justifyContent: "center" },
    empty: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 24, paddingTop: 60 },
  });
}
