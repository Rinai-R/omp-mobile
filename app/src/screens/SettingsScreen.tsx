import type { ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { radius, type, useColors } from "../theme";
import type { Settings } from "../storage";

interface Props {
  settings: Settings;
  onChange: (settings: Settings) => void;
  onBack: () => void;
  version: string;
}

export function SettingsScreen({ settings, onChange, onBack, version }: Props): ReactNode {
  const colors = useColors();
  const styles = useStyles(colors);
  return (
    <View style={[styles.root, { backgroundColor: colors.bg }]}>
      <View style={styles.header}>
        <Pressable onPress={onBack} hitSlop={12} accessibilityRole="button" accessibilityLabel="Back">
          <Text style={{ color: colors.textSecondary, fontSize: 28, marginTop: -4 }}>‹</Text>
        </Pressable>
        <Text style={[type.heading, { color: colors.text }]}>Settings</Text>
      </View>
      <ScrollView contentContainerStyle={styles.body}>
        <Text style={[type.small, { color: colors.textTertiary, textTransform: "uppercase", letterSpacing: 0.8 }]}>
          Notifications
        </Text>
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={{ flex: 1, gap: 3 }}>
            <Text style={[type.body, { color: colors.text }]}>In-chat only for now</Text>
            <Text style={[type.small, { color: colors.textSecondary }]}>
              Approvals and finished turns appear in the chat. Background notifications need the Android
              foreground service, which is not in v0.1.
            </Text>
          </View>
        </View>

        <Text style={[type.small, { color: colors.textTertiary, textTransform: "uppercase", letterSpacing: 0.8, marginTop: 26 }]}>
          About
        </Text>
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={{ flex: 1, gap: 3 }}>
            <Text style={[type.body, { color: colors.text }]}>OMP mobile</Text>
            <Text style={[type.small, { color: colors.textSecondary }]}>
              Native control for OMP sessions over Tailscale. Version {version}.
            </Text>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

function useStyles(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    root: { flex: 1 },
    header: {
      flexDirection: "row",
      alignItems: "center",
      gap: 14,
      paddingHorizontal: 20,
      paddingTop: 16,
      paddingBottom: 14,
    },
    body: { paddingHorizontal: 20, paddingBottom: 40, gap: 10 },
    card: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      padding: 14,
      borderRadius: radius.lg,
      borderWidth: StyleSheet.hairlineWidth,
    },
  });
}
