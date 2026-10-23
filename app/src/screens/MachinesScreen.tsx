import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Alert, RefreshControl, ScrollView, Text, View } from "react-native";
import { pairMachine } from "../api";
import { ComputerGlyph, PlusGlyph, QrGlyph, SettingsGlyph } from "../components/icons";
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
import { isPairingLink, normalizeUrl, pairingMessage, readPairing } from "../pairing";
import { summaryOf, type Probe } from "../probe";
import { MONO, useColors, useStyles, type Palette } from "../theme";
import type { Machine } from "../types";

/** A request to open the Add machine sheet, optionally pre-filled from a pairing link. */
export interface AddRequest {
  /** Distinguishes two requests for the same link. */
  nonce: number;
  /** An `omp-mobile://pair?...` link to pre-fill from; null opens the sheet empty. */
  link: string | null;
}

interface Props {
  machines: Machine[];
  /** The latest probe of each machine by id; missing until its first probe finished. */
  probes: ReadonlyMap<string, Probe>;
  onAdd: (machine: Machine) => void;
  /** Open the QR scanner. */
  onScan: () => void;
  /** Open the Add machine sheet; cleared with `onAddRequestHandled` once it is open. */
  addRequest: AddRequest | null;
  onAddRequestHandled: () => void;
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
  onScan,
  addRequest,
  onAddRequestHandled,
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
  /** The sheet was filled from a pairing link: one tap on Connect adds it. */
  const [fromLink, setFromLink] = useState(false);
  /** The machine whose sheet is open. */
  const [sheet, setSheet] = useState<Machine | null>(null);
  const closeSheet = useCallback(() => setSheet(null), []);

  const close = useCallback(() => {
    setAdding(false);
    setError(null);
    setBusy(false);
    // A link's token is not left behind in a sheet the user dismissed.
    if (fromLink) {
      setUrl("");
      setToken("");
      setFromLink(false);
    }
  }, [fromLink]);

  // A pairing link or the scanner's "Enter address" opens the sheet.
  useEffect(() => {
    if (addRequest === null) return;
    onAddRequestHandled();
    setBusy(false);
    setAdding(true);
    if (addRequest.link === null) {
      setError(null);
      return;
    }
    const pairing = readPairing(addRequest.link);
    if (pairing.ok) {
      setUrl(pairing.url);
      setToken(pairing.token);
      setFromLink(true);
      setError(null);
    } else {
      setUrl(addRequest.link);
      setToken("");
      setFromLink(false);
      setError(pairingMessage(pairing.problem, pairing.host));
    }
  }, [addRequest, onAddRequestHandled]);

  const connect = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      let base: string;
      let secret: string;
      if (isPairingLink(url)) {
        const pairing = readPairing(url);
        if (!pairing.ok) throw new Error(pairingMessage(pairing.problem, pairing.host));
        base = pairing.url;
        secret = pairing.token;
      } else {
        base = normalizeUrl(url);
        secret = token;
      }
      onAdd(await pairMachine(base, secret, machines));
      setUrl("");
      setToken("");
      setFromLink(false);
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
        title="machines"
        right={
          <>
            {machines.length > 0 ? (
              <IconButton onPress={onScan} label="Add machine">
                <PlusGlyph size={20} color={colors.fgMuted} />
              </IconButton>
            ) : null}
            <IconButton onPress={onSettings} label="Settings">
              <SettingsGlyph size={20} color={colors.fgMuted} />
            </IconButton>
          </>
        }
      />

      <ScrollView
        contentContainerStyle={machines.length === 0 ? styles.emptyContent : styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.fgMuted} colors={[colors.accent]} progressBackgroundColor={colors.overlay} />
        }
      >
        {machines.length === 0 ? (
          <EmptyState
            icon={<ComputerGlyph size={26} color={colors.fg} />}
            title="Connect your first computer"
            body="Start the omp-mobile daemon on the computer, then scan the QR code it prints. Every OMP you connect, in your pocket."
            action={
              <View style={styles.emptyActions}>
                <Button label="Scan to pair" onPress={onScan} icon={<QrGlyph size={18} color={colors.accentFg} />} />
                <Button label="Enter address" kind="plain" onPress={openAdd} />
              </View>
            }
          />
        ) : (
          <>
            <SectionHeader title="Computers" meta={onlineMeta(machines, probes)} />
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
                    leading={<ComputerGlyph size={18} color={summary.dot === "down" ? colors.fgFaint : colors.fgMuted} />}
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
          {fromLink
            ? "Opened from a pairing link. Check the address, then tap Connect."
            : "The daemon prints its address, token and pairing URI when it starts. Use the Tailscale IP, not localhost."}
        </Text>
        <Field
          label="Address or pairing link"
          value={url}
          onChangeText={setUrl}
          placeholder="100.64.0.1:7390 or omp-mobile://pair?..."
          autoFocus={!fromLink}
        />
        <Field label="Token" value={token} onChangeText={setToken} placeholder="daemon token" secure />
        {error !== null ? <Text style={styles.error}>{error}</Text> : null}
        <Button
          label="Connect"
          onPress={() => void connect()}
          busy={busy}
          disabled={url.trim() === "" || (token.trim() === "" && !isPairingLink(url))}
        />
      </Sheet>
    </View>
  );
}

/** "2/3 online" once any probe has answered; nothing before. */
function onlineMeta(machines: Machine[], probes: ReadonlyMap<string, Probe>): string | undefined {
  if (probes.size === 0) return undefined;
  const online = machines.filter((machine) => probes.get(machine.id)?.state === "online").length;
  return `${online}/${machines.length} online`;
}

function createStyles(c: Palette) {
  return {
    root: { flex: 1, backgroundColor: c.bg },
    content: { width: "100%", maxWidth: 600, alignSelf: "center", paddingHorizontal: 12, paddingBottom: 32 },
    emptyContent: { flexGrow: 1 },
    emptyActions: { gap: 10 },
    detail: { flexShrink: 1, fontFamily: MONO, fontSize: 11.5, lineHeight: 16, color: c.fgMuted },
    state: { flexDirection: "row", alignItems: "center", gap: 5 },
    footnote: { fontSize: 12, lineHeight: 17, paddingTop: 10, paddingHorizontal: 4, color: c.fgFaint },
    hint: { fontSize: 13, lineHeight: 19, color: c.fgMuted, marginHorizontal: 2 },
    error: { fontFamily: MONO, fontSize: 12, lineHeight: 17, color: c.err, marginHorizontal: 2 },
  } as const;
}
