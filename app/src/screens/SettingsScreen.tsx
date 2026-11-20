import type { ReactNode, RefObject } from "react";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Switch, Text, View } from "react-native";
import Reanimated, { type SharedValue } from "react-native-reanimated";
import { BackGlyph, CheckGlyph } from "../components/icons";
import { GlassTarget, useBlurTarget } from "../components/Glass";
import { LargeTitle, PageBar, usePageScroll, usePageTop } from "../components/LargeTitle";
import { TAB_BAR_HEIGHT } from "../components/TabBar";
import { Button, Group, IconButton, Row, SectionHeader } from "../components/ui";
import { t, type LanguagePreference } from "../i18n/index.ts";
import type { AppearancePreference } from "../storage";
import { MONO, useColors, useStyles, type Palette } from "../theme";

/**
 * Background notifications as the phone allows them: on, off, refused by the
 * system (permission or the app's switch), or not available (iOS).
 */
export type NotificationState = "on" | "off" | "denied" | "unsupported";

/** Whether the live activity is promoted to an Android 16 Live Update: allowed, not yet allowed, or an older Android. */
export type LiveState = "on" | "off" | "unsupported";

interface Props {
  notifications: NotificationState;
  language: LanguagePreference;
  onLanguage: (language: LanguagePreference) => void;
  appearance: AppearancePreference;
  onAppearance: (appearance: AppearancePreference) => void;
  /** Android may stop the background connection to save battery. */
  batteryRestricted: boolean;
  onToggleNotifications: (on: boolean) => void;
  onOpenNotificationSettings: () => void;
  onFixBattery: () => void;
  live: LiveState;
  onAllowLive: () => void;
  /** Back to the computers screen: only before any computer is paired, when there is no tab bar. */
  onBack?: () => void;
  version: string;
  /** What the tab bar blurs, and where this page reports how much of it runs on under the bar; only as a tab. */
  blurTarget?: RefObject<View | null>;
  under?: SharedValue<number>;
}

/** Each language under its own name, the same in every language. */
const LANGUAGE_NAMES = { en: "English", "zh-CN": "中文" } as const;
const LANGUAGE_CHOICES: readonly LanguagePreference[] = ["system", "zh-CN", "en"];
const APPEARANCE_CHOICES: readonly AppearancePreference[] = ["system", "dark", "light"];

export function SettingsScreen({
  notifications,
  language,
  onLanguage,
  appearance,
  onAppearance,
  batteryRestricted,
  onToggleNotifications,
  onOpenNotificationSettings,
  onFixBattery,
  live,
  onAllowLive,
  onBack,
  version,
  blurTarget,
  under,
}: Props): ReactNode {
  const styles = useStyles(createStyles);
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const ownTarget = useBlurTarget();
  const target = blurTarget ?? ownTarget;
  const page = usePageScroll(under);
  const top = usePageTop();
  const showBattery = notifications === "on" && batteryRestricted;
  return (
    <View style={styles.root}>
      <GlassTarget target={target}>
      <Reanimated.ScrollView
        {...page.props}
        contentContainerStyle={[styles.content, { paddingTop: top, paddingBottom: (onBack === undefined ? TAB_BAR_HEIGHT : 0) + 24 + insets.bottom }]}
      >
        <View style={styles.bleed}>
          <LargeTitle y={page.y} title={t("settings.title")} />
        </View>
        <Group>
          <Row
            title={t("settings.notifications.title")}
            detail={notifications === "unsupported" ? t("settings.notifications.unsupported") : undefined}
            last={notifications !== "denied" && !showBattery}
            trailing={
              <Switch
                value={notifications === "on"}
                disabled={notifications === "unsupported"}
                onValueChange={onToggleNotifications}
                trackColor={{ false: colors.selected, true: colors.sysGreen }}
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
              <Row title={t("settings.battery.title")} last />
              <View style={styles.action}>
                <Button label={t("settings.battery.fix")} kind="plain" onPress={onFixBattery} />
              </View>
            </>
          ) : null}
        </Group>

        {notifications === "on" ? (
          <>
            <View style={styles.gap} />
            <Group>
              <Row
                title={t("settings.live.title")}
                detail={live === "on" ? t("settings.live.on") : live === "off" ? t("settings.live.off") : t("settings.live.unsupported")}
                last={live !== "off"}
                trailing={live === "on" ? <CheckGlyph size={16} color={colors.sysGreen} /> : undefined}
              />
              {live === "off" ? (
                <View style={styles.action}>
                  <Button label={t("settings.live.allow")} kind="plain" onPress={onAllowLive} />
                </View>
              ) : null}
            </Group>
          </>
        ) : null}

        <SectionHeader title={t("settings.appearance.section")} />
        <Group>
          {APPEARANCE_CHOICES.map((choice, index) => (
            <Row
              key={choice}
              title={t(`settings.appearance.${choice}`)}
              trailing={choice === appearance ? <CheckGlyph size={16} color={colors.tint} /> : undefined}
              chevron={false}
              selected={choice === appearance}
              last={index === APPEARANCE_CHOICES.length - 1}
              onPress={() => onAppearance(choice)}
            />
          ))}
        </Group>

        <SectionHeader title={t("settings.language.section")} />
        <Group>
          {LANGUAGE_CHOICES.map((choice, index) => (
            <Row
              key={choice}
              title={choice === "system" ? t("settings.language.system") : LANGUAGE_NAMES[choice]}
              trailing={choice === language ? <CheckGlyph size={16} color={colors.tint} /> : undefined}
              chevron={false}
              selected={choice === language}
              last={index === LANGUAGE_CHOICES.length - 1}
              onPress={() => onLanguage(choice)}
            />
          ))}
        </Group>

        <View style={styles.gap} />
        <Group>
          <Row title={t("settings.about.app")} trailing={<Text style={styles.version}>{version}</Text>} last />
        </Group>
      </Reanimated.ScrollView>
      </GlassTarget>
      <PageBar
        target={target}
        y={page.y}
        title={t("settings.title")}
        left={
          onBack !== undefined ? (
            <IconButton onPress={onBack} label={t("common.back")}>
              <BackGlyph size={24} color={colors.tint} />
            </IconButton>
          ) : undefined
        }
      />
    </View>
  );
}

function createStyles(c: Palette) {
  return {
    root: { flex: 1, backgroundColor: c.bg },
    content: { width: "100%", maxWidth: 600, alignSelf: "center", paddingHorizontal: 16 },
    action: { paddingHorizontal: 12, paddingBottom: 12 },
    gap: { height: 24 },
    // The large title keeps the home's 20 px inset inside this 16 px-padded list.
    bleed: { marginHorizontal: -16 },
    version: { fontFamily: MONO, fontSize: 12, lineHeight: 16, color: c.fgFaint },
  } as const;
}
