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
import { SANS, MONO, useColors, useStyles, type Palette } from "../theme";
import { displayName, machineLabel } from "../machines";
import type { Machine } from "../types";
import { t } from "../i18n/index.ts";

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
  onRename: (machine: Machine, label: string | undefined) => void;
  onSettings: () => void;
  refreshing: boolean;
  onRefresh: () => void;
  /** Back to the home; absent while no computer is paired (this is the first screen then). */
  onBack?: () => void;
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
  onRename,
  onSettings,
  refreshing,
  onRefresh,
  onBack,
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
      Alert.alert(t("machines.remove.title", { name: displayName(machine) }), t("machines.remove.body"), [
        { text: t("common.cancel"), style: "cancel" },
        { text: t("common.remove"), style: "destructive", onPress: () => onRemove(machine) },
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
        large={onBack === undefined}
        title={onBack === undefined ? t("machines.titleLarge") : t("machines.title")}
        onBack={onBack}
        right={
          <>
            {machines.length > 0 ? (
              <IconButton onPress={onScan} label={t("machines.add")}>
                <PlusGlyph size={20} color={colors.fgMuted} />
              </IconButton>
            ) : null}
            <IconButton onPress={onSettings} label={t("common.settings")}>
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
            title={t("machines.empty.title")}
            body={t("machines.empty.body")}
            action={
              <View style={styles.emptyActions}>
                <Button label={t("machines.scan")} onPress={onScan} icon={<QrGlyph size={18} color={colors.accentFg} />} />
                <Button label={t("machines.enterAddress")} kind="plain" onPress={openAdd} />
              </View>
            }
          />
        ) : (
          <>
            <SectionHeader title={t("machines.title")} meta={onlineMeta(machines, probes)} />
            <Group>
              {machines.map((machine, index) => {
                const probe = probes.get(machine.id);
                const summary = summaryOf(probe, machine.lastSeen, now);
                return (
                  <Row
                    key={machine.id}
                    title={machineLabel(machine, machines)}
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
                    accessibilityLabel={t("common.pair", { label: displayName(machine), value: summary.text })}
                  />
                );
              })}
            </Group>
            <Text style={styles.footnote}>{t("machines.footnote")}</Text>
          </>
        )}
      </ScrollView>

      <MachineSheet
        machine={sheet}
        probe={sheet === null ? undefined : probes.get(sheet.id)}
        onOpen={onOpen}
        onRemove={confirmRemove}
        onRename={(machine, label) => {
          onRename(machine, label);
          setSheet((current) => (current === null || current.id !== machine.id ? current : { ...current, label }));
        }}
        onClose={closeSheet}
      />

      <Sheet visible={adding} title={t("machines.addSheet.title")} onClose={close}>
        <Text style={styles.hint}>
          {fromLink
            ? t("machines.addSheet.fromLink")
            : t("machines.addSheet.hint")}
        </Text>
        <Field
          label={t("machines.addSheet.address")}
          value={url}
          onChangeText={setUrl}
          placeholder={t("machines.addSheet.addressPlaceholder")}
          autoFocus={!fromLink}
        />
        <Field
          label={t("machines.addSheet.token")}
          value={token}
          onChangeText={setToken}
          placeholder={t("machines.addSheet.tokenPlaceholder")}
          secure
        />
        {error !== null ? <Text style={styles.error}>{error}</Text> : null}
        <Button
          label={t("machines.addSheet.connect")}
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
  return t("machines.online", { online, total: machines.length });
}

function createStyles(c: Palette) {
  return {
    root: { flex: 1, backgroundColor: c.bg },
    content: { width: "100%", maxWidth: 600, alignSelf: "center", paddingHorizontal: 12, paddingBottom: 32 },
    emptyContent: { flexGrow: 1 },
    emptyActions: { gap: 10 },
    detail: { flexShrink: 1, fontFamily: MONO, fontSize: 11.5, lineHeight: 16, color: c.fgMuted },
    state: { flexDirection: "row", alignItems: "center", gap: 5 },
    footnote: { fontFamily: SANS, fontSize: 12, lineHeight: 17, paddingTop: 10, paddingHorizontal: 4, color: c.fgFaint },
    hint: { fontFamily: SANS, fontSize: 13, lineHeight: 19, color: c.fgMuted, marginHorizontal: 2 },
    error: { fontFamily: MONO, fontSize: 12, lineHeight: 17, color: c.err, marginHorizontal: 2 },
  } as const;
}
