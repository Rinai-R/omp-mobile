import { useCallback, useMemo, useState, type ReactNode } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
  type PressableStateCallbackType,
} from "react-native";
import { SANS, MONO, radius, useColors, useStyles, type Palette } from "../theme";
import type { ModelOption } from "../types";
import { t } from "../i18n/index.ts";
import { CheckGlyph } from "./icons";
import { Group, Row, SectionHeader, Sheet } from "./ui";

const LEVELS: readonly string[] = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];

/** `1000000` → `1M`, `131072` → `131k`. */
export function contextLabel(window: number | undefined): string {
  if (window === undefined || window <= 0) return "";
  if (window >= 1_000_000) return `${Math.round(window / 100_000) / 10}M`;
  return `${Math.round(window / 1_000)}k`;
}

function matches(model: ModelOption, query: string): boolean {
  if (query === "") return true;
  return `${model.provider} ${model.name} ${model.id}`.toLowerCase().includes(query);
}

function LevelChip({
  level,
  active,
  onPress,
}: {
  level: string;
  active: boolean;
  onPress: () => void;
}): ReactNode {
  const styles = useStyles(createStyles);
  const style = useCallback(
    ({ pressed }: PressableStateCallbackType) => [
      active ? styles.levelChipOn : styles.levelChip,
      pressed && styles.pressed,
    ],
    [active, styles],
  );
  return (
    <Pressable
      onPress={onPress}
      style={style}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel={t("model.levelA11y", { level })}
    >
      <Text style={active ? styles.levelTextOn : styles.levelText}>{level}</Text>
    </Pressable>
  );
}

/**
 * The model and thinking-level picker: OMP's own catalog for this session,
 * grouped by provider, with a filter; the levels come from the current model.
 */
export function ModelSheet({
  visible,
  models,
  levels,
  current,
  level,
  loading,
  error,
  onClose,
  onSelectModel,
  onSelectLevel,
}: {
  visible: boolean;
  models: ModelOption[] | null;
  levels: string[] | null;
  current: { provider?: string; id?: string; name?: string } | undefined;
  level: string | undefined;
  loading: boolean;
  error: string | null;
  onClose: () => void;
  onSelectModel: (model: ModelOption) => void;
  onSelectLevel: (level: string) => void;
}): ReactNode {
  const styles = useStyles(createStyles);
  const colors = useColors();
  const { height } = useWindowDimensions();
  const [query, setQuery] = useState("");

  const groups = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const byProvider = new Map<string, ModelOption[]>();
    for (const model of models ?? []) {
      if (!matches(model, needle)) continue;
      const list = byProvider.get(model.provider) ?? [];
      list.push(model);
      byProvider.set(model.provider, list);
    }
    return [...byProvider.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [models, query]);

  const shown = levels ?? LEVELS.filter((entry) => entry !== "inherit");
  const currentKey = current?.provider !== undefined && current.id !== undefined ? `${current.provider}/${current.id}` : "";
  const total = models?.length ?? 0;

  return (
    <Sheet visible={visible} title={t("model.title")} onClose={onClose}>
      <View style={styles.sheet}>
        <View style={styles.levelBlock}>
          <Text style={styles.levelLabel}>{t("model.thinking")}</Text>
          <View style={styles.levelRow}>
            {shown.map((entry) => (
              <LevelChip
                key={entry}
                level={entry}
                active={entry === level}
                onPress={() => onSelectLevel(entry)}
              />
            ))}
          </View>
        </View>

        <View style={styles.search}>
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder={models === null ? t("model.loading") : t("model.search", { count: total })}
            placeholderTextColor={colors.fgFaint}
            selectionColor={colors.ring}
            autoCapitalize="none"
            autoCorrect={false}
            editable={models !== null}
            style={styles.searchInput}
          />
        </View>

        {error !== null ? (
          <Text style={styles.error} selectable>
            {error}
          </Text>
        ) : null}

        <ScrollView
          style={{ maxHeight: Math.max(180, Math.round(height * 0.52)) }}
          contentContainerStyle={styles.list}
          keyboardShouldPersistTaps="handled"
        >
          {loading ? <Text style={styles.note}>{t("model.loadingCatalog")}</Text> : null}
          {!loading && models !== null && groups.length === 0 ? (
            <Text style={styles.note}>{t("model.noMatch", { query: query.trim() })}</Text>
          ) : null}
          {groups.map(([provider, list]) => (
            <View key={provider}>
              <SectionHeader title={provider} meta={`${list.length}`} />
              <Group>
                {list.map((model, index) => {
                  const key = `${model.provider}/${model.id}`;
                  return (
                    <Row
                      key={key}
                      title={model.name}
                      detail={model.id === model.name ? undefined : model.id}
                      mono
                      last={index === list.length - 1}
                      onPress={() => onSelectModel(model)}
                      accessibilityLabel={t("common.pair", { label: model.name, value: model.provider })}
                      trailing={
                        <View style={styles.trailing}>
                          {model.contextWindow !== undefined ? (
                            <Text style={styles.meta}>{contextLabel(model.contextWindow)}</Text>
                          ) : null}
                          {model.reasoning ? <Text style={styles.meta}>{t("model.reasoning")}</Text> : null}
                          {key === currentKey ? <CheckGlyph size={14} color={colors.accent} /> : null}
                        </View>
                      }
                    />
                  );
                })}
              </Group>
            </View>
          ))}
        </ScrollView>
      </View>
    </Sheet>
  );
}

function createStyles(c: Palette) {
  const levelChip = {
    paddingHorizontal: 11,
    height: 30,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: c.border,
    backgroundColor: c.raised,
    alignItems: "center",
    justifyContent: "center",
  } as const;
  return {
    sheet: { gap: 12, paddingBottom: 6 },
    levelBlock: { gap: 8 },
    levelLabel: {
      fontFamily: MONO,
      fontSize: 10,
      lineHeight: 14,
      letterSpacing: 0.5,
      textTransform: "uppercase",
      color: c.fgFaint,
      paddingHorizontal: 2,
    },
    levelRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
    levelChip,
    levelChipOn: { ...levelChip, backgroundColor: c.accentMuted, borderColor: c.ring },
    levelText: { fontFamily: MONO, fontSize: 11.5, lineHeight: 15, color: c.fgMuted },
    levelTextOn: { fontFamily: MONO, fontSize: 11.5, lineHeight: 15, color: c.accent },
    pressed: { opacity: 0.8 },
    search: {
      borderRadius: radius.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
      backgroundColor: c.raised,
      paddingHorizontal: 12,
    },
    searchInput: { fontFamily: SANS, height: 38, fontSize: 14, color: c.fg },
    error: { fontFamily: SANS, fontSize: 12.5, lineHeight: 18, color: c.err },
    list: { paddingBottom: 8, gap: 2 },
    note: { fontFamily: MONO, fontSize: 11.5, lineHeight: 17, color: c.fgFaint, paddingHorizontal: 4, paddingVertical: 10 },
    trailing: { flexDirection: "row", alignItems: "center", gap: 8 },
    meta: { fontFamily: MONO, fontSize: 10.5, lineHeight: 14, color: c.fgFaint },
  } as const;
}
