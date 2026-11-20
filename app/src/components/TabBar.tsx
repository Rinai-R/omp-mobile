import type { ReactNode } from "react";
import { Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { haptic } from "../haptics";
import { t } from "../i18n/index.ts";
import { SANS, useColors, useStyles, type Palette } from "../theme";
import { ChatGlyph, ComputerGlyph, SettingsGlyph } from "./icons";
import { EdgeFade } from "./EdgeFade";
import { PressableScale } from "./ui";

/** The app's three root tabs: one bar under all of them, so moving between them never leaves the shell. */
export type Tab = "sessions" | "computers" | "settings";

/** The tab bar's height above the home indicator: screens pad their content and floating buttons by it. */
export const TAB_BAR_HEIGHT = 58;

const TABS: readonly { tab: Tab; label: () => string; icon: (color: string) => ReactNode }[] = [
  { tab: "sessions", label: () => t("home.tab.sessions"), icon: (color) => <ChatGlyph size={24} color={color} /> },
  { tab: "computers", label: () => t("home.tab.computers"), icon: (color) => <ComputerGlyph size={24} color={color} /> },
  { tab: "settings", label: () => t("common.settings"), icon: (color) => <SettingsGlyph size={24} color={color} /> },
];

/** The bottom tab bar, on the page's own colour; `badge` counts sessions waiting for an answer, on the Sessions tab. */
export function TabBar({ current, badge, onSelect }: { current: Tab; badge: number; onSelect: (tab: Tab) => void }): ReactNode {
  const styles = useStyles(createStyles);
  const colors = useColors();
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.bar, { paddingBottom: 8 + insets.bottom }]} accessibilityRole="tablist">
      {/*
        The lists under it scroll in screens that do not report their offset here: a constant fade, which
        shows only where rows pass under the bar (it is the page's colour, so over empty page it is invisible).
      */}
      <EdgeFade chrome="below" opacity={0.85} style={styles.fade} />
      {TABS.map(({ tab, label, icon }) => {
        const on = tab === current;
        return (
          // Press feedback only: switching tabs itself never animates (peers, not depth).
          <PressableScale
            key={tab}
            onPress={() => {
              if (!on) haptic.select();
              onSelect(tab);
            }}
            // A small icon and label: a deeper sink than a row so it reads at this size.
            scale={0.92}
            style={styles.tab}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            accessibilityLabel={label()}
          >
            {icon(on ? colors.tint : colors.fgFaint)}
            <Text style={on ? styles.textOn : styles.text}>{label()}</Text>
            {tab === "sessions" && badge > 0 ? (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{badge}</Text>
              </View>
            ) : null}
          </PressableScale>
        );
      })}
    </View>
  );
}

/** A root tab's large title, with actions at its right, as the Sessions tab sets it. */
export function LargeTitle({ title, right }: { title: string; right?: ReactNode }): ReactNode {
  const styles = useStyles(createStyles);
  return (
    <View style={styles.titleRow}>
      <Text style={styles.title} accessibilityRole="header" numberOfLines={1}>
        {title}
      </Text>
      {right !== undefined ? <View style={styles.titleRight}>{right}</View> : null}
    </View>
  );
}

function createStyles(c: Palette) {
  const text = { fontFamily: SANS, fontSize: 10.5, lineHeight: 13, fontWeight: "500", color: c.fgFaint } as const;
  return {
    bar: {
      position: "absolute",
      left: 0,
      right: 0,
      bottom: 0,
      flexDirection: "row",
      justifyContent: "space-around",
      paddingTop: 8,
      backgroundColor: c.bg,
    },
    fade: { bottom: "100%" },
    tab: { minWidth: 72, alignItems: "center", gap: 3 },
    text,
    textOn: { ...text, color: c.tint },
    badge: { position: "absolute", top: -4, left: 42, minWidth: 18, height: 18, paddingHorizontal: 5, borderRadius: 9, alignItems: "center", justifyContent: "center", backgroundColor: c.badge },
    badgeText: { fontFamily: SANS, fontSize: 11, lineHeight: 14, fontWeight: "600", color: "#ffffff" },
    titleRow: { flexDirection: "row", alignItems: "center", minHeight: 44, paddingHorizontal: 20, paddingTop: 14, marginBottom: 14 },
    title: { flex: 1, fontFamily: SANS, fontSize: 28, lineHeight: 34, fontWeight: "600", letterSpacing: -0.7, color: c.fg },
    titleRight: { flexDirection: "row", alignItems: "center", gap: 4 },
  } as const;
}
