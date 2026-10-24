import type { ReactNode } from "react";
import { ScrollView, Switch, View } from "react-native";
import { CheckGlyph } from "../components/icons";
import { Button, Group, Header, Row, SectionHeader } from "../components/ui";
import { t, type Key, type LanguagePreference } from "../i18n/index.ts";
import { useColors, useStyles, type Palette } from "../theme";

/**
 * Background notifications as the phone allows them: on, off, refused by the
 * system (permission or the app's switch), or not available (iOS).
 */
export type NotificationState = "on" | "off" | "denied" | "unsupported";

interface Props {
  notifications: NotificationState;
  language: LanguagePreference;
  onLanguage: (language: LanguagePreference) => void;
  /** Android may stop the background connection to save battery. */
  batteryRestricted: boolean;
  onToggleNotifications: (on: boolean) => void;
  onOpenNotificationSettings: () => void;
  onFixBattery: () => void;
  onBack: () => void;
  version: string;
}

const DETAIL: Record<NotificationState, Key> = {
  on: "settings.notifications.on",
  off: "settings.notifications.off",
  denied: "settings.notifications.denied",
  unsupported: "settings.notifications.unsupported",
};

/** Each language under its own name, the same in every language. */
const LANGUAGE_NAMES = { en: "English", "zh-CN": "中文" } as const;
const LANGUAGE_CHOICES: readonly LanguagePreference[] = ["system", "zh-CN", "en"];

export function SettingsScreen({
  notifications,
  language,
  onLanguage,
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
      <Header title={t("settings.title")} onBack={onBack} />
      <ScrollView contentContainerStyle={styles.content}>
        <SectionHeader title={t("settings.notifications.section")} />
        <Group>
          <Row
            title={t("settings.notifications.title")}
            detail={t(DETAIL[notifications])}
            last={notifications !== "denied" && !showBattery}
            trailing={
              <Switch
                value={notifications === "on"}
                disabled={notifications === "unsupported"}
                onValueChange={onToggleNotifications}
                trackColor={{ false: colors.selected, true: colors.accent }}
                thumbColor="#ffffff"
                ios_backgroundColor={colors.selected}
                accessibilityLabel={t("settings.notifications.a11y")}
              />
            }
          />
          {notifications === "denied" ? (
            <View style={styles.action}>
              <Button label={t("settings.notifications.openSystem")} kind="plain" onPress={onOpenNotificationSettings} />
            </View>
          ) : null}
          {showBattery ? (
            <>
              <Row
                title={t("settings.battery.title")}
                detail={t("settings.battery.detail")}
                last
              />
              <View style={styles.action}>
                <Button label={t("settings.battery.fix")} kind="plain" onPress={onFixBattery} />
              </View>
            </>
          ) : null}
        </Group>

        <SectionHeader title={t("settings.language.section")} />
        <Group>
          {LANGUAGE_CHOICES.map((choice, index) => (
            <Row
              key={choice}
              title={choice === "system" ? t("settings.language.system") : LANGUAGE_NAMES[choice]}
              trailing={choice === language ? <CheckGlyph size={16} color={colors.accent} /> : undefined}
              chevron={false}
              selected={choice === language}
              last={index === LANGUAGE_CHOICES.length - 1}
              onPress={() => onLanguage(choice)}
            />
          ))}
        </Group>

        <SectionHeader title={t("settings.about.section")} />
        <Group>
          <Row title={t("settings.about.app")} detail={t("settings.about.detail")} />
          <Row title={t("settings.about.version")} detail={version} mono last />
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
