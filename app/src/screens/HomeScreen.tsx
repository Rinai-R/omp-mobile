import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { FORK_FEATURE, answerRequest, createSession, daemonFeatures, deleteSession, forkSession, knownFeatures } from "../api";
import { ApprovalWidget } from "../components/ApprovalWidget";
import { LiveDot, PulseDot } from "../components/brand";
import { ChatGlyph, ChevronDownGlyph, CloseGlyph, ComputerGlyph, ForkGlyph, PlusGlyph, SearchGlyph } from "../components/icons";
import { TAB_BAR_HEIGHT } from "../components/TabBar";
import { SessionGroups, useMachineSessions, useTranscriptSync } from "../components/SessionList";
import { haptic } from "../haptics";
import { displayName, machineLabel } from "../machines";
import { Banner, Button, ConfirmSheet, Field, Sheet } from "../components/ui";
import { reasonText, type Probe } from "../probe";
import { attentionCount, folderOf, groupSessions } from "../sessionGroups";
import { MONO, SANS, radius, useColors, useStyles, type Palette } from "../theme";
import { dropTranscript } from "../transcripts";
import { t } from "../i18n/index.ts";
import type { Machine, SessionSummary } from "../types";

/** The home's segments: every session, what runs or waits, and the terminal's. */
type Segment = "all" | "active" | "terminal";
const SEGMENTS: readonly Segment[] = ["all", "active", "terminal"];

function inSegment(session: SessionSummary, segment: Segment): boolean {
  if (segment === "active") return session.status === "streaming" || (session.waiting ?? 0) > 0;
  if (segment === "terminal") return session.origin === "omp";
  return true;
}

interface Props {
  machine: Machine;
  /** Every computer on the phone: one named like another is told apart by its address. */
  machines: readonly Machine[];
  probe: Probe | undefined;
  onOpen: (machine: Machine, session: SessionSummary) => void;
  /** Open the computer picker (the computer card). */
  onPickMachine: () => void;
  /** How many sessions wait for an answer, for the tab bar's badge. */
  onWaiting: (count: number) => void;
  onRetry: (machine: Machine) => void;
  /** Ask the home to open the New session sheet (from the switcher); a changing nonce opens it again. */
  newRequest: number;
}

/** The app's home: the sessions of the computer used last, grouped by what needs attention. */
export function HomeScreen({ machine, machines, probe, onOpen, onPickMachine, onWaiting, onRetry, newRequest }: Props): ReactNode {
  const styles = useStyles(createStyles);
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { sessions, loading, error, refresh, setSessions } = useMachineSessions(machine);
  useTranscriptSync(machine, sessions, refresh);
  const [creating, setCreating] = useState(false);
  const [cwd, setCwd] = useState("");
  const [busy, setBusy] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  /** The session whose Close is being confirmed, and what the last close failed with. */
  const [closing, setClosing] = useState<SessionSummary | null>(null);
  const [closeError, setCloseError] = useState<string | null>(null);
  /** The session whose long-press actions are open (fork, close), and a fork in flight. */
  const [actions, setActions] = useState<SessionSummary | null>(null);
  const [forking, setForking] = useState(false);
  const [canFork, setCanFork] = useState(() => knownFeatures(machine).includes(FORK_FEATURE));
  // Asked again once the list loads: the computer may have been out of reach when the home opened.
  const listed = sessions !== undefined;
  useEffect(() => {
    let live = true;
    void daemonFeatures(machine).then((features) => {
      if (live && features.length > 0) setCanFork(features.includes(FORK_FEATURE));
    });
    return () => {
      live = false;
    };
    // A probe updates the machine object (lastSeen); only its address and the list's arrival matter here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [machine.url, listed]);
  // Starts at 0, not at newRequest: a home opened with a request (New from the switcher) opens the sheet at once.
  const [lastRequest, setLastRequest] = useState(0);
  if (newRequest !== lastRequest) {
    setLastRequest(newRequest);
    if (newRequest > 0) {
      setCwd("");
      setCreateError(null);
      setCreating(true);
    }
  }

  const [query, setQuery] = useState("");
  const [segment, setSegment] = useState<Segment>("all");
  const groups = useMemo(
    () => groupSessions((sessions ?? []).filter((session) => inSegment(session, segment)), Date.now(), query),
    [sessions, segment, query],
  );
  const counts = useMemo(() => attentionCount(sessions ?? []), [sessions]);
  /** Sessions whose waiting question the home can show as a widget, oldest question first. */
  const asking = useMemo(
    () =>
      (sessions ?? [])
        .filter((session): session is SessionSummary & { request: NonNullable<SessionSummary["request"]> } => session.request !== undefined)
        .sort((a, b) => a.updatedAt - b.updatedAt),
    [sessions],
  );
  useEffect(() => onWaiting(counts.waiting), [counts.waiting, onWaiting]);
  /** Directories sessions ran in, newest first: one tap starts a new session there. */
  const recent = useMemo(() => {
    const seen: string[] = [];
    for (const session of [...(sessions ?? [])].sort((a, b) => b.updatedAt - a.updatedAt)) {
      if (session.cwd !== "" && !seen.includes(session.cwd)) seen.push(session.cwd);
      if (seen.length >= 4) break;
    }
    return seen;
  }, [sessions]);

  const reachable = sessions !== undefined && error === null;
  const down = probe?.state === "unreachable" && !reachable;
  // The card names the computer; a second line appears only for state worth reading: why it is down, what runs.
  const detail = down
    ? t("home.unreachable", { reason: reasonText(probe.reason) })
    : counts.running > 0
      ? t("common.running", { count: counts.running })
      : undefined;

  const create = useCallback(async () => {
    setBusy(true);
    setCreateError(null);
    try {
      const session = await createSession(machine, cwd.trim() === "" ? undefined : cwd.trim());
      setCreating(false);
      setSessions((current) => [session, ...(current ?? []).filter((item) => item.id !== session.id)]);
      onOpen(machine, session);
    } catch (cause) {
      setCreateError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }, [cwd, machine, onOpen, setSessions]);

  const confirmDelete = useCallback((session: SessionSummary) => {
    if (session.origin === "daemon") setClosing(session);
  }, []);
  /** A long press: the session's actions where the daemon can fork, else Close as before. */
  const longPress = useCallback(
    (session: SessionSummary) => {
      if (canFork) setActions(session);
      else confirmDelete(session);
    },
    [canFork, confirmDelete],
  );
  const fork = useCallback(
    (session: SessionSummary) => {
      setForking(true);
      setCloseError(null);
      void forkSession(machine, session.id)
        .then((forked) => {
          setActions(null);
          setSessions((current) => [forked, ...(current ?? []).filter((item) => item.id !== forked.id)]);
          onOpen(machine, forked);
        })
        .catch((cause: unknown) => {
          setActions(null);
          setCloseError(t("fork.failed", { error: cause instanceof Error ? cause.message : String(cause) }));
        })
        .finally(() => setForking(false));
    },
    [machine, onOpen, setSessions],
  );
  const closeSession = useCallback(
    (session: SessionSummary) => {
      setCloseError(null);
      void deleteSession(machine, session.id)
        .then(() => {
          dropTranscript(machine.id, session.id);
          setSessions((current) => (current ?? []).filter((item) => item.id !== session.id));
        })
        .catch((cause: unknown) =>
          setCloseError(t("home.close.failed", { error: cause instanceof Error ? cause.message : String(cause) })),
        );
    },
    [machine, setSessions],
  );

  const openCreate = useCallback(() => {
    setCwd("");
    setCreateError(null);
    setCreating(true);
  }, []);

  const answer = useCallback(
    async (session: SessionSummary, id: string, value: { value?: string; confirmed?: boolean }) => {
      await answerRequest(machine, session.id, id, value);
      setSessions((current) =>
        (current ?? []).map((item) =>
          item.id === session.id ? { ...item, request: undefined, waiting: Math.max(0, (item.waiting ?? 1) - 1) } : item,
        ),
      );
      void refresh(true);
    },
    [machine, refresh, setSessions],
  );

  const name = machineLabel(machine, machines);

  return (
    <View style={styles.root}>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingTop: 6, paddingBottom: 168 + insets.bottom }]}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={loading && sessions !== undefined}
            onRefresh={() => {
              onRetry(machine);
              void refresh();
            }}
            tintColor={colors.fgFaint}
            colors={[colors.accent]}
            progressBackgroundColor={colors.overlay}
          />
        }
      >
        {/* The tab already says "Sessions": the header names the computer they run on, and switches it. */}
        <Pressable
          onPress={onPickMachine}
          style={({ pressed }) => [styles.machine, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel={t("home.machineA11y", { name, detail: detail ?? t(reachable ? "chat.status.live" : "chat.status.connecting") })}
        >
          <View style={styles.machineTile}>
            <ComputerGlyph size={20} color={colors.tileFg} />
            <View style={styles.machineDot}>
              {down ? (
                <LiveDot color={colors.err} size={9} />
              ) : reachable ? (
                <LiveDot color={colors.sysGreen} size={9} ping={counts.running > 0} />
              ) : (
                <PulseDot color={colors.warn} size={9} />
              )}
            </View>
          </View>
          <View style={styles.machineText}>
            <View style={styles.machineNameRow}>
              <Text style={styles.machineName} numberOfLines={1} accessibilityRole="header">
                {name}
              </Text>
              <ChevronDownGlyph size={16} color={colors.fgFaint} />
            </View>
            <Text style={down ? styles.machineDetailDown : styles.machineDetail} numberOfLines={1}>
              {detail ?? t(reachable ? "home.online" : "chat.status.connecting")}
            </Text>
          </View>
        </Pressable>

        <View style={styles.search}>
          <SearchGlyph size={16} color={colors.fgFaint} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder={t("sessions.search")}
            placeholderTextColor={colors.fgFaint}
            selectionColor={colors.tint}
            style={styles.searchInput}
            returnKeyType="search"
            autoCorrect={false}
          />
          {query !== "" ? (
            <Pressable onPress={() => setQuery("")} hitSlop={10} accessibilityRole="button" accessibilityLabel={t("sessions.clearSearch")}>
              <View style={styles.clear}>
                <CloseGlyph size={10} color={colors.bg} />
              </View>
            </Pressable>
          ) : null}
        </View>

        <View style={styles.segments} accessibilityRole="tablist">
          {SEGMENTS.map((key) => (
            <Pressable
              key={key}
              onPress={() => {
                if (key !== segment) haptic.select();
                setSegment(key);
              }}
              style={key === segment ? styles.segmentOn : styles.segment}
              accessibilityRole="tab"
              accessibilityState={{ selected: key === segment }}
            >
              <Text style={key === segment ? styles.segmentTextOn : styles.segmentText}>{t(`home.segment.${key}`)}</Text>
            </Pressable>
          ))}
        </View>

        {asking.map((session) => (
          <ApprovalWidget
            key={`${session.id}:${session.request.id}`}
            session={session}
            onView={() => onOpen(machine, session)}
            onAnswer={(value) => answer(session, session.request.id, value)}
          />
        ))}

        {closeError !== null ? (
          <View style={styles.bannerWrap}>
            <Banner text={closeError} onPress={() => setCloseError(null)} />
          </View>
        ) : null}

        {error !== null && sessions !== undefined ? (
          <View style={styles.bannerWrap}>
            <Banner text={t("home.stale", { error })} action={{ label: t("common.retry"), onPress: () => void refresh() }} />
          </View>
        ) : null}

        {sessions === undefined ? (
          error !== null ? (
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>{t("home.cantReach", { name: displayName(machine) })}</Text>
              <Text style={styles.emptyBody}>{error}</Text>
              <View style={styles.emptyAction}>
                <Button label={t("common.tryAgain")} kind="plain" onPress={() => void refresh()} />
              </View>
            </View>
          ) : (
            <View style={styles.skeleton}>
              {[0, 1, 2].map((index) => (
                <View key={index} style={styles.skeletonRow} />
              ))}
            </View>
          )
        ) : groups.length === 0 ? (
          <View style={styles.empty}>
            <View style={styles.emptyTile}>
              <ChatGlyph size={22} color={colors.fgMuted} />
            </View>
            <Text style={styles.emptyTitle}>{sessions.length === 0 ? t("home.empty.title") : t("home.noMatch")}</Text>
          </View>
        ) : (
          <SessionGroups groups={groups} onPress={(session) => onOpen(machine, session)} onLongPress={longPress} />
        )}
      </ScrollView>

      <Pressable
        onPress={() => {
          haptic.tap();
          openCreate();
        }}
        style={({ pressed }) => [styles.fab, { bottom: TAB_BAR_HEIGHT + 26 + insets.bottom }, pressed && styles.fabPressed]}
        accessibilityRole="button"
        accessibilityLabel={t("home.new")}
      >
        <PlusGlyph size={26} color={colors.fabFg} />
      </Pressable>

      <Sheet visible={creating} title={t("home.new")} onClose={() => setCreating(false)}>
        <Field label={t("home.newSheet.cwd")} value={cwd} onChangeText={setCwd} placeholder={machine.cwd} />
        {recent.length > 0 ? (
          <View style={styles.recent}>
            {recent.map((path) => (
              <Pressable
                key={path}
                onPress={() => setCwd(path)}
                style={({ pressed }) => [cwd === path ? styles.recentChipOn : styles.recentChip, pressed && styles.pressed]}
                accessibilityRole="button"
                accessibilityLabel={t("home.newSheet.use", { path })}
              >
                <Text style={cwd === path ? styles.recentTextOn : styles.recentText} numberOfLines={1}>
                  {folderOf(path)}
                </Text>
              </Pressable>
            ))}
          </View>
        ) : null}
        {createError !== null ? <Text style={styles.error}>{createError}</Text> : null}
        <Button label={t("home.newSheet.start")} onPress={() => void create()} busy={busy} />
      </Sheet>

      <Sheet visible={actions !== null} title={actions?.title ?? ""} onClose={() => setActions(null)}>
        <Text style={styles.actionsBody}>{t("fork.sessionBody")}</Text>
        <Button
          label={t("fork.session")}
          icon={<ForkGlyph size={16} color={colors.accentFg} />}
          busy={forking}
          onPress={() => {
            if (actions !== null) fork(actions);
          }}
        />
        {actions?.origin === "daemon" ? (
          <Button
            label={t("home.close.action")}
            kind="plain"
            icon={<CloseGlyph size={14} color={colors.fgMuted} />}
            onPress={() => {
              const session = actions;
              setActions(null);
              setClosing(session);
            }}
          />
        ) : null}
      </Sheet>
      <ConfirmSheet
        visible={closing !== null}
        title={t("home.close.title")}
        body={t("home.close.body")}
        action={t("home.close.action")}
        danger
        onConfirm={() => {
          if (closing !== null) closeSession(closing);
        }}
        onClose={() => setClosing(null)}
      />
    </View>
  );
}

function createStyles(c: Palette) {
  const chip = {
    height: 30,
    maxWidth: 180,
    paddingHorizontal: 12,
    borderRadius: radius.pill,
    justifyContent: "center",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: c.borderStrong,
  } as const;
  const chipText = { fontFamily: MONO, fontSize: 12, lineHeight: 16, color: c.fgMuted } as const;
  const segment = { flex: 1, height: 30, borderRadius: 7, alignItems: "center", justifyContent: "center" } as const;
  const segmentText = { fontFamily: SANS, fontSize: 13, lineHeight: 17, fontWeight: "500", color: c.fg } as const;
  return {
    root: { flex: 1, backgroundColor: c.bg },
    content: { width: "100%", maxWidth: 640, alignSelf: "center" },
    pressed: { opacity: 0.6 },
    machine: { flexDirection: "row", alignItems: "center", gap: 12, marginHorizontal: 16, marginTop: 14, marginBottom: 14, alignSelf: "flex-start", maxWidth: "100%" },
    machineTile: { width: 44, height: 44, borderRadius: 13, alignItems: "center", justifyContent: "center", backgroundColor: c.tile },
    machineDot: { position: "absolute", right: -2, bottom: -2, padding: 2, borderRadius: 8, backgroundColor: c.bg },
    machineText: { flexShrink: 1, minWidth: 0, gap: 1 },
    machineNameRow: { flexDirection: "row", alignItems: "center", gap: 4 },
    machineName: { flexShrink: 1, fontFamily: SANS, fontSize: 22, lineHeight: 28, fontWeight: "600", letterSpacing: -0.5, color: c.fg },
    machineDetail: { fontFamily: SANS, fontSize: 13, lineHeight: 17, color: c.fgFaint },
    machineDetailDown: { fontFamily: SANS, fontSize: 13, lineHeight: 17, color: c.err },
    search: { flexDirection: "row", alignItems: "center", gap: 8, height: 38, borderRadius: 11, paddingHorizontal: 10, marginHorizontal: 16, marginBottom: 12, backgroundColor: c.search },
    searchInput: { flex: 1, height: 38, paddingVertical: 0, fontFamily: SANS, fontSize: 16, color: c.fg },
    clear: { width: 16, height: 16, borderRadius: 8, alignItems: "center", justifyContent: "center", backgroundColor: c.fgFaint },
    segments: { flexDirection: "row", padding: 2, borderRadius: 9, marginHorizontal: 16, marginBottom: 16, backgroundColor: c.search },
    segment,
    segmentOn: { ...segment, backgroundColor: c.segment, elevation: 2, shadowColor: "#000000", shadowOpacity: 0.25, shadowRadius: 4, shadowOffset: { width: 0, height: 2 } },
    segmentText: { ...segmentText, color: c.fgMuted },
    segmentTextOn: { ...segmentText, fontWeight: "600" },
    bannerWrap: { marginBottom: 12, marginHorizontal: 16, borderRadius: radius.md, overflow: "hidden" },
    skeleton: { marginTop: 24, marginHorizontal: 16, gap: 1, borderRadius: 14, overflow: "hidden" },
    skeletonRow: { height: 58, backgroundColor: c.group, opacity: 0.6 },
    empty: { alignItems: "center", paddingHorizontal: 36, paddingTop: 56 },
    emptyTile: { width: 52, height: 52, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: c.group },
    emptyTitle: { fontFamily: SANS, fontSize: 17, lineHeight: 22, fontWeight: "600", letterSpacing: -0.3, color: c.fg, marginTop: 16, textAlign: "center" },
    emptyBody: { fontFamily: SANS, fontSize: 14, lineHeight: 20, color: c.fgFaint, marginTop: 6, textAlign: "center" },
    emptyAction: { marginTop: 18, minWidth: 180 },
    fab: {
      position: "absolute",
      right: 20,
      width: 58,
      height: 58,
      borderRadius: 29,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: c.fab,
      elevation: 10,
      shadowColor: "#000000",
      shadowOpacity: 0.5,
      shadowRadius: 16,
      shadowOffset: { width: 0, height: 8 },
    },
    fabPressed: { transform: [{ scale: 0.92 }] },
    recent: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: -4 },
    recentChip: chip,
    recentChipOn: { ...chip, borderColor: c.accent, backgroundColor: c.accentMuted },
    recentText: chipText,
    recentTextOn: { ...chipText, color: c.fg },
    error: { fontFamily: MONO, fontSize: 12, lineHeight: 17, color: c.err, marginHorizontal: 2 },
    actionsBody: { fontFamily: SANS, fontSize: 14, lineHeight: 20, color: c.fgMuted, marginTop: -4 },
  } as const;
}
