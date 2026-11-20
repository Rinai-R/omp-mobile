import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { ActivityIndicator, Pressable, RefreshControl, StyleSheet, Text, TextInput, View, type LayoutChangeEvent } from "react-native";
import Reanimated, { useAnimatedStyle, useSharedValue, withTiming, type SharedValue } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { FORK_FEATURE, answerRequest, createSession, daemonFeatures, deleteSession, forkSession, knownFeatures } from "../api";
import { ApprovalWidget } from "../components/ApprovalWidget";
import { LiveDot, PulseDot } from "../components/brand";
import { ChatGlyph, ChevronDownGlyph, CloseGlyph, ForkGlyph, PlusGlyph, SearchGlyph } from "../components/icons";
import { GlassTarget, useBlurTarget } from "../components/Glass";
import { LargeTitle, PageBar, usePageScroll, usePageTop } from "../components/LargeTitle";
import { TAB_BAR_HEIGHT } from "../components/TabBar";
import { SearchResults, SessionGroups, useMachineSessions, useSessionSearch, useTranscriptSync } from "../components/SessionList";
import { haptic } from "../haptics";
import { displayName, machineLabel } from "../machines";
import { Banner, Button, ConfirmSheet, Field, PressableScale, Sheet } from "../components/ui";
import { QUICK, QUICK_CSS } from "../motion";
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
  /** `at`: the timestamp of the message a search matched, for the chat to open on. */
  onOpen: (machine: Machine, session: SessionSummary, at?: number) => void;
  /** Open the computer picker (the computer card). */
  onPickMachine: () => void;
  /** How many sessions wait for an answer, for the tab bar's badge. */
  onWaiting: (count: number) => void;
  onRetry: (machine: Machine) => void;
  /** Ask the home to open the New session sheet (from the switcher); a changing nonce opens it again. */
  newRequest: number;
  /**
   * Whether the home is the screen in front. It stays mounted under a pushed
   * chat, so coming back to it (false → true) refreshes the list quietly.
   */
  active?: boolean;
  /** What the tab bar blurs, and where this page reports how much of it runs on under the bar. */
  blurTarget?: RefObject<View | null>;
  under?: SharedValue<number>;
}

/** The app's home: the sessions of the computer used last, grouped by what needs attention. */
export function HomeScreen({ machine, machines, probe, onOpen, onPickMachine, onWaiting, onRetry, newRequest, active = true, blurTarget, under }: Props): ReactNode {
  const styles = useStyles(createStyles);
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const ownTarget = useBlurTarget();
  const target = blurTarget ?? ownTarget;
  const page = usePageScroll(under);
  const top = usePageTop();
  const { sessions, loading, error, refresh, setSessions } = useMachineSessions(machine);
  useTranscriptSync(machine, sessions, refresh);
  const wasActive = useRef(active);
  useEffect(() => {
    if (active && !wasActive.current) void refresh(true);
    wasActive.current = active;
  }, [active, refresh]);
  const [searching, setSearching] = useState(false);
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
  // Title and message text, asked of the computer; an older daemon leaves the local title filter below.
  const search = useSessionSearch(machine, query);
  const found = useMemo(() => (search.results ?? []).filter(({ session }) => inSegment(session, segment)), [search.results, segment]);
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
      <GlassTarget target={target}>
      <Reanimated.ScrollView
        {...page.props}
        contentContainerStyle={[styles.content, { paddingTop: top, paddingBottom: 168 + insets.bottom }]}
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
            progressViewOffset={top}
          />
        }
      >
        {/* The tab already says "Sessions": the large title names the computer they run on, and switches it. */}
        <LargeTitle
          y={page.y}
          title={name}
          accessory={<ChevronDownGlyph size={22} color={colors.fgFaint} />}
          onPress={onPickMachine}
          accessibilityLabel={t("home.machineA11y", { name, detail: detail ?? t(reachable ? "chat.status.live" : "chat.status.connecting") })}
        >
          <View style={styles.status}>
            {down ? (
              <LiveDot color={colors.err} size={8} />
            ) : reachable ? (
              <LiveDot color={colors.sysGreen} size={8} ping={counts.running > 0} />
            ) : (
              <PulseDot color={colors.warn} size={8} />
            )}
            <Text style={down ? styles.statusDown : styles.statusText} numberOfLines={1}>
              {detail ?? t(reachable ? "home.online" : "chat.status.connecting")}
            </Text>
          </View>
        </LargeTitle>

        <Reanimated.View style={[styles.search, searching && styles.searchFocused]}>
          <SearchGlyph size={16} color={colors.fgFaint} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            onFocus={() => setSearching(true)}
            onBlur={() => setSearching(false)}
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
        </Reanimated.View>

        <Segments value={segment} onChange={setSegment} />

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

        {search.remote ? (
          search.results === null ? (
            <View style={styles.empty}>
              {search.error !== null ? <Text style={styles.emptyBody}>{search.error}</Text> : <ActivityIndicator color={colors.fgFaint} />}
            </View>
          ) : found.length === 0 ? (
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>{t("home.noMatch")}</Text>
            </View>
          ) : (
            <View style={styles.results}>
              <SearchResults results={found} onPress={(session, at) => onOpen(machine, session, at)} />
            </View>
          )
        ) : sessions === undefined ? (
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
      </Reanimated.ScrollView>
      </GlassTarget>
      <PageBar target={target} y={page.y} title={name} />

      <PressableScale
        onPress={() => {
          haptic.tap();
          openCreate();
        }}
        style={[styles.fab, { bottom: TAB_BAR_HEIGHT + 26 + insets.bottom }]}
        accessibilityRole="button"
        accessibilityLabel={t("home.new")}
      >
        <PlusGlyph size={26} color={colors.fabFg} />
      </PressableScale>

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

/**
 * The segmented control: one pill slides under the chosen segment. The pill
 * is absolute and childless, so its width can animate without laying out
 * anything else; segments are measured once with onLayout, never per frame.
 */
function Segments({ value, onChange }: { value: Segment; onChange: (segment: Segment) => void }): ReactNode {
  const styles = useStyles(createStyles);
  const [layouts, setLayouts] = useState<Partial<Record<Segment, { x: number; width: number }>>>({});
  const x = useSharedValue(0);
  const width = useSharedValue(0);
  const placed = useRef(false);
  useEffect(() => {
    const layout = layouts[value];
    if (layout === undefined) return;
    if (!placed.current) {
      // The first measure puts the pill in place; only a change of segment slides it.
      placed.current = true;
      x.set(layout.x);
      width.set(layout.width);
      return;
    }
    x.set(withTiming(layout.x, QUICK));
    width.set(withTiming(layout.width, QUICK));
  }, [layouts, value, width, x]);
  const pill = useAnimatedStyle(() => ({ width: width.get(), transform: [{ translateX: x.get() }] }));
  const measure = (key: Segment) => (event: LayoutChangeEvent) => {
    const { x: at, width: w } = event.nativeEvent.layout;
    setLayouts((current) => (current[key]?.x === at && current[key]?.width === w ? current : { ...current, [key]: { x: at, width: w } }));
  };
  return (
    <View style={styles.segments} accessibilityRole="tablist">
      {layouts[value] !== undefined ? <Reanimated.View style={[styles.segmentPill, pill]} pointerEvents="none" /> : null}
      {SEGMENTS.map((key) => (
        <Pressable
          key={key}
          onLayout={measure(key)}
          onPress={() => {
            // On the press, in the same frame the pill starts to move.
            if (key !== value) haptic.select();
            onChange(key);
          }}
          style={styles.segment}
          accessibilityRole="tab"
          accessibilityState={{ selected: key === value }}
        >
          <Text style={key === value ? styles.segmentTextOn : styles.segmentText}>{t(`home.segment.${key}`)}</Text>
        </Pressable>
      ))}
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
    // The computer's state under its large title: why it is down, what runs, or that it is online.
    status: { flexDirection: "row", alignItems: "center", gap: 7, marginTop: 2, minWidth: 0 },
    statusText: { flexShrink: 1, fontFamily: SANS, fontSize: 15, lineHeight: 20, color: c.fgFaint },
    statusDown: { flexShrink: 1, fontFamily: SANS, fontSize: 15, lineHeight: 20, color: c.err },
    search: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      height: 38,
      borderRadius: 11,
      borderWidth: 1,
      borderColor: "transparent",
      paddingHorizontal: 10,
      marginHorizontal: 16,
      marginBottom: 12,
      backgroundColor: c.search,
      // Focus shows as a ring easing in, not a hard swap (QUICK's curve and length).
      transitionProperty: "borderColor",
      ...QUICK_CSS,
    },
    searchFocused: { borderColor: c.ring },
    searchInput: { flex: 1, height: 38, paddingVertical: 0, fontFamily: SANS, fontSize: 16, color: c.fg },
    clear: { width: 16, height: 16, borderRadius: 8, alignItems: "center", justifyContent: "center", backgroundColor: c.fgFaint },
    segments: { flexDirection: "row", padding: 2, borderRadius: 9, marginHorizontal: 16, marginBottom: 16, backgroundColor: c.search },
    segment,
    segmentPill: {
      position: "absolute",
      top: 2,
      bottom: 2,
      left: 0,
      borderRadius: 7,
      backgroundColor: c.segment,
      elevation: 2,
      shadowColor: "#000000",
      shadowOpacity: 0.25,
      shadowRadius: 4,
      shadowOffset: { width: 0, height: 2 },
    },
    segmentText: { ...segmentText, color: c.fgMuted },
    segmentTextOn: { ...segmentText, fontWeight: "600" },
    bannerWrap: { marginBottom: 12, marginHorizontal: 16, borderRadius: radius.md, overflow: "hidden" },
    results: { marginHorizontal: 16, borderRadius: 14, overflow: "hidden", backgroundColor: c.group },
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
    recent: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: -4 },
    recentChip: chip,
    recentChipOn: { ...chip, borderColor: c.accent, backgroundColor: c.accentMuted },
    recentText: chipText,
    recentTextOn: { ...chipText, color: c.fg },
    error: { fontFamily: MONO, fontSize: 12, lineHeight: 17, color: c.err, marginHorizontal: 2 },
    actionsBody: { fontFamily: SANS, fontSize: 14, lineHeight: 20, color: c.fgMuted, marginTop: -4 },
  } as const;
}
