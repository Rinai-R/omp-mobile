import { useCallback, useState, type ReactNode } from "react";
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
import { hello, normalizeUrl, parsePairing } from "../api";
import { Button, Field, Sheet, StatusDot, styles as ui } from "../components/ui";
import { radius, type, useColors } from "../theme";
import type { Machine } from "../types";

interface Props {
  machines: Machine[];
  onAdd: (machine: Machine) => void;
  onOpen: (machine: Machine) => void;
  onRemove: (machine: Machine) => void;
  onSettings: () => void;
  refreshing: boolean;
  onRefresh: () => void;
}

export function MachinesScreen({
  machines,
  onAdd,
  onOpen,
  onRemove,
  onSettings,
  refreshing,
  onRefresh,
}: Props): ReactNode {
  const colors = useColors();
  const styles = useStyles(colors);
  const [adding, setAdding] = useState(false);
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const close = useCallback(() => {
    setAdding(false);
    setError(null);
    setBusy(false);
  }, []);

  const connect = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const paired = parsePairing(url);
      const base = normalizeUrl(paired?.url ?? url);
      const secret = (paired?.token ?? token).trim();
      if (machines.some((machine) => machine.url === base)) throw new Error("This machine is already in the list");
      const info = await hello(base, secret);
      onAdd({
        id: base,
        url: base,
        token: secret,
        name: info.name,
        os: info.os,
        version: info.version,
        cwd: info.cwd,
      });
      setUrl("");
      setToken("");
      setAdding(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }, [machines, onAdd, token, url]);

  const confirmRemove = useCallback(
    (machine: Machine) => {
      Alert.alert(`Remove ${machine.name}?`, "The daemon and its running sessions stay on the computer.", [
        { text: "Cancel", style: "cancel" },
        { text: "Remove", style: "destructive", onPress: () => onRemove(machine) },
      ]);
    },
    [onRemove],
  );

  return (
    <View style={[styles.root, { backgroundColor: colors.bg }]}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={[type.title, { color: colors.text }]}>Machines</Text>
          <Text style={[type.small, { color: colors.textSecondary, marginTop: 3 }]}>
            Every OMP you connect, in your pocket
          </Text>
        </View>
        <Pressable
          onPress={onSettings}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Settings"
          style={styles.iconButton}
        >
          <Text style={{ color: colors.textSecondary, fontSize: 22 }}>⚙</Text>
        </Pressable>
      </View>

      <FlatList
        data={machines}
        keyExtractor={(machine) => machine.id}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.textSecondary} />}
        ListEmptyComponent={
          <View style={styles.empty}>
            <View style={[styles.emptyMark, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Text style={{ color: colors.textSecondary, fontSize: 28 }}>⌁</Text>
            </View>
            <Text style={[type.heading, { color: colors.text, marginTop: 18 }]}>Connect your first computer</Text>
            <Text style={[type.body, { color: colors.textSecondary, textAlign: "center", marginTop: 8 }]}>
              Start the omp-mobile daemon on the computer, then add its Tailscale address and token here.
            </Text>
            <View style={{ height: 20 }} />
            <Button label="Add machine" onPress={() => setAdding(true)} />
          </View>
        }
        renderItem={({ item }) => (
          <Pressable
            onPress={() => onOpen(item)}
            onLongPress={() => confirmRemove(item)}
            style={({ pressed }) => [
              styles.card,
              {
                backgroundColor: pressed ? colors.pressed : colors.surface,
                borderColor: colors.border,
              },
            ]}
          >
            <View style={[styles.avatar, { backgroundColor: colors.raised }]}>
              <Text style={[type.heading, { color: colors.text }]}>{item.name.slice(0, 1).toUpperCase()}</Text>
            </View>
            <View style={{ flex: 1, gap: 3 }}>
              <Text style={[type.heading, { color: colors.text }]} numberOfLines={1}>
                {item.name}
              </Text>
              <Text style={[type.small, { color: colors.textSecondary }]} numberOfLines={1}>
                {item.os} · OMP {item.version}
              </Text>
              <Text style={[type.tiny, { color: colors.textTertiary }]} numberOfLines={1}>
                {item.url.replace(/^https?:\/\//, "")}
              </Text>
            </View>
            <View style={styles.cardRight}>
              <StatusDot color={colors.success} />
              <Text style={{ color: colors.textTertiary, fontSize: 20 }}>›</Text>
            </View>
          </Pressable>
        )}
        ListFooterComponent={
          machines.length > 0 ? (
            <View style={{ paddingTop: 14 }}>
              <Button label="Add machine" onPress={() => setAdding(true)} kind="plain" />
            </View>
          ) : null
        }
      />

      <Sheet visible={adding} title="Add a machine" onClose={close}>
        <Text style={[type.small, { color: colors.textSecondary }]}>
          The daemon prints its address, token and pairing URI when it starts. Use the Tailscale IP, not localhost.
        </Text>
        <Field
          label="Address or pairing link"
          value={url}
          onChangeText={setUrl}
          placeholder="100.64.0.1:7390 or omp-mobile://pair?..."
          autoFocus
        />
        <Field label="Token" value={token} onChangeText={setToken} placeholder="daemon token" secure />
        {error !== null ? <Text style={[type.small, { color: colors.danger }]}>{error}</Text> : null}
        <Button label="Connect" onPress={() => void connect()} busy={busy} disabled={url.trim() === "" || (token.trim() === "" && parsePairing(url) === null)} />
      </Sheet>
    </View>
  );
}

function useStyles(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    root: { flex: 1 },
    header: { flexDirection: "row", alignItems: "flex-start", paddingHorizontal: 20, paddingTop: 18, paddingBottom: 14 },
    iconButton: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
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
    avatar: { width: 42, height: 42, borderRadius: radius.md, alignItems: "center", justifyContent: "center" },
    cardRight: { flexDirection: "row", alignItems: "center", gap: 8 },
    empty: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 22, paddingTop: 80 },
    emptyMark: {
      width: 72,
      height: 72,
      borderRadius: radius.xl,
      borderWidth: StyleSheet.hairlineWidth,
      alignItems: "center",
      justifyContent: "center",
    },
  });
}
