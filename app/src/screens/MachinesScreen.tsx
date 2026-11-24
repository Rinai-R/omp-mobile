import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { RefreshControl, Text, View } from "react-native";
import Reanimated, { type SharedValue } from "react-native-reanimated";
import { AddComputerSheet, type AddStart } from "../components/AddComputerSheet";
import { ComputerGlyph, MoreGlyph, PlusGlyph, SettingsGlyph } from "../components/icons";
import { LargeTitle, PageBar, usePageScroll, usePageTop } from "../components/LargeTitle";
import { TAB_BAR_HEIGHT } from "../components/TabBar";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MachineSheet } from "../components/MachineSheet";
import { Button, ConfirmSheet, EmptyState, Group, IconButton, Row, StateDot } from "../components/ui";
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
  /** How the Add computer sheet opened; null while it is closed. */
  const [adding, setAdding] = useState<AddStart | null>(null);
  const lastStart = useRef<AddStart>({ kind: "home" });
  if (adding !== null) lastStart.current = adding;
  const openAdd = useCallback(() => setAdding({ kind: "home" }), []);
  const closeAdd = useCallback(() => setAdding(null), []);

  /** The machine whose sheet is open. */
  const [sheet, setSheet] = useState<Machine | null>(null);
  const closeSheet = useCallback(() => setSheet(null), []);
  /** The machine whose removal is being confirmed. */
  const [removing, setRemoving] = useState<Machine | null>(null);
  // A pairing link opens the direct address filled in; the scanner's "Enter address" opens it empty.
  useEffect(() => {
    if (addRequest === null) return;
    onAddRequestHandled();
    setAdding({ kind: "direct", link: addRequest.link });
  }, [addRequest, onAddRequestHandled]);

  const confirmRemove = useCallback((machine: Machine) => setRemoving(machine), []);

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
                <Button label={t("machines.add")} onPress={openAdd} />
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
                      <View>
                        <View style={styles.state}>
                          <StateDot dot={summary.dot} />
                          <Text style={styles.detail} numberOfLines={1}>{summary.text}</Text>
                        </View>
                        {machine.relay?.account !== undefined ? (
                          <>
                            <Text style={styles.detail} numberOfLines={1}>{machine.relay.serverUrl}</Text>
                            <Text style={styles.detail} numberOfLines={1}>{machine.relay.account}</Text>
                          </>
                        ) : null}
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
                    accessibilityLabel={[
                      t("common.pair", { label: displayName(machine), value: summary.text }),
                      machine.relay?.account === undefined ? undefined : machine.relay.serverUrl,
                      machine.relay?.account,
                    ].filter(Boolean).join(", ")}
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
              <IconButton onPress={openAdd} label={t("machines.add")}>
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

      <AddComputerSheet
        visible={adding !== null}
        start={lastStart.current}
        machines={machines}
        onAdd={onAdd}
        onScan={() => {
          setAdding(null);
          onScan();
        }}
        onClose={closeAdd}
      />
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
  } as const;
}
