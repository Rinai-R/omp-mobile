import type { ReactNode } from "react";
import { Text, View } from "react-native";
import type { SharedValue } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { t } from "../i18n/index.ts";
import { SANS, useColors, useStyles, type Palette } from "../theme";
import { Glass } from "./Glass";
import { ChatGlyph, ComputerGlyph, SettingsGlyph } from "./icons";
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

/**
 * The bottom tab bar, glass over the current tab's page; `badge` counts sessions waiting for an answer, on the Sessions tab.
 * @param under - how much of the current tab's content runs on under the bar.
 */
export function TabBar({
  current,
  badge,
  onSelect,
  under,
}: {
  current: Tab;
  badge: number;
  onSelect: (tab: Tab) => void;
  under: SharedValue<number>;
}): ReactNode {
  const styles = useStyles(createStyles);
  const colors = useColors();
  const insets = useSafeAreaInsets();
  return (
    <Glass edge="top" under={under} style={[styles.bar, { paddingBottom: 8 + insets.bottom }]} accessibilityRole="tablist">
      {TABS.map(({ tab, label, icon }) => {
        const on = tab === current;
        return (
          // Press feedback only: switching tabs itself never animates (peers, not depth).
          <PressableScale
            key={tab}
            onPress={() => onSelect(tab)}
            // A small icon and label: a deeper sink than a row so it reads at this size.
            scale={0.92}
            style={styles.tab}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            accessibilityLabel={label()}
          >
            {/* Over glass the resting tabs take the muted ink, not the faint one: they stay legible over any row. */}
            {icon(on ? colors.tint : colors.fgMuted)}
            <Text style={on ? styles.textOn : styles.text}>{label()}</Text>
            {tab === "sessions" && badge > 0 ? (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{badge}</Text>
              </View>
            ) : null}
          </PressableScale>
        );
      })}
    </Glass>
  );
}

function createStyles(c: Palette) {
  const text = { fontFamily: SANS, fontSize: 10.5, lineHeight: 13, fontWeight: "500", color: c.fgMuted } as const;
  return {
    bar: {
      position: "absolute",
      left: 0,
      right: 0,
      bottom: 0,
      flexDirection: "row",
      justifyContent: "space-around",
      paddingTop: 8,
    },
    tab: { minWidth: 72, alignItems: "center", gap: 3 },
    text,
    textOn: { ...text, color: c.tint },
    badge: { position: "absolute", top: -4, left: 42, minWidth: 18, height: 18, paddingHorizontal: 5, borderRadius: 9, alignItems: "center", justifyContent: "center", backgroundColor: c.badge },
    badgeText: { fontFamily: SANS, fontSize: 11, lineHeight: 14, fontWeight: "600", color: "#ffffff" },
  } as const;
}
