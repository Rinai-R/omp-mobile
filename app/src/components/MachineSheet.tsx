import { useCallback, type ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import { dotOf, linkText, type Probe } from "../probe";
import { MONO, radius, useStyles, type Palette } from "../theme";
import type { Machine } from "../types";
import { Button, Sheet, StateDot } from "./ui";

interface Props {
  /** The machine that was long-pressed; null while the sheet is closed. */
  machine: Machine | null;
  /** What the last probe found for it; undefined until the first one finished. */
  probe: Probe | undefined;
  onOpen: (machine: Machine) => void;
  /** Remove it from the phone (the caller confirms). */
  onRemove: (machine: Machine) => void;
  onClose: () => void;
}

/** One fact about the machine on one line: a label, then its value. */
function InfoRow({ label, value, last = false }: { label: string; value: string; last?: boolean }): ReactNode {
  const styles = useStyles(createStyles);
  return (
    <View style={last ? styles.row : styles.rowDivided} accessible accessibilityLabel={`${label}, ${value}`}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value} numberOfLines={1} selectable>
        {value}
      </Text>
    </View>
  );
}

/**
 * A machine's details and actions: its one link (Tailscale) and its state,
 * where it is, the daemon's version and sessions, then Open and Remove from
 * this phone. Values are mono, labels quiet.
 */
export function MachineSheet({ machine, probe, onOpen, onRemove, onClose }: Props): ReactNode {
  const styles = useStyles(createStyles);
  const open = useCallback(() => {
    onClose();
    if (machine !== null) onOpen(machine);
  }, [machine, onClose, onOpen]);
  const remove = useCallback(() => {
    onClose();
    if (machine !== null) onRemove(machine);
  }, [machine, onClose, onRemove]);

  let body: ReactNode = null;
  if (machine !== null) {
    // The one link is in use exactly when it answers.
    const used = probe?.state === "online";
    const version = probe?.state === "online" ? probe.version : machine.version;
    const sessions =
      probe?.state === "online"
        ? probe.running > 0
          ? `${probe.sessionCount} · ${probe.running} running`
          : String(probe.sessionCount)
        : "—";
    body = (
      <>
        <View style={styles.group}>
          <View style={styles.row} accessible accessibilityLabel={`Tailscale, ${linkText(probe)}`}>
            <Text style={styles.via}>Tailscale</Text>
            <StateDot dot={dotOf(probe)} used={used} />
            <Text style={used ? styles.linkUsed : styles.linkState} numberOfLines={1}>
              {linkText(probe)}
            </Text>
          </View>
        </View>
        <View style={styles.group}>
          <InfoRow label="Address" value={machine.url.replace(/^https?:\/\//, "")} />
          <InfoRow label="OMP daemon" value={version} />
          <InfoRow label="Sessions" value={sessions} last />
        </View>
        <Button label="Open" onPress={open} />
        <Button label="Remove from this phone" kind="danger" onPress={remove} />
      </>
    );
  }
  return (
    <Sheet visible={machine !== null} title={machine?.name ?? ""} onClose={onClose}>
      {body}
    </Sheet>
  );
}

function createStyles(c: Palette) {
  const row = {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    minHeight: 44,
    paddingVertical: 11,
    paddingHorizontal: 12,
  } as const;
  const mono = { fontFamily: MONO, fontSize: 12, lineHeight: 18 } as const;
  return {
    group: {
      borderRadius: radius.lg,
      overflow: "hidden",
      backgroundColor: c.raised,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
      borderTopColor: c.edgeTop,
    },
    row,
    rowDivided: { ...row, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border },
    via: { width: 76, fontSize: 13, lineHeight: 18, color: c.fgMuted },
    linkState: { ...mono, flex: 1, color: c.fgMuted },
    linkUsed: { ...mono, flex: 1, color: c.ok },
    label: { flex: 1, fontSize: 13, lineHeight: 18, color: c.fgMuted },
    value: { ...mono, flexShrink: 1, color: c.fg },
  } as const;
}
