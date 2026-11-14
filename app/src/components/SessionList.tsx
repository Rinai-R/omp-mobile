import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { AppState, Pressable, StyleSheet, Text, View } from "react-native";
import { listSessions } from "../api";
import { age, folderOf, type SessionGroup } from "../sessionGroups";
import { SANS, useColors, useStyles, type Palette } from "../theme";
import { heldDetail } from "../takeover";
import { syncSessions } from "../sync";
import { loadSessionList, saveSessionList } from "../transcripts";
import type { Machine, SessionSummary } from "../types";
import { t } from "../i18n/index.ts";
import { GradientFill, ShimmerText, Spinner } from "./brand";
import { ChevronGlyph, ComputerGlyph, LockGlyph, QuestionGlyph, TerminalGlyph } from "./icons";

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

  /** Ask the daemon again; `quiet` (a background refresh) shows no spinner. */
  const refresh = useCallback(async (quiet = false) => {
    const machine = machineRef.current;
    if (machine === undefined) return;
    if (!quiet) setLoading(true);
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
      if (current() && !quiet) setLoading(false);
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

/** How often the home refreshes its list, and with it the cached transcripts, while the app is in the foreground. */
const SYNC_INTERVAL_MS = 60_000;

/**
 * Keep the cached transcripts of a computer's recent sessions current
 * (issue #43): after each session-list load, every 60 s while the app is in
 * the foreground (the list is asked again quietly first), and when the app
 * comes back to the foreground.
 */
export function useTranscriptSync(
  machine: Machine,
  sessions: readonly SessionSummary[] | undefined,
  refresh: (quiet?: boolean) => Promise<void>,
): void {
  const machineRef = useRef(machine);
  machineRef.current = machine;
  const link = `${machine.id}\n${machine.url}\n${machine.token}`;
  useEffect(() => {
    if (sessions === undefined) return undefined;
    let current = true;
    void syncSessions(machineRef.current, sessions, () => current && AppState.currentState !== "background");
    return () => {
      current = false;
    };
  }, [link, sessions]);
  useEffect(() => {
    const timer = setInterval(() => {
      if (AppState.currentState === "active") void refresh(true);
    }, SYNC_INTERVAL_MS);
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void refresh(true);
    });
    return () => {
      clearInterval(timer);
      subscription.remove();
    };
  }, [refresh]);
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
  const terminal = session.origin === "omp";
  const when = age(session.updatedAt);
  // A waiting session says so in its group and its badge; its detail stays the folder and the model.
  const detail = [folderOf(session.cwd), locked ? heldDetail(session.owner) : when].filter(Boolean).join(" · ");
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
      <View style={[styles.tile, { backgroundColor: waiting ? colors.sysOrange : running ? "transparent" : terminal || locked ? colors.fgGhost : hueOf(session.cwd) }]}>
        {waiting ? (
          <QuestionGlyph size={16} color="#ffffff" />
        ) : running ? (
          <>
            <GradientFill radius={8} />
            <TerminalGlyph size={16} color="#ffffff" />
          </>
        ) : terminal || locked ? (
          locked ? <LockGlyph size={14} color="#ffffff" /> : <ComputerGlyph size={16} color="#ffffff" />
        ) : (
          <Text style={styles.initial}>{initialOf(session.cwd)}</Text>
        )}
      </View>
      <View style={styles.text}>
        <Text style={locked ? styles.titleDim : styles.title} numberOfLines={1}>
          {session.title}
        </Text>
        {running && !waiting ? (
          <ShimmerText text={`${t("session.working")} · ${folderOf(session.cwd)}`} style={styles.detail} />
        ) : (
          <Text style={styles.detail} numberOfLines={1}>
            {detail}
          </Text>
        )}
      </View>
      <View style={styles.trailing}>
        {busy ? (
          <Spinner size={12} />
        ) : waiting ? (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{session.waiting}</Text>
          </View>
        ) : null}
        <ChevronGlyph size={15} color={colors.fgGhost} />
      </View>
    </Pressable>
  );
}

/** The colours a folder's tile cycles through: iOS's own, so the list reads like Settings. */
const HUES = ["#5e5ce6", "#0a84ff", "#30b0c7", "#34c759", "#ff9f0a", "#ff375f", "#bf5af2", "#ac8e68"];

/** A folder's tile colour, the same every time it appears. */
function hueOf(path: string): string {
  let hash = 0;
  for (const char of folderOf(path)) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return HUES[hash % HUES.length] ?? "#5e5ce6";
}

/** The folder's first letter or digit, for its tile. */
function initialOf(path: string): string {
  const match = /[\p{L}\p{N}]/u.exec(folderOf(path));
  return (match?.[0] ?? "·").toUpperCase();
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
            <Text style={group.key === "waiting" ? styles.labelAccent : styles.labelText}>{group.title.toLocaleUpperCase()}</Text>
            {group.sessions.length > 1 ? <Text style={styles.labelCount}>{group.sessions.length}</Text> : null}
          </View>
          <View style={flat ? undefined : styles.card}>
            {group.sessions.map((session, index) => (
              <View key={session.id}>
                {index > 0 ? <View style={styles.divider} /> : null}
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
  const title = { fontFamily: SANS, fontSize: 16, lineHeight: 21, fontWeight: "400", letterSpacing: -0.3, color: c.fg } as const;
  // Uppercased in JS and without letter spacing: Android clips the last glyph of such labels otherwise.
  const label = { fontFamily: SANS, fontSize: 13, lineHeight: 18, fontWeight: "400", color: c.fgFaint } as const;
  return {
    row: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 58, paddingVertical: 10, paddingLeft: 14, paddingRight: 12 },
    rowCurrent: { backgroundColor: c.selected },
    rowPressed: { backgroundColor: c.hover },
    tile: { width: 32, height: 32, borderRadius: 8, overflow: "hidden", alignItems: "center", justifyContent: "center" },
    initial: { fontFamily: SANS, fontSize: 15, lineHeight: 20, fontWeight: "600", color: "#ffffff" },
    text: { flex: 1, minWidth: 0, gap: 2 },
    title,
    titleDim: { ...title, color: c.fgFaint },
    detail: { fontFamily: SANS, fontSize: 13, lineHeight: 17, color: c.fgFaint },
    trailing: { flexDirection: "row", alignItems: "center", gap: 8 },
    badge: { minWidth: 22, height: 22, paddingHorizontal: 6, borderRadius: 11, alignItems: "center", justifyContent: "center", backgroundColor: c.badge },
    badgeText: { fontFamily: SANS, fontSize: 13, lineHeight: 16, fontWeight: "600", color: "#ffffff" },
    label: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingTop: 16, paddingBottom: 7, paddingHorizontal: 32 },
    labelText: label,
    labelAccent: { ...label, color: c.sysOrange },
    labelCount: label,
    card: { marginHorizontal: 16, borderRadius: 14, backgroundColor: c.group, overflow: "hidden" },
    divider: { height: StyleSheet.hairlineWidth, backgroundColor: c.separator, marginLeft: 58 },
  } as const;
}
