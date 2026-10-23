import type { ReactNode } from "react";
import { ScrollView, View } from "react-native";
import { Group, Header, Row, SectionHeader } from "../components/ui";
import type { Settings } from "../storage";
import { useStyles, type Palette } from "../theme";

interface Props {
  settings: Settings;
  onChange: (settings: Settings) => void;
  onBack: () => void;
  version: string;
}

export function SettingsScreen({ onBack, version }: Props): ReactNode {
  const styles = useStyles(createStyles);
  return (
    <View style={styles.root}>
      <Header title="Settings" onBack={onBack} />
      <ScrollView contentContainerStyle={styles.content}>
        <SectionHeader title="Notifications" />
        <Group>
          <Row
            title="In-chat only for now"
            detail="Approvals and finished turns appear in the chat. Background notifications need the Android foreground service, which is not in v0.1."
            last
          />
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
  } as const;
}
