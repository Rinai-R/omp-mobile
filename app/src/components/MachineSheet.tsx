import { useCallback, useEffect, useState, type ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import { dotOf, linkName, linkText, type Probe } from "../probe";
import { SANS, MONO, radius, useStyles, type Palette } from "../theme";
import { cleanLabel, displayName, shortName } from "../machines";
import type { Machine } from "../types";
import { t } from "../i18n/index.ts";
import { Button, Field, Sheet, StateDot } from "./ui";

interface Props {
  /** The machine that was long-pressed; null while the sheet is closed. */
  machine: Machine | null;
  /** What the last probe found for it; undefined until the first one finished. */
  probe: Probe | undefined;
  onOpen: (machine: Machine) => void;
  /** Remove it from the phone (the caller confirms). */
  onRemove: (machine: Machine) => void;
  /** Save the user's own name for it; undefined goes back to the host name. */
  onRename: (machine: Machine, label: string | undefined) => void;
  onClose: () => void;
}

/** One fact about the machine on one line: a label, then its value. */
function InfoRow({ label, value, last = false }: { label: string; value: string; last?: boolean }): ReactNode {
  const styles = useStyles(createStyles);
  return (
    <View style={last ? styles.row : styles.rowDivided} accessible accessibilityLabel={t("common.pair", { label, value })}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value} numberOfLines={1} selectable>
        {value}
      </Text>
    </View>
  );
}

/**
 * A machine's details and actions: its one link (Tailscale) and its state,
 * its name on this phone, where it is and the daemon's version, then Open and
 * Remove. Values are mono, labels quiet.
 */
export function MachineSheet({ machine, probe, onOpen, onRemove, onRename, onClose }: Props): ReactNode {
  const styles = useStyles(createStyles);
  const [name, setName] = useState("");
  // Each opening starts from the name it has now.
  useEffect(() => {
    if (machine !== null) setName(machine.label ?? "");
  }, [machine]);
  const changed = machine !== null && cleanLabel(name) !== (machine.label === undefined ? undefined : cleanLabel(machine.label));
  const rename = useCallback(() => {
    if (machine !== null) onRename(machine, cleanLabel(name));
  }, [machine, name, onRename]);
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
    body = (
      <>
        <View style={styles.group}>
          <View style={styles.row} accessible accessibilityLabel={t("machine.linkA11y", { via: linkName(machine.url), link: linkText(probe) })}>
            <Text style={styles.via}>{linkName(machine.url)}</Text>
            <StateDot dot={dotOf(probe)} used={used} />
            <Text style={used ? styles.linkUsed : styles.linkState} numberOfLines={1}>
              {linkText(probe)}
            </Text>
          </View>
        </View>
        <Field label={t("machine.name")} value={name} onChangeText={setName} placeholder={shortName(machine.name)} />
        {changed ? <Button label={t("machine.saveName")} kind="plain" onPress={rename} /> : null}
        <View style={styles.group}>
          {/* The title is the host's own name unless the user renamed it: then the host is worth a row. */}
          {machine.label !== undefined ? <InfoRow label={t("machine.host")} value={machine.name} /> : null}
          <InfoRow label={t("machine.address")} value={machine.url.replace(/^https?:\/\//, "")} />
          <InfoRow label={t("machine.daemon")} value={version} last />
        </View>
        <Button label={t("common.open")} onPress={open} />
        <Button label={t("common.remove")} kind="danger" onPress={remove} />
      </>
    );
  }
  return (
    <Sheet visible={machine !== null} title={machine === null ? "" : displayName(machine)} onClose={onClose}>
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
    via: { fontFamily: SANS, width: 76, fontSize: 13, lineHeight: 18, color: c.fgMuted },
    linkState: { ...mono, flex: 1, color: c.fgMuted },
    linkUsed: { ...mono, flex: 1, color: c.ok },
    label: { fontFamily: SANS, flex: 1, fontSize: 13, lineHeight: 18, color: c.fgMuted },
    value: { ...mono, flexShrink: 1, color: c.fg },
  } as const;
}
