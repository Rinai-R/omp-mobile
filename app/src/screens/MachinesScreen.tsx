import { useCallback, useState, type ReactNode } from "react";
import { Alert, RefreshControl, ScrollView, Text, View } from "react-native";
import { hello, normalizeUrl, parsePairing } from "../api";
import { ComputerGlyph, PlusGlyph, SettingsGlyph } from "../components/icons";
import { MachineSheet } from "../components/MachineSheet";
import {
  Button,
  EmptyState,
  Field,
  Group,
  Header,
  IconButton,
  Row,
  SectionHeader,
  Sheet,
  StateDot,
} from "../components/ui";
import { summaryOf, type Probe } from "../probe";
import { useColors, useStyles, type Palette } from "../theme";
import type { Machine } from "../types";

interface Props {
  machines: Machine[];
  /** The latest probe of each machine by id; missing until its first probe finished. */
  probes: ReadonlyMap<string, Probe>;
  onAdd: (machine: Machine) => void;
  onOpen: (machine: Machine) => void;
  onRemove: (machine: Machine) => void;
  onSettings: () => void;
  refreshing: boolean;
  onRefresh: () => void;
}

export function MachinesScreen({
  machines,
  probes,
  onAdd,
  onOpen,
  onRemove,
  onSettings,
  refreshing,
  onRefresh,
}: Props): ReactNode {
  const colors = useColors();
  const styles = useStyles(createStyles);
  const [adding, setAdding] = useState(false);
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** The machine whose sheet is open. */
  const [sheet, setSheet] = useState<Machine | null>(null);
  const closeSheet = useCallback(() => setSheet(null), []);

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
        lastSeen: Date.now(),
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
      Alert.alert(`Remove ${machine.name} from this phone?`, "The daemon and its running sessions stay on the computer.", [
        { text: "Cancel", style: "cancel" },
        { text: "Remove", style: "destructive", onPress: () => onRemove(machine) },
      ]);
    },
    [onRemove],
  );

  const openAdd = useCallback(() => setAdding(true), []);
  // "seen 5 min ago" is recomputed on each render; each probe round re-renders the list.
  const now = Date.now();

  return (
    <View style={styles.root}>
      <Header
        large
        title="Machines"
        subtitle="Every OMP you connect, in your pocket"
        right={
          <>
            {machines.length > 0 ? (
              <IconButton onPress={openAdd} label="Add machine">
                <PlusGlyph color={colors.text} />
              </IconButton>
            ) : null}
            <IconButton onPress={onSettings} label="Settings">
              <SettingsGlyph color={colors.text} />
            </IconButton>
          </>
        }
      />

      <ScrollView
        contentContainerStyle={machines.length === 0 ? styles.emptyContent : styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.textSecondary} />
        }
      >
        {machines.length === 0 ? (
          <EmptyState
            icon={<ComputerGlyph size={28} color={colors.textSecondary} />}
            title="Connect your first computer"
            body="Start the omp-mobile daemon on the computer, then add its Tailscale address and token here."
            action={<Button label="Add machine" onPress={openAdd} icon={<PlusGlyph size={18} color={colors.onPrimary} />} />}
          />
        ) : (
          <>
            <SectionHeader title="Computers" />
            <Group>
              {machines.map((machine, index) => {
                const probe = probes.get(machine.id);
                const summary = summaryOf(probe, machine.lastSeen, now);
                return (
                  <Row
                    key={machine.id}
                    title={machine.name}
                    dim={summary.dot === "down"}
                    detail={
                      <View style={styles.state}>
                        <StateDot dot={summary.dot} />
                        <Text style={styles.detail} numberOfLines={1}>
                          {summary.text}
                        </Text>
                      </View>
                    }
                    leading={<ComputerGlyph color={colors.textSecondary} />}
                    last={index === machines.length - 1}
                    onPress={() => onOpen(machine)}
                    onLongPress={() => setSheet(machine)}
                    accessibilityLabel={`${machine.name}, ${summary.text}`}
                  />
                );
              })}
            </Group>
            <Text style={styles.footnote}>Long-press a computer for its details.</Text>
          </>
        )}
      </ScrollView>

      <MachineSheet
        machine={sheet}
        probe={sheet === null ? undefined : probes.get(sheet.id)}
        onOpen={onOpen}
        onRemove={confirmRemove}
        onClose={closeSheet}
      />

      <Sheet visible={adding} title="Add a machine" onClose={close}>
        <Text style={styles.hint}>
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
        {error !== null ? <Text style={styles.error}>{error}</Text> : null}
        <Button
          label="Connect"
          onPress={() => void connect()}
          busy={busy}
          disabled={url.trim() === "" || (token.trim() === "" && parsePairing(url) === null)}
        />
      </Sheet>
    </View>
  );
}

function createStyles(c: Palette) {
  return {
    root: { flex: 1, backgroundColor: c.bg },
    content: { width: "100%", maxWidth: 600, alignSelf: "center", paddingHorizontal: 16, paddingBottom: 32 },
    emptyContent: { flexGrow: 1 },
    detail: { flexShrink: 1, fontSize: 13, lineHeight: 18, color: c.textSecondary },
    state: { flexDirection: "row", alignItems: "center", gap: 4 },
    footnote: { fontSize: 13, lineHeight: 18, paddingTop: 8, paddingHorizontal: 4, color: c.textTertiary },
    hint: { fontSize: 13, lineHeight: 18, color: c.textSecondary, marginHorizontal: 4 },
    error: { fontSize: 13, lineHeight: 18, color: c.danger, marginHorizontal: 4 },
  } as const;
}
