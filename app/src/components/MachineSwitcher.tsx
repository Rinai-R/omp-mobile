import { useEffect, type ReactNode } from "react";
import { Text, View } from "react-native";
import { summaryOf, type Probe } from "../probe";
import { MONO, useColors, useStyles, type Palette } from "../theme";
import { displayName, machineLabel } from "../machines";
import type { Machine } from "../types";
import { t } from "../i18n/index.ts";
import { CheckGlyph } from "./icons";
import { Button, Group, Row, Sheet, StateDot } from "./ui";

interface Props {
  visible: boolean;
  machines: readonly Machine[];
  current: Machine;
  probes: ReadonlyMap<string, Probe>;
  /** Probe every machine again; called each time the sheet opens, so the dots are fresh. */
  onProbe: () => void;
  onPick: (machine: Machine) => void;
  onClose: () => void;
  /** Open the computers screen (add, remove, details). */
  onManage?: () => void;
}

/** Jump from one computer's sessions to another's without going back to the list. */
export function MachineSwitcher({ visible, machines, current, probes, onProbe, onPick, onClose, onManage }: Props): ReactNode {
  const styles = useStyles(createStyles);
  const colors = useColors();
  useEffect(() => {
    if (visible) onProbe();
  }, [onProbe, visible]);
  const now = Date.now();
  return (
    <Sheet visible={visible} title={t("switcher.title")} onClose={onClose}>
      <Group>
        {machines.map((machine, index) => {
          const summary = summaryOf(probes.get(machine.id), machine.lastSeen, now);
          const here = machine.id === current.id;
          return (
            <Row
              key={machine.id}
              title={machineLabel(machine, machines)}
              dim={summary.dot === "down"}
              detail={
                <View style={styles.detailRow}>
                  <StateDot dot={summary.dot} />
                  <Text style={styles.detail} numberOfLines={1}>
                    {summary.text}
                  </Text>
                </View>
              }
              trailing={here ? <CheckGlyph size={16} color={colors.accent} /> : undefined}
              selected={here}
              chevron={!here}
              last={index === machines.length - 1}
              onPress={() => {
                onClose();
                if (!here) onPick(machine);
              }}
              accessibilityLabel={
                here
                  ? t("switcher.hereA11y", { name: displayName(machine), summary: summary.text })
                  : t("common.pair", { label: displayName(machine), value: summary.text })
              }
            />
          );
        })}
      </Group>
      {onManage !== undefined ? (
        <Button
          label={t("switcher.manage")}
          kind="plain"
          onPress={() => {
            onClose();
            onManage();
          }}
        />
      ) : null}
    </Sheet>
  );
}

function createStyles(c: Palette) {
  return {
    detailRow: { flexDirection: "row", alignItems: "center", gap: 6, minWidth: 0 },
    detail: { flexShrink: 1, fontFamily: MONO, fontSize: 11.5, lineHeight: 16, color: c.fgMuted },
  } as const;
}
