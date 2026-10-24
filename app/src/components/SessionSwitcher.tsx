import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  Animated,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { machineLabel } from "../machines";
import { summaryOf, type Probe } from "../probe";
import { attentionCount, groupSessions } from "../sessionGroups";
import { MONO, SANS, radius, useColors, useStyles, type Palette } from "../theme";
import type { Machine, SessionSummary } from "../types";
import { t } from "../i18n/index.ts";
import { LiveDot } from "./brand";
import { CloseGlyph, PlusGlyph, SearchGlyph } from "./icons";
import { SessionGroups, useMachineSessions } from "./SessionList";
import { sheetTransforms, useSheetMotion } from "./ui";

interface Props {
  visible: boolean;
  machines: readonly Machine[];
  probes: ReadonlyMap<string, Probe>;
  /** The machine and session on screen, if any: its machine's tab opens first and the row is marked. */
  machine: Machine | undefined;
  currentSessionId?: string;
  onPick: (machine: Machine, session: SessionSummary) => void;
  onNew: (machine: Machine) => void;
  onClose: () => void;
}

/**
 * Every session on every paired computer, one tap from any chat: search,
 * a tab per computer, the same groups as the home screen.
 */
export function SessionSwitcher({ visible, machines, probes, machine, currentSessionId, onPick, onNew, onClose }: Props): ReactNode {
  const styles = useStyles(createStyles);
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const { mounted, progress } = useSheetMotion(visible);
  const motion = sheetTransforms(progress, height);
  const [tab, setTab] = useState<string | undefined>(machine?.id);
  const [query, setQuery] = useState("");
  // Each opening starts on the machine on screen, with an empty search.
  useEffect(() => {
    if (!visible) return;
    setTab(machine?.id ?? machines[0]?.id);
    setQuery("");
  }, [machine?.id, machines, visible]);
  const selected = machines.find((item) => item.id === tab) ?? machine ?? machines[0];
  const { sessions, loading, error } = useMachineSessions(selected, visible);
  const groups = useMemo(() => groupSessions(sessions ?? [], Date.now(), query), [query, sessions]);
  const counts = useMemo(() => attentionCount(sessions ?? []), [sessions]);

  return (
    <Modal visible={mounted} transparent animationType="none" statusBarTranslucent onRequestClose={onClose}>
      <View style={styles.root}>
        <Animated.View style={[styles.scrim, motion.backdrop]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel={t("common.close")} />
        </Animated.View>
        <Animated.View style={[styles.sheet, { height: Math.min(height * 0.88, height - insets.top - 24), paddingBottom: insets.bottom }, motion.sheet]}>
          <View style={styles.grab} />
          <View style={styles.head}>
            <Text style={styles.title} accessibilityRole="header">
              {t("sessions.title")}
            </Text>
            {selected !== undefined ? (
              <Pressable
                onPress={() => onNew(selected)}
                style={({ pressed }) => [styles.newButton, pressed && styles.pressed]}
                accessibilityRole="button"
                accessibilityLabel={t("sessions.newOn", { name: selected.name })}
              >
                <PlusGlyph size={15} color={colors.bg} />
                <Text style={styles.newText}>{t("sessions.new")}</Text>
              </Pressable>
            ) : null}
          </View>
          <View style={styles.search}>
            <SearchGlyph size={15} color={colors.fgGhost} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder={t("sessions.search")}
              placeholderTextColor={colors.fgGhost}
              selectionColor={colors.ring}
              cursorColor={colors.accent}
              style={styles.searchInput}
              autoCorrect={false}
              autoCapitalize="none"
              returnKeyType="search"
            />
            {query !== "" ? (
              <Pressable onPress={() => setQuery("")} hitSlop={10} accessibilityRole="button" accessibilityLabel={t("sessions.clearSearch")}>
                <CloseGlyph size={13} color={colors.fgFaint} />
              </Pressable>
            ) : null}
          </View>
          {machines.length > 1 ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabs} style={styles.tabsScroll}>
              {machines.map((item) => {
                const on = item.id === selected?.id;
                const dot = summaryOf(probes.get(item.id), item.lastSeen, Date.now()).dot;
                return (
                  <Pressable
                    key={item.id}
                    onPress={() => setTab(item.id)}
                    style={({ pressed }) => [on ? styles.tabOn : styles.tab, pressed && styles.pressed]}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: on }}
                    accessibilityLabel={item.name}
                  >
                    <LiveDot color={dot === "online" ? colors.ok : dot === "down" ? colors.fgGhost : colors.warn} size={7} />
                    <Text style={on ? styles.tabTextOn : styles.tabText} numberOfLines={1}>
                      {machineLabel(item, machines)}
                    </Text>
                    {on && counts.waiting > 0 ? (
                      <View style={styles.badge}>
                        <Text style={styles.badgeText}>{counts.waiting}</Text>
                      </View>
                    ) : null}
                  </Pressable>
                );
              })}
            </ScrollView>
          ) : null}
          <ScrollView style={styles.list} contentContainerStyle={styles.listContent} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
            {sessions === undefined ? (
              <View style={styles.center}>
                {error !== null ? <Text style={styles.error}>{error}</Text> : <ActivityIndicator color={colors.fgFaint} />}
              </View>
            ) : groups.length === 0 ? (
              <View style={styles.center}>
                <Text style={styles.emptyText}>{query !== "" ? t("sessions.noMatch") : t("sessions.none")}</Text>
              </View>
            ) : (
              <SessionGroups
                groups={groups}
                flat
                currentId={selected?.id === machine?.id ? currentSessionId : undefined}
                onPress={(session) => {
                  if (selected !== undefined) onPick(selected, session);
                }}
              />
            )}
            {loading && sessions !== undefined ? <ActivityIndicator style={styles.refreshing} size="small" color={colors.fgGhost} /> : null}
          </ScrollView>
        </Animated.View>
      </View>
    </Modal>
  );
}

export { shortName } from "../machines";

function createStyles(c: Palette) {
  const tab = {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    height: 34,
    paddingHorizontal: 12,
    borderRadius: radius.md + 2,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: c.border,
  } as const;
  const tabText = { fontFamily: SANS, fontSize: 13, lineHeight: 17, color: c.fgMuted, maxWidth: 260 } as const;
  return {
    root: { flex: 1, justifyContent: "flex-end" },
    scrim: { ...StyleSheet.absoluteFill, backgroundColor: c.backdrop },
    sheet: {
      width: "100%",
      maxWidth: 640,
      alignSelf: "center",
      borderTopLeftRadius: 26,
      borderTopRightRadius: 26,
      borderWidth: StyleSheet.hairlineWidth,
      borderBottomWidth: 0,
      borderColor: c.borderStrong,
      backgroundColor: c.overlay,
      overflow: "hidden",
    },
    grab: { alignSelf: "center", width: 38, height: 5, borderRadius: 3, backgroundColor: c.borderStrong, marginTop: 8, marginBottom: 4 },
    head: { flexDirection: "row", alignItems: "center", paddingHorizontal: 18, paddingTop: 6, paddingBottom: 12 },
    title: { flex: 1, fontFamily: SANS, fontSize: 21, lineHeight: 27, fontWeight: "600", letterSpacing: -0.5, color: c.fg },
    newButton: { flexDirection: "row", alignItems: "center", gap: 6, height: 34, paddingHorizontal: 14, borderRadius: radius.pill, backgroundColor: c.fg },
    newText: { fontFamily: SANS, fontSize: 13.5, lineHeight: 17, fontWeight: "600", color: c.bg },
    pressed: { opacity: 0.7 },
    search: {
      flexDirection: "row",
      alignItems: "center",
      gap: 9,
      height: 42,
      marginHorizontal: 16,
      marginBottom: 12,
      paddingHorizontal: 13,
      borderRadius: radius.md + 2,
      backgroundColor: c.well,
    },
    searchInput: { flex: 1, paddingVertical: 0, fontFamily: SANS, fontSize: 15, color: c.fg },
    tabsScroll: { flexGrow: 0 },
    tabs: { gap: 8, paddingHorizontal: 16, paddingBottom: 4 },
    tab,
    tabOn: { ...tab, borderColor: c.borderStrong, backgroundColor: c.well },
    tabText,
    tabTextOn: { ...tabText, color: c.fg },
    badge: { minWidth: 17, height: 17, paddingHorizontal: 4, borderRadius: 9, alignItems: "center", justifyContent: "center", backgroundColor: c.accent },
    badgeText: { fontFamily: MONO, fontSize: 10, lineHeight: 13, fontWeight: "600", color: "#ffffff" },
    list: { flex: 1 },
    listContent: { paddingBottom: 24 },
    center: { paddingVertical: 48, alignItems: "center", paddingHorizontal: 32 },
    emptyText: { fontFamily: SANS, fontSize: 14, lineHeight: 20, color: c.fgFaint, textAlign: "center" },
    error: { fontFamily: MONO, fontSize: 12, lineHeight: 18, color: c.err, textAlign: "center" },
    refreshing: { marginTop: 12 },
  } as const;
}
