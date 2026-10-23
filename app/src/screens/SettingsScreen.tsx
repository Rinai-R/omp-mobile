import type { ReactNode } from "react";
import { ScrollView, Switch, View } from "react-native";
import { Button, Group, Header, Row, SectionHeader } from "../components/ui";
import { useColors, useStyles, type Palette } from "../theme";

/**
 * Background notifications as the phone allows them: on, off, refused by the
 * system (permission or the app's switch), or not available (iOS).
 */
export type NotificationState = "on" | "off" | "denied" | "unsupported";

interface Props {
  notifications: NotificationState;
  /** Android may stop the background connection to save battery. */
  batteryRestricted: boolean;
  onToggleNotifications: (on: boolean) => void;
  onOpenNotificationSettings: () => void;
  onFixBattery: () => void;
  onBack: () => void;
  version: string;
}

const DETAIL: Record<NotificationState, string> = {
  on: "Approvals, questions and finished turns arrive while OMP is in the background. A quiet notification shows while it watches your machines.",
  off: "Approvals and finished turns appear only while a chat is open.",
  denied: "Android is blocking notifications for OMP. Allow them in system settings, then turn this on.",
  unsupported: "Background notifications need the Android app. On this device they appear only in the open chat.",
};

export function SettingsScreen({
  notifications,
  batteryRestricted,
  onToggleNotifications,
  onOpenNotificationSettings,
  onFixBattery,
  onBack,
  version,
}: Props): ReactNode {
  const styles = useStyles(createStyles);
  const colors = useColors();
  const showBattery = notifications === "on" && batteryRestricted;
  return (
    <View style={styles.root}>
      <Header title="Settings" onBack={onBack} />
      <ScrollView contentContainerStyle={styles.content}>
        <SectionHeader title="Notifications" />
        <Group>
          <Row
            title="Notifications"
            detail={DETAIL[notifications]}
            last={notifications !== "denied" && !showBattery}
            trailing={
              <Switch
                value={notifications === "on"}
                disabled={notifications === "unsupported"}
                onValueChange={onToggleNotifications}
                trackColor={{ false: colors.selected, true: colors.accent }}
                thumbColor="#ffffff"
                ios_backgroundColor={colors.selected}
                accessibilityLabel="Background notifications"
              />
            }
          />
          {notifications === "denied" ? (
            <View style={styles.action}>
              <Button label="Open notification settings" kind="plain" onPress={onOpenNotificationSettings} />
            </View>
          ) : null}
          {showBattery ? (
            <>
              <Row
                title="Battery optimization is on"
                detail="Android may stop the background connection to save battery; notifications then arrive late or not at all."
                last
              />
              <View style={styles.action}>
                <Button label="Allow background use" kind="plain" onPress={onFixBattery} />
              </View>
            </>
          ) : null}
        </Group>

        <SectionHeader title="About" />
        <Group>
          <Row title="OMP mobile" detail="Native control for OMP sessions over Tailscale." />
          <Row title="Version" detail={version} mono last />
        </Group>
      </ScrollView>
    </View>
  );
}

function createStyles(c: Palette) {
  return {
    root: { flex: 1, backgroundColor: c.bg },
    content: { width: "100%", maxWidth: 600, alignSelf: "center", paddingHorizontal: 12, paddingBottom: 32 },
    action: { paddingHorizontal: 12, paddingBottom: 12 },
  } as const;
}
