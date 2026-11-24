import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { RefreshControl, Text, View } from "react-native";
import Reanimated, { type SharedValue } from "react-native-reanimated";
import { pairMachine } from "../api";
import { ComputerGlyph, MoreGlyph, PlusGlyph, QrGlyph, SettingsGlyph } from "../components/icons";
import { LargeTitle, PageBar, usePageScroll, usePageTop } from "../components/LargeTitle";
import { TAB_BAR_HEIGHT } from "../components/TabBar";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MachineSheet } from "../components/MachineSheet";
import {
  Button,
  ConfirmSheet,
  EmptyState,
  Field,
  Group,
  IconButton,
  Row,
  Sheet,
  StateDot,
} from "../components/ui";
import { isPairingLink, normalizeUrl, pairingMessage, readPairing } from "../pairing";
import { PairSuccess } from "../components/PairSuccess";
import { RelayPairingCard, useRelayPairing } from "../components/RelayPairing";
import { parsePairingTicket } from "../relay/pairing";
import { loginRelay } from "../relay/pair";
import { summaryOf, type Probe } from "../probe";
import { MONO, useColors, useStyles, type Palette } from "../theme";
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
  /** Shown as a tab under the tab bar; false while no computer is paired (this is the first screen then, settings behind a button). */
  tabbed: boolean;
  /** Where this page reports how much of it runs on under the tab bar; only as a tab. */
  under?: SharedValue<number>;
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
  tabbed,
  under,
}: Props): ReactNode {
  const colors = useColors();
  const styles = useStyles(createStyles);
  const insets = useSafeAreaInsets();
  const page = usePageScroll(under);
  const top = usePageTop();
  const [adding, setAdding] = useState(false);
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** The sheet was filled from a pairing link: one tap on Connect adds it. */
  const [fromLink, setFromLink] = useState(false);
  /** Account login for a self-hosted relay: fields shown, credentials typed. */
  const [relayLogin, setRelayLogin] = useState(false);
  const [account, setAccount] = useState("");
  const [password, setPassword] = useState("");
  /** The machine whose sheet is open. */
  const [sheet, setSheet] = useState<Machine | null>(null);
  const closeSheet = useCallback(() => setSheet(null), []);
  /** The machine whose removal is being confirmed. */
  const [removing, setRemoving] = useState<Machine | null>(null);
  /**
   * A computer just paired: the sheet celebrates it, then closes and hands it to
   * `onAdd` once. It stays shown while the sheet slides away and is cleared on the next open.
   */
  const [paired, setPaired] = useState<Machine | null>(null);
  const pending = useRef<Machine | null>(null);
  const celebrate = useCallback((machine: Machine) => {
    pending.current = machine;
    setPaired(machine);
  }, []);
  const handOn = useCallback(() => {
    const machine = pending.current;
    if (machine === null) return;
    pending.current = null;
    setAdding(false);
    onAdd(machine);
  }, [onAdd]);
  /** A relay pairing code pasted into the address: paired here, then the sheet closes. */
  const relay = useRelayPairing(
    machines,
    useCallback(
      (machine: Machine) => {
        setUrl("");
        celebrate(machine);
      },
      [celebrate],
    ),
  );
  const ticket = parsePairingTicket(url.trim());

  const close = useCallback(() => {
    // Dismissed mid-celebration: the pairing still counts.
    if (pending.current !== null) return handOn();
    relay.cancel();
    setAdding(false);
    setError(null);
    setBusy(false);
    setRelayLogin(false);
    setAccount("");
    setPassword("");
    // A link's token is not left behind in a sheet the user dismissed.
    if (fromLink) {
      setUrl("");
      setToken("");
      setFromLink(false);
    }
  }, [fromLink, handOn, relay.cancel]);

  // A pairing link or the scanner's "Enter address" opens the sheet.
  useEffect(() => {
    if (addRequest === null) return;
    onAddRequestHandled();
    setBusy(false);
    setPaired(null);
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
    if (ticket !== undefined) {
      setError(null);
      relay.start(ticket);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (relayLogin) {
        const base = normalizeUrl(url);
        celebrate(await loginRelay(base, account, password, machines));
        setUrl("");
        setAccount("");
        setPassword("");
        setRelayLogin(false);
        return;
      }
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
      celebrate(await pairMachine(base, secret, machines));
      setUrl("");
      setToken("");
      setFromLink(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }, [account, celebrate, machines, password, relay.start, relayLogin, ticket, token, url]);

  const confirmRemove = useCallback((machine: Machine) => setRemoving(machine), []);

  const openAdd = useCallback(() => {
    setPaired(null);
    setAdding(true);
  }, []);
  // "seen 5 min ago" is recomputed on each render; each probe round re-renders the list.
  const now = Date.now();

  return (
    <View style={styles.root}>
      <Reanimated.ScrollView
        {...page.props}
        contentContainerStyle={[
          machines.length === 0 ? styles.emptyContent : styles.content,
          { paddingTop: top, paddingBottom: (tabbed ? TAB_BAR_HEIGHT : 0) + 24 + insets.bottom },
        ]}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.fgMuted}
            colors={[colors.accent]}
            progressBackgroundColor={colors.overlay}
            progressViewOffset={top}
          />
        }
      >
        <View style={machines.length === 0 ? undefined : styles.bleed}>
          <LargeTitle y={page.y} title={t("machines.title")} />
        </View>
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
            <Group>
              {machines.map((machine, index) => {
                const probe = probes.get(machine.id);
                const summary = summaryOf(probe, machine.lastSeen, now, machine);
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
                    leading={<ComputerGlyph size={17} color={summary.dot === "down" ? colors.fgFaint : colors.tileFg} />}
                    trailing={
                      <IconButton onPress={() => setSheet(machine)} label={t("machines.details", { name: machineLabel(machine, machines) })}>
                        <MoreGlyph size={18} color={colors.fgFaint} />
                      </IconButton>
                    }
                    chevron={false}
                    last={index === machines.length - 1}
                    onPress={() => onOpen(machine)}
                    onLongPress={() => setSheet(machine)}
                    accessibilityLabel={t("common.pair", { label: displayName(machine), value: summary.text })}
                  />
                );
              })}
            </Group>
          </>
        )}
      </Reanimated.ScrollView>
      <PageBar
        y={page.y}
        title={t("machines.title")}
        right={
          <>
            {machines.length > 0 ? (
              <IconButton onPress={onScan} label={t("machines.add")}>
                <PlusGlyph size={24} color={colors.tint} />
              </IconButton>
            ) : null}
            {tabbed ? null : (
              <IconButton onPress={onSettings} label={t("common.settings")}>
                <SettingsGlyph size={22} color={colors.tint} />
              </IconButton>
            )}
          </>
        }
      />

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

      <ConfirmSheet
        visible={removing !== null}
        title={removing === null ? "" : t("machines.remove.title", { name: machineLabel(removing, machines) })}
        body={t("machines.remove.body")}
        action={t("common.remove")}
        danger
        onConfirm={() => {
          if (removing !== null) onRemove(removing);
        }}
        onClose={() => setRemoving(null)}
      />

      <Sheet visible={adding} title={t("machines.addSheet.title")} onClose={close}>
        {paired !== null ? (
          <PairSuccess name={displayName(paired)} c={colors} onDone={handOn} />
        ) : relay.busy ? (
          <RelayPairingCard code={relay.code} c={colors} onCancel={relay.cancel} />
        ) : (
          <>
            <Field
              label={t("machines.addSheet.address")}
              value={url}
              onChangeText={setUrl}
              placeholder={t("machines.addSheet.addressPlaceholder")}
              autoFocus={!fromLink}
            />
            {ticket === undefined && !relayLogin ? (
              <Button label={t("machines.addSheet.relayLogin")} kind="plain" onPress={() => setRelayLogin(true)} />
            ) : null}
            {relayLogin ? (
              <>
                <Field label={t("machines.addSheet.account")} value={account} onChangeText={setAccount} keyboardType="email-address" />
                <Field label={t("machines.addSheet.password")} value={password} onChangeText={setPassword} secure />
              </>
            ) : ticket === undefined ? (
              <Field label={t("machines.addSheet.token")} value={token} onChangeText={setToken} secure />
            ) : null}
            {(relay.error ?? error) !== null ? <Text style={styles.error}>{relay.error ?? error}</Text> : null}
            <Button
              label={t("machines.addSheet.connect")}
              onPress={() => void connect()}
              busy={busy}
              disabled={
                url.trim() === "" ||
                (relayLogin && (account.trim() === "" || password === "")) ||
                (!relayLogin && token.trim() === "" && !isPairingLink(url) && ticket === undefined)
              }
            />
          </>
        )}
      </Sheet>
    </View>
  );
}

function createStyles(c: Palette) {
  return {
    root: { flex: 1, backgroundColor: c.bg },
    content: { width: "100%", maxWidth: 600, alignSelf: "center", paddingHorizontal: 16 },
    // The large title keeps the home's 20 px inset inside this 16 px-padded list.
    bleed: { marginHorizontal: -16 },
    emptyContent: { flexGrow: 1 },
    emptyActions: { gap: 10 },
    detail: { flexShrink: 1, fontFamily: MONO, fontSize: 11.5, lineHeight: 16, color: c.fgMuted },
    state: { flexDirection: "row", alignItems: "center", gap: 5 },
    error: { fontFamily: MONO, fontSize: 12, lineHeight: 17, color: c.err, marginHorizontal: 2 },
  } as const;
}
