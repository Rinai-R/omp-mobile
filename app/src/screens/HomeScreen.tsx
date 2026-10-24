import { useCallback, useMemo, useState, type ReactNode } from "react";
import { Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { createSession, deleteSession } from "../api";
import { GradientFill, LiveDot, PulseDot, Wordmark } from "../components/brand";
import { ChatGlyph, ChevronDownGlyph, ComputerGlyph, PlusGlyph, SettingsGlyph } from "../components/icons";
import { SessionGroups, useMachineSessions } from "../components/SessionList";
import { displayName } from "../machines";
import { Banner, Button, Field, IconButton, Sheet } from "../components/ui";
import { reasonText, type Probe } from "../probe";
import { hostOf } from "../machines";
import { attentionCount, folderOf, groupSessions } from "../sessionGroups";
import { MONO, SANS, radius, useColors, useStyles, type Palette } from "../theme";
import { dropTranscript } from "../transcripts";
import { t } from "../i18n/index.ts";
import type { Machine, SessionSummary } from "../types";

interface Props {
  machine: Machine;
  probe: Probe | undefined;
  onOpen: (machine: Machine, session: SessionSummary) => void;
  /** Open the computer picker (the computer card). */
  onPickMachine: () => void;
  onSettings: () => void;
  onRetry: (machine: Machine) => void;
  /** Ask the home to open the New session sheet (from the switcher); a changing nonce opens it again. */
  newRequest: number;
}

function osName(os: string): string {
  if (os === "darwin") return "macOS";
  if (os === "win32") return "Windows";
  if (os === "linux") return "Linux";
  return os;
}

/** The app's home: the sessions of the computer used last, grouped by what needs attention. */
export function HomeScreen({ machine, probe, onOpen, onPickMachine, onSettings, onRetry, newRequest }: Props): ReactNode {
  const styles = useStyles(createStyles);
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { sessions, loading, error, refresh, setSessions } = useMachineSessions(machine);
  const [creating, setCreating] = useState(false);
  const [cwd, setCwd] = useState("");
  const [busy, setBusy] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
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

  const groups = useMemo(() => groupSessions(sessions ?? []), [sessions]);
  const counts = useMemo(() => attentionCount(sessions ?? []), [sessions]);
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
  const detail = down
    ? t("home.unreachable", { reason: reasonText(probe.reason) })
    : [osName(machine.os), hostOf(machine.url), counts.running > 0 ? t("common.running", { count: counts.running }) : undefined]
        .filter(Boolean)
        .join(" · ");

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

  const confirmDelete = useCallback(
    (session: SessionSummary) => {
      if (session.origin !== "daemon") return;
      Alert.alert(t("home.close.title", { title: session.title }), t("home.close.body"), [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("home.close.action"),
          style: "destructive",
          onPress: () => {
            void deleteSession(machine, session.id)
              .then(() => {
                dropTranscript(machine.id, session.id);
                setSessions((current) => (current ?? []).filter((item) => item.id !== session.id));
              })
              .catch((cause: unknown) => Alert.alert(t("home.close.failed"), cause instanceof Error ? cause.message : String(cause)));
          },
        },
      ]);
    },
    [machine, setSessions],
  );

  const openCreate = useCallback(() => {
    setCwd("");
    setCreateError(null);
    setCreating(true);
  }, []);

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Wordmark />
        <View style={styles.headerRight}>
          <IconButton onPress={onSettings} label={t("common.settings")}>
            <SettingsGlyph size={21} color={colors.fgMuted} />
          </IconButton>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: 112 + insets.bottom }]}
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
        <Pressable
          onPress={onPickMachine}
          style={({ pressed }) => [styles.machine, pressed && styles.machinePressed]}
          accessibilityRole="button"
          accessibilityLabel={t("home.machineA11y", { name: machine.name, detail })}
        >
          <View style={styles.machineTile}>
            <ComputerGlyph size={18} color={down ? colors.fgGhost : colors.fgMuted} />
          </View>
          <View style={styles.machineText}>
            <Text style={styles.machineName} numberOfLines={1}>
              {displayName(machine)}
            </Text>
            <Text style={down ? styles.machineDetailDown : styles.machineDetail} numberOfLines={1}>
              {detail}
            </Text>
          </View>
          {down ? (
            <LiveDot color={colors.err} size={8} />
          ) : reachable ? (
            <LiveDot color={colors.ok} size={8} ping={counts.running > 0} />
          ) : (
            <PulseDot color={colors.warn} size={8} />
          )}
          {counts.waiting > 0 ? (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{counts.waiting}</Text>
            </View>
          ) : null}
          <ChevronDownGlyph size={15} color={colors.fgGhost} />
        </Pressable>

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
            <Text style={styles.emptyTitle}>{t("home.empty.title")}</Text>
            <Text style={styles.emptyBody}>{t("home.empty.body", { name: displayName(machine) })}</Text>
          </View>
        ) : (
          <SessionGroups groups={groups} onPress={(session) => onOpen(machine, session)} onLongPress={confirmDelete} />
        )}
      </ScrollView>

      <Pressable
        onPress={openCreate}
        style={({ pressed }) => [styles.fab, { bottom: 20 + insets.bottom }, pressed && styles.fabPressed]}
        accessibilityRole="button"
        accessibilityLabel={t("home.new")}
      >
        <GradientFill />
        <PlusGlyph size={19} color="#ffffff" />
        <Text style={styles.fabText}>{t("home.new")}</Text>
      </Pressable>

      <Sheet visible={creating} title={t("home.new")} onClose={() => setCreating(false)}>
        <Text style={styles.hint}>{t("home.newSheet.hint", { name: displayName(machine) })}</Text>
        <Field label={t("home.newSheet.cwd")} value={cwd} onChangeText={setCwd} placeholder={machine.cwd} />
        {recent.length > 0 ? (
          <View style={styles.recent}>
            {recent.map((path) => (
              <Pressable
                key={path}
                onPress={() => setCwd(path)}
                style={({ pressed }) => [cwd === path ? styles.recentChipOn : styles.recentChip, pressed && styles.machinePressed]}
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
    </View>
  );
}

function createStyles(c: Palette) {
  const machineDetail = { fontFamily: MONO, fontSize: 11, lineHeight: 15, color: c.fgFaint } as const;
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
  return {
    root: { flex: 1, backgroundColor: c.bg },
    header: { height: 60, flexDirection: "row", alignItems: "center", paddingLeft: 18, paddingRight: 8 },
    headerRight: { marginLeft: "auto", flexDirection: "row", alignItems: "center" },
    content: { width: "100%", maxWidth: 640, alignSelf: "center", paddingTop: 4 },
    machine: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      marginHorizontal: 12,
      paddingVertical: 12,
      paddingLeft: 12,
      paddingRight: 14,
      borderRadius: radius.xl,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
      backgroundColor: c.panel,
    },
    machinePressed: { opacity: 0.75 },
    machineTile: { width: 38, height: 38, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: c.well },
    machineText: { flex: 1, minWidth: 0, gap: 3 },
    machineName: { fontFamily: SANS, fontSize: 16, lineHeight: 21, fontWeight: "600", letterSpacing: -0.25, color: c.fg },
    machineDetail,
    machineDetailDown: { ...machineDetail, color: c.err },
    badge: { minWidth: 18, height: 18, paddingHorizontal: 5, borderRadius: 9, alignItems: "center", justifyContent: "center", backgroundColor: c.accent },
    badgeText: { fontFamily: MONO, fontSize: 10.5, lineHeight: 13, fontWeight: "600", color: "#ffffff" },
    bannerWrap: { marginTop: 12, marginHorizontal: 12, borderRadius: radius.md, overflow: "hidden" },
    skeleton: { marginTop: 40, marginHorizontal: 12, gap: 10 },
    skeletonRow: { height: 62, borderRadius: radius.xl, backgroundColor: c.panel, opacity: 0.6 },
    empty: { alignItems: "center", paddingHorizontal: 36, paddingTop: 72 },
    emptyTile: {
      width: 52,
      height: 52,
      borderRadius: 16,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: c.panel,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
    },
    emptyTitle: { fontFamily: SANS, fontSize: 17, lineHeight: 22, fontWeight: "600", letterSpacing: -0.3, color: c.fg, marginTop: 16, textAlign: "center" },
    emptyBody: { fontFamily: SANS, fontSize: 14, lineHeight: 20, color: c.fgFaint, marginTop: 6, textAlign: "center" },
    emptyAction: { marginTop: 18, minWidth: 180 },
    fab: {
      position: "absolute",
      right: 18,
      height: 54,
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      paddingHorizontal: 20,
      borderRadius: 18,
      overflow: "hidden",
      elevation: 10,
      shadowColor: c.accent,
      shadowOpacity: 0.45,
      shadowRadius: 18,
      shadowOffset: { width: 0, height: 8 },
    },
    fabPressed: { transform: [{ scale: 0.97 }] },
    fabText: { fontFamily: SANS, fontSize: 15.5, lineHeight: 20, fontWeight: "600", color: "#ffffff" },
    hint: { fontFamily: SANS, fontSize: 13.5, lineHeight: 19, color: c.fgFaint, marginHorizontal: 2 },
    recent: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: -4 },
    recentChip: chip,
    recentChipOn: { ...chip, borderColor: c.accent, backgroundColor: c.accentMuted },
    recentText: chipText,
    recentTextOn: { ...chipText, color: c.fg },
    error: { fontFamily: MONO, fontSize: 12, lineHeight: 17, color: c.err, marginHorizontal: 2 },
  } as const;
}
