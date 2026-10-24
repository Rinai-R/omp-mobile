import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { listSessions } from "../api";
import { age, folderOf, type SessionGroup } from "../sessionGroups";
import { MONO, SANS, radius, useColors, useStyles, type Palette } from "../theme";
import { heldDetail } from "../takeover";
import { loadSessionList, saveSessionList } from "../transcripts";
import type { Machine, SessionSummary } from "../types";
import { t } from "../i18n/index.ts";
import { BrandMark, LiveDot, Spinner } from "./brand";
import { LockGlyph } from "./icons";

/**
 * A computer's sessions, as the phone last saw them while the daemon answers,
 * then the daemon's own list. `refresh` asks again; `error` is the last failure
 * while no live list has come in.
 */
export function useMachineSessions(machine: Machine | undefined, active = true) {
  const [sessions, setSessions] = useState<SessionSummary[] | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** The daemon has answered for this machine: a saved list arriving later must not replace it. */
  const fetched = useRef<string | null>(null);
  const machineId = machine?.id;
  // A probe or a rename hands in a new object for the same computer: follow it without starting over.
  const machineRef = useRef(machine);
  machineRef.current = machine;
  const link = machine === undefined ? "" : `${machine.id}\n${machine.url}\n${machine.token}`;

  const refresh = useCallback(async () => {
    const machine = machineRef.current;
    if (machine === undefined) return;
    setLoading(true);
    // An answer for a computer no longer shown (a tab switched while it was in flight) is dropped.
    const current = () => machineRef.current?.id === machine.id;
    try {
      const list = await listSessions(machine);
      saveSessionList(machine.id, list);
      if (!current()) return;
      fetched.current = machine.id;
      setSessions(list);
      setError(null);
    } catch (cause) {
      if (current()) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (current()) setLoading(false);
    }
    // `link` changes only when the computer or how to reach it does.
  }, [link]);

  useEffect(() => {
    if (machineId === undefined || !active) return undefined;
    let cancelled = false;
    fetched.current = null;
    setSessions(undefined);
    setError(null);
    void loadSessionList(machineId).then((saved) => {
      if (!cancelled && fetched.current !== machineId && saved !== undefined) setSessions(saved);
    });
    void refresh();
    return () => {
      cancelled = true;
    };
  }, [active, machineId, refresh]);

  return { sessions, loading, error, refresh, setSessions };
}

export function SessionRow({
  session,
  current = false,
  busy = false,
  onPress,
  onLongPress,
}: {
  session: SessionSummary;
  current?: boolean;
  /** The session is being opened: a spinner replaces its age. */
  busy?: boolean;
  onPress: (session: SessionSummary) => void;
  onLongPress?: (session: SessionSummary) => void;
}): ReactNode {
  const styles = useStyles(createStyles);
  const colors = useColors();
  const running = session.status === "streaming";
  const waiting = (session.waiting ?? 0) > 0;
  const locked = session.openElsewhere === true;
  // A waiting session says so in its group and its trailing "answer"; its detail stays the folder and the model.
  const detail = [folderOf(session.cwd), locked ? heldDetail(session.owner) : session.model]
    .filter(Boolean)
    .join(" · ");
  const when = age(session.updatedAt);
  return (
    <Pressable
      onPress={() => onPress(session)}
      onLongPress={onLongPress === undefined ? undefined : () => onLongPress(session)}
      style={({ pressed }) => [styles.row, current && styles.rowCurrent, pressed && styles.rowPressed]}
      accessibilityRole="button"
      accessibilityLabel={t("common.pair", {
        label: session.title,
        value: running ? t("session.running") : waiting ? t("session.waiting") : locked ? t("session.inTerminal") : when,
      })}
      accessibilityState={{ selected: current }}
    >
      {current ? <View style={styles.currentBar} /> : null}
      <View style={running ? styles.tileRunning : styles.tile}>
        {running ? (
          <View style={styles.tileInner}>
            <BrandMark size={11} />
          </View>
        ) : waiting ? (
          <LiveDot color={colors.accent} size={8} ping />
        ) : (
          <View style={locked ? styles.dotLocked : current ? styles.dotCurrent : styles.dot} />
        )}
      </View>
      <View style={styles.text}>
        <Text style={locked ? styles.titleDim : styles.title} numberOfLines={1}>
          {session.title}
        </Text>
        <Text style={styles.detail} numberOfLines={1}>
          {detail}
        </Text>
      </View>
      <View style={styles.trailing}>
        {busy ? (
          <Spinner size={12} />
        ) : waiting ? (
          <Text style={styles.need}>{t("session.answer")}</Text>
        ) : running ? (
          <Text style={styles.live}>{t("session.working")}</Text>
        ) : locked ? (
          <LockGlyph size={12} color={colors.warn} />
        ) : (
          <Text style={styles.time}>{when}</Text>
        )}
      </View>
    </Pressable>
  );
}

/** Groups as labelled cards; `flat` drops the cards for use inside a sheet. */
export function SessionGroups({
  groups,
  currentId,
  busyId,
  flat = false,
  onPress,
  onLongPress,
}: {
  groups: readonly SessionGroup[];
  currentId?: string;
  busyId?: string | null;
  flat?: boolean;
  onPress: (session: SessionSummary) => void;
  onLongPress?: (session: SessionSummary) => void;
}): ReactNode {
  const styles = useStyles(createStyles);
  return (
    <>
      {groups.map((group) => (
        <View key={group.key}>
          <View style={styles.label}>
            <Text style={group.key === "waiting" ? styles.labelAccent : styles.labelText}>{group.title}</Text>
            {group.sessions.length > 1 ? <Text style={styles.labelCount}>{group.sessions.length}</Text> : null}
          </View>
          <View style={flat ? undefined : styles.card}>
            {group.sessions.map((session, index) => (
              <View key={session.id}>
                {index > 0 && !flat ? <View style={styles.divider} /> : null}
                <SessionRow
                  session={session}
                  current={session.id === currentId}
                  busy={session.id === busyId}
                  onPress={onPress}
                  onLongPress={onLongPress}
                />
              </View>
            ))}
          </View>
        </View>
      ))}
    </>
  );
}

function createStyles(c: Palette) {
  const tile = {
    width: 30,
    height: 30,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: c.well,
  } as const;
  const dot = { width: 7, height: 7, borderRadius: 4, backgroundColor: c.fgGhost } as const;
  const title = { fontFamily: SANS, fontSize: 15, lineHeight: 20, fontWeight: "500", letterSpacing: -0.15, color: c.fg } as const;
  const mono = { fontFamily: MONO, fontSize: 11, lineHeight: 15, color: c.fgGhost } as const;
  const label = {
    fontFamily: MONO,
    fontSize: 10.5,
    lineHeight: 14,
    fontWeight: "500",
    letterSpacing: 1.6,
    textTransform: "uppercase",
    color: c.fgGhost,
  } as const;
  return {
    row: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 62, paddingVertical: 10, paddingLeft: 14, paddingRight: 14 },
    rowCurrent: { backgroundColor: c.accentMuted },
    rowPressed: { backgroundColor: c.hover },
    currentBar: { position: "absolute", left: 0, top: 12, bottom: 12, width: 3, borderTopRightRadius: 3, borderBottomRightRadius: 3, backgroundColor: c.accent },
    tile,
    tileRunning: { ...tile, padding: 1.5, backgroundColor: c.accentV },
    tileInner: { flex: 1, alignSelf: "stretch", borderRadius: 8.5, alignItems: "center", justifyContent: "center", backgroundColor: c.panel },
    dot,
    dotCurrent: { ...dot, backgroundColor: c.ok },
    dotLocked: { ...dot, backgroundColor: c.warn },
    text: { flex: 1, minWidth: 0, gap: 3 },
    title,
    titleDim: { ...title, color: c.fgFaint },
    detail: { ...mono, color: c.fgFaint },
    trailing: { minWidth: 28, alignItems: "flex-end" },
    time: mono,
    live: { ...mono, color: c.accentV },
    need: { ...mono, color: c.accent },
    label: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingTop: 18, paddingBottom: 8, paddingHorizontal: 18 },
    labelText: label,
    labelAccent: { ...label, color: c.cyan },
    labelCount: { ...label, letterSpacing: 0.4 },
    card: {
      marginHorizontal: 12,
      borderRadius: radius.xl,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
      backgroundColor: c.panel,
      overflow: "hidden",
    },
    divider: { height: StyleSheet.hairlineWidth, backgroundColor: c.border, marginLeft: 56 },
  } as const;
}
